// The companion's "brain".
//
// Given the person's recent entries and their own usual level (baseline), it
// decides what the companion says and which one small thing it suggests.
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
import type { DailyEntry, Profile, WeeklyEntry } from "./types";

export type SuggestionId = "morning-light" | "walk" | "regular-bedtime" | "music";

export interface Suggestion {
  id: SuggestionId;
  text: string;
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
}

export interface BrainOutput {
  /** One plain sentence for the companion to say. */
  say: string;
  /** At most one small suggestion, or null. */
  suggestion: Suggestion | null;
  /** True when something changed compared with the person's own level. */
  noticedChange: boolean;
}

export interface Brain {
  readonly name: string;
  reflect(input: BrainInput): Promise<BrainOutput>;
  /** Short closing line for the end of a check-in. */
  closingLine(kind: "daily" | "weekly", today: string): string;
}

// Rule-based default

const SUGGESTIONS: Record<SuggestionId, string> = {
  "morning-light": "Get some daylight within an hour of waking, even ten minutes by a window counts.",
  walk: "Take a short walk outside today, at whatever pace feels fine.",
  "regular-bedtime": "Try going to bed around your usual time for the next few nights.",
  music: "Put on some music you like while you do something ordinary.",
};

function find(levels: Levels, key: MetricLevel["key"]) {
  return levels.metrics.find((m) => m.key === key);
}

function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export const ruleBrain: Brain = {
  name: "rules-v1",

  async reflect({ levels }) {
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
        say: "After about a week of check-ins I can start comparing with your own usual level.",
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
  },

  closingLine(kind, today) {
    const lines =
      kind === "daily"
        ? ["Thanks. That's all for today.", "Done. That's all for today.", "Thanks, that's it for today."]
        : ["Thanks. That's this week's questions done.", "Done. That's all for this week."];
    const n = today.split("-").reduce((a, b) => a + Number(b), 0);
    return lines[n % lines.length];
  },
};

/** The brain the app uses. Swap this for a trained model that implements `Brain`. */
export const brain: Brain = ruleBrain;
