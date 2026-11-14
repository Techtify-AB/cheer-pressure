// The companion's "brain".
//
// Given the person's recent entries, their own usual level (baseline) and the
// passive measures, it decides what the companion says and which one small thing it
// suggests: the reflection on their own entries, and for the passive measures the
// explanation of what changed, the calm line on home, the one-sentence insight on
// My values and the suggestion after "Not my best".
//
// What the brain does NOT decide: whether the companion asks. That rule stays in
// lib/passive.ts (evaluatePassive) so it stays explainable and testable; the brain
// gets the outcome as `passive.askNow` and only words it.
//
// `ruleBrain` below needs no API key and no network. A trained model plugs in by
// implementing `Brain` and changing the `brain` export at the bottom of this file.
// The UI only ever calls `brain`, so nothing else has to change.
//
// Ground rules any implementation must keep:
// - Compare only with the person's own earlier entries.
// - Describe change, never diagnose: no "depressed", "relapse", "at risk".
// - Never guilt the person or push for more time in the app.
// - Crisis wording is handled before the brain (lib/crisis.ts): the brain is not
//   asked to reply to it.

import { describeMinutes } from "./dates";
import type { Levels, MetricLevel } from "./levels";
import {
  calmLine,
  explainChange,
  suggestionFor,
  weeklyInsight,
  type Direction,
  type Evaluation,
  type PassiveMetric,
  type Range,
  type SourceId,
} from "./passive";
import type { DailyEntry, PassiveKey, Profile, RoutineId, WeeklyEntry } from "./types";

/** The small things the companion can suggest: the routines the person can switch on or off in Settings. */
export type SuggestionId = RoutineId;

export interface Suggestion {
  id: SuggestionId;
  text: string;
}

/** One passive measure, as plain data. */
export interface PassiveMeasureInput {
  key: PassiveKey;
  /** The category it belongs to (SOURCES in lib/passive.ts): "sleep", "energy", "social" or "mood". */
  source: SourceId;
  label: string;
  /** One value per day for every measure. */
  unit: "day";
  status: PassiveMetric["status"];
  /** Set only when status is "changed": the last week lies on this side of the usual range. */
  direction: Direction | null;
  /**
   * The last week's values (up to 7 days), oldest first, in the measure's own unit:
   * milliseconds for the typing measures, minutes after 04:00 for first and last activity,
   * hours for quiet night.
   */
  recentValues: number[] | null;
  /** The person's own usual range over the 28 days before (10th, 50th, 90th percentile), same unit. */
  usual: Range | null;
  /** True when weekdays were compared with weekdays and weekends with weekends. */
  split: boolean;
  /** How many days of this measure exist so far. */
  count: number;
  /** The rule-based plain words for the change, e.g. "your typing has been more uneven". */
  phrase: string | null;
}

/** The passive measures and the outcome of the rule in lib/passive.ts. */
export interface PassiveInput {
  daysOfData: number;
  learning: boolean;
  /** Decided by lib/passive.ts. The brain words it, it does not change it. */
  askNow: boolean;
  reason: Evaluation["reason"];
  /** How many days this week and in the four weeks before the change is based on. */
  basedOn: { days: number; usualDays: number };
  /** The data includes made-up demo data, or the change was simulated. */
  simulated: boolean;
  measures: PassiveMeasureInput[];
}

/** Plain data for the brain from the rule's evaluation. */
export function passiveInput(e: Evaluation): PassiveInput {
  return {
    daysOfData: e.daysOfData,
    learning: e.learning,
    askNow: e.askNow,
    reason: e.reason,
    basedOn: e.basedOn,
    simulated: e.simulated,
    measures: e.metrics.map((m) => ({
      key: m.key,
      source: m.source,
      label: m.label,
      unit: m.unit,
      status: m.status,
      direction: m.direction,
      recentValues: m.recentValues,
      split: m.split,
      usual: m.usual,
      count: m.points.length,
      phrase: m.phrase,
    })),
  };
}

export interface BrainInput {
  today: string;
  profile: Profile | null;
  /** Daily entries from the last 14 days, oldest first. */
  recentDaily: DailyEntry[];
  /** Weekly answers from the last 8 weeks, oldest first. */
  recentWeekly: WeeklyEntry[];
  /** The person's own usual level and how the last week compares with it. */
  levels: Levels;
  /** The passive measures against the person's own range, and whether the rule asks. */
  passive: PassiveInput;
}

/** What the companion says about the passive measures. */
export interface PassiveWords {
  /** Shown first in the proposed check-in: what changed and how much data it is based on. */
  explanation: string;
  /** The one calm sentence on home. */
  calmLine: string;
  /** The one sentence on My values. */
  insight: string;
  /** The one small thing to try after "Not my best". */
  suggestion: Suggestion;
}

export interface BrainOutput {
  /** One plain sentence for the companion to say. */
  say: string;
  /** At most one small suggestion, or null. */
  suggestion: Suggestion | null;
  /** True when something changed compared with the person's own level. */
  noticedChange: boolean;
  /** Words for the passive measures. */
  passive: PassiveWords;
}

export interface Brain {
  readonly name: string;
  reflect(input: BrainInput): Promise<BrainOutput>;
  /** Short closing line for the end of a check-in. */
  closingLine(kind: "daily" | "weekly", today: string): string;
}

// Rule-based default

export const SUGGESTIONS: Record<SuggestionId, string> = {
  "morning-light": "Get some daylight within an hour of waking, even ten minutes by a window counts.",
  walk: "Take a short walk outside in daylight today, at whatever pace feels fine.",
  "regular-bedtime": "Try going to bed around your usual time for the next few nights.",
  music: "Put on some music you like while you do something ordinary.",
  "call-someone": "Call or message someone you like today, just to say hello.",
};

function find(levels: Levels, key: MetricLevel["key"]) {
  return levels.metrics.find((m) => m.key === key);
}

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The rule-based words for the passive measures: the pure functions in lib/passive.ts. */
export function rulePassiveWords(p: PassiveInput): PassiveWords {
  const view = { ...p, changed: p.measures.filter((m) => m.status === "changed") };
  const id = suggestionFor(view);
  return {
    explanation: explainChange(view),
    calmLine: calmLine(view),
    insight: weeklyInsight(view),
    suggestion: { id, text: SUGGESTIONS[id] },
  };
}

/** The rule-based reflection on the person's own entries. */
function reflectOnEntries({ levels }: BrainInput): Omit<BrainOutput, "passive"> {
  const phrases: string[] = [];
  const order: SuggestionId[] = [];

  const bed = find(levels, "bedtime");
  if (bed?.direction === "up" && bed.delta !== null) {
    phrases.push(`you've gone to bed about ${describeMinutes(bed.delta)} later`);
    order.push("regular-bedtime", "morning-light");
  } else if (bed?.direction === "down" && bed.delta !== null) {
    phrases.push(`you've gone to bed about ${describeMinutes(bed.delta)} earlier`);
  }

  const sleep = find(levels, "sleep");
  if (sleep?.direction === "down" && !phrases.length) {
    phrases.push("you've slept less");
    order.push("regular-bedtime");
  }

  const form = find(levels, "form");
  if (form?.direction === "down") {
    phrases.push("your form has been lower");
    order.push("walk");
  }

  const speech = find(levels, "speech");
  if (speech?.direction === "down") {
    phrases.push("you've read the sentence more slowly");
    order.push("music");
  }

  const w = levels.weekly;
  if (w.latestIsRecent) {
    const higher = w.items.filter((i) => i.direction === "up");
    const sign = higher.find((i) => i.key.startsWith("sign:"));
    if (higher.length) {
      phrases.push(
        sign
          ? `this week you noticed "${sign.label.toLowerCase()}" more than usual`
          : "your weekly answers were higher than usual",
      );
      order.push("morning-light");
    }
  }

  if (!levels.hasBaseline) {
    return {
      say: "After about a week I can start comparing with your own usual.",
      suggestion: null,
      noticedChange: false,
    };
  }

  if (!phrases.length) {
    return {
      say: "The last week looks close to your own usual level.",
      suggestion: null,
      noticedChange: false,
    };
  }

  const picked = order[0] ?? "walk";
  return {
    say: `Compared with your own usual level, over the last week ${joinPhrases(phrases.slice(0, 3))}.`,
    suggestion: { id: picked, text: SUGGESTIONS[picked] },
    noticedChange: true,
  };
}

export const ruleBrain: Brain = {
  name: "rules-v2",

  async reflect(input) {
    return { ...reflectOnEntries(input), passive: rulePassiveWords(input.passive) };
  },

  closingLine(kind, today) {
    const lines =
      kind === "daily"
        ? ["Thanks. That's all for today.", "Done. That's all for today.", "Thanks, that's it for today."]
        : ["Thanks. That's all the questions done.", "Done. Thanks for answering."];
    const n = today.split("-").reduce((a, b) => a + Number(b), 0);
    return lines[n % lines.length];
  },
};

/** The brain the app uses. Swap this for a trained model that implements `Brain`. */
export const brain: Brain = ruleBrain;
