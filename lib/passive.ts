// The passive measures and the one rule that decides when the companion asks.
// Pure code: give it the stored data and today's date, get back what changed.
//
// THE RULE (keep it explainable):
// - A measure counts as changed when the middle value (median) of its last 3
//   sessions or days lies outside the person's own typical range: the 25th to 75th
//   percentile of their earlier sessions or days. It needs at least 7 earlier ones,
//   and the last 3 must include something from the past 7 days.
// - When at least 2 measures have changed, the companion proposes a check-in.
// - Until there are 7 days with any data, it is still learning and never asks.
// - After a proposed check-in it waits 3 days, unless a measure changes that was
//   not part of the last one.
//
// It compares only with the person's own earlier data. No percentages, no risk
// score, no diagnosis: it says what changed, in plain words.

import { addDays, clockToMinutes, daysBetween, minutesToClock } from "./dates";
import type { AppData, DayKey, PassiveKey, PromptedCheckIn } from "./types";

export const RECENT_POINTS = 3;
export const MIN_USUAL_POINTS = 7;
export const RECENT_MAX_AGE_DAYS = 7;
export const LEARNING_DAYS = 7;
export const MIN_CHANGED_TO_ASK = 2;
export const PAUSE_AFTER_ASKING_DAYS = 3;
/** A day runs from 04:00 to 04:00 (the desktop app uses the same boundary). */
export const DAY_STARTS_AT_MIN = 4 * 60;

export type Direction = "up" | "down";

export interface Point {
  date: DayKey;
  value: number;
}

export interface Range {
  low: number; // 25th percentile
  median: number;
  high: number; // 75th percentile
  n: number;
}

export type Judgement =
  | { status: "learning"; usual: null; recent: null; direction: null }
  | { status: "steady" | "changed"; usual: Range; recent: { median: number; n: number }; direction: Direction | null };

export interface PassiveMetric {
  key: PassiveKey;
  label: string;
  meaning: string;
  /** "session": one value per typing session. "day": one value per day. */
  unit: "session" | "day";
  format: (v: number) => string;
  points: Point[];
  status: "learning" | "no-recent" | "steady" | "changed";
  usual: Range | null;
  recent: { median: number; n: number } | null;
  direction: Direction | null;
  /** Plain words for a change, e.g. "your typing has been more uneven". */
  phrase: string | null;
}

export interface Evaluation {
  today: DayKey;
  daysOfData: number;
  learning: boolean;
  metrics: PassiveMetric[];
  changed: PassiveMetric[];
  basedOn: { sessions: number; days: number };
  askNow: boolean;
  /** Why the companion does or does not ask. */
  reason: "learning" | "steady" | "one-change" | "changed" | "waiting-after-last" | "simulated";
  /** The data includes made-up demo data, or the change was simulated. */
  simulated: boolean;
}

// Numbers

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(values: number[]): number {
  return quantile([...values].sort((a, b) => a - b), 0.5);
}

/**
 * The core rule for one measure. `values` are oldest first. The last 3 are "recent",
 * everything before them is the person's usual.
 */
export function judge(values: number[]): Judgement {
  if (values.length < MIN_USUAL_POINTS + RECENT_POINTS) {
    return { status: "learning", usual: null, recent: null, direction: null };
  }
  const recentVals = values.slice(-RECENT_POINTS);
  const usualVals = [...values.slice(0, -RECENT_POINTS)].sort((a, b) => a - b);
  const usual: Range = {
    low: quantile(usualVals, 0.25),
    median: quantile(usualVals, 0.5),
    high: quantile(usualVals, 0.75),
    n: usualVals.length,
  };
  const m = median(recentVals);
  const direction: Direction | null = m > usual.high ? "up" : m < usual.low ? "down" : null;
  return { status: direction ? "changed" : "steady", usual, recent: { median: m, n: recentVals.length }, direction };
}

// Clock helpers: minutes after 04:00, so 00:40 comes after 23:10.

export function clockToDayMinutes(hhmm: string): number {
  return (clockToMinutes(hhmm) - DAY_STARTS_AT_MIN + 1440) % 1440;
}

export function dayMinutesToClock(v: number): string {
  return minutesToClock(v + DAY_STARTS_AT_MIN);
}

// The measures

interface Def {
  key: PassiveKey;
  label: string;
  meaning: string;
  unit: "session" | "day";
  format: (v: number) => string;
  up: string;
  down: string;
}

const ms = (v: number) => `${Math.round(v)} ms`;

export const PASSIVE_DEFS: Def[] = [
  {
    key: "spread",
    label: "Typing evenness",
    meaning: "How uneven the time between key presses is. Higher means more uneven",
    unit: "session",
    format: ms,
    up: "your typing has been more uneven",
    down: "your typing has been more even",
  },
  {
    key: "pauses",
    label: "Longer pauses while typing",
    meaning: "1 in 20 gaps between key presses is this long or longer",
    unit: "session",
    format: ms,
    up: "you've paused longer while typing",
    down: "your pauses while typing have been shorter",
  },
  {
    key: "hold",
    label: "Hold time",
    meaning: "How long a key is usually held down",
    unit: "session",
    format: ms,
    up: "you've held keys down longer",
    down: "you've held keys down for less time",
  },
  {
    key: "firstActivity",
    label: "First activity",
    meaning: "Your first key press of the day on this computer",
    unit: "day",
    format: dayMinutesToClock,
    up: "your days have started later",
    down: "your days have started earlier",
  },
  {
    key: "lastActivity",
    label: "Last activity",
    meaning: "Your last key press of the day on this computer",
    unit: "day",
    format: dayMinutesToClock,
    up: "your days have ended later",
    down: "your days have ended earlier",
  },
  {
    key: "quietNight",
    label: "Quiet night",
    meaning:
      "Time from your last activity one day to your first the next. An estimate of rest, not measured sleep",
    unit: "day",
    format: (v) => `${v.toFixed(1)} h`,
    up: "your quiet time at night has been longer",
    down: "your quiet time at night has been shorter",
  },
];

function seriesFor(data: AppData, key: PassiveKey, today: DayKey): Point[] {
  const sessions = data.typingSessions; // oldest first (storage sorts by date)
  const pick = (v: number | null, date: DayKey): Point[] => (v === null || !Number.isFinite(v) ? [] : [{ date, value: v }]);
  if (key === "spread") return sessions.flatMap((s) => pick(s.spreadMs, s.date));
  if (key === "pauses") return sessions.flatMap((s) => pick(s.p95PauseMs, s.date));
  if (key === "hold") return sessions.flatMap((s) => pick(s.medianHoldMs, s.date));
  const days = data.activityDays.filter((d) => d.date <= today);
  if (key === "firstActivity") return days.map((d) => ({ date: d.date, value: clockToDayMinutes(d.first) }));
  // Today's last activity is not known until the day is over.
  if (key === "lastActivity")
    return days.filter((d) => d.date < today).map((d) => ({ date: d.date, value: clockToDayMinutes(d.last) }));
  // quietNight: last activity of one day to first activity of the next day.
  const byDate = new Map(days.map((d) => [d.date, d]));
  const out: Point[] = [];
  for (const d of days) {
    const prev = byDate.get(addDays(d.date, -1));
    if (!prev) continue;
    const gap = clockToDayMinutes(d.first) + 1440 - clockToDayMinutes(prev.last);
    out.push({ date: d.date, value: gap / 60 });
  }
  return out;
}

function metric(data: AppData, def: Def, today: DayKey): PassiveMetric {
  const points = seriesFor(data, def.key, today);
  const j = judge(points.map((p) => p.value));
  const base = { key: def.key, label: def.label, meaning: def.meaning, unit: def.unit, format: def.format, points };
  if (j.status === "learning") {
    return { ...base, status: "learning", usual: null, recent: null, direction: null, phrase: null };
  }
  const recentDates = points.slice(-RECENT_POINTS).map((p) => p.date);
  const fresh = recentDates.some((d) => daysBetween(d, today) < RECENT_MAX_AGE_DAYS);
  if (!fresh) return { ...base, status: "no-recent", usual: j.usual, recent: null, direction: null, phrase: null };
  return {
    ...base,
    status: j.status,
    usual: j.usual,
    recent: j.recent,
    direction: j.direction,
    phrase: j.direction === "up" ? def.up : j.direction === "down" ? def.down : null,
  };
}

function lastCheckIn(data: AppData): PromptedCheckIn | null {
  return data.checkIns.length ? data.checkIns[data.checkIns.length - 1] : null;
}

export function evaluatePassive(data: AppData, today: DayKey): Evaluation {
  const metrics = PASSIVE_DEFS.map((d) => metric(data, d, today));
  const changed = metrics.filter((m) => m.status === "changed");
  const dates = new Set([...data.typingSessions.map((s) => s.date), ...data.activityDays.map((d) => d.date)]);
  const daysOfData = [...dates].filter((d) => d <= today).length;
  const learning = daysOfData < LEARNING_DAYS;
  const basedOn = {
    sessions: Math.max(0, ...changed.filter((m) => m.unit === "session").map((m) => m.recent?.n ?? 0)),
    days: Math.max(0, ...changed.filter((m) => m.unit === "day").map((m) => m.recent?.n ?? 0)),
  };
  const simulated =
    !!data.settings.simulatedChangeAt ||
    [...data.typingSessions, ...data.activityDays].some((e) => e.source === "demo");

  let reason: Evaluation["reason"];
  let askNow = false;
  if (learning) reason = "learning";
  else if (changed.length === 0) reason = "steady";
  else if (changed.length < MIN_CHANGED_TO_ASK) reason = "one-change";
  else if (data.settings.simulatedChangeAt) {
    reason = "simulated";
    askNow = true;
  } else {
    const last = lastCheckIn(data);
    const recentlyAsked = last !== null && daysBetween(last.date, today) < PAUSE_AFTER_ASKING_DAYS;
    const somethingNew = !last || changed.some((m) => !last.triggeredBy.some((t) => t.key === m.key));
    if (recentlyAsked && !somethingNew) reason = "waiting-after-last";
    else {
      reason = "changed";
      askNow = true;
    }
  }
  return { today, daysOfData, learning, metrics, changed, basedOn, askNow, reason, simulated };
}

// Words

const COUNT_WORDS = ["No things", "One thing", "Two things", "Three things", "Four things", "Five things", "Six things"];

export function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function basedOnText(b: Evaluation["basedOn"]): string {
  const parts: string[] = [];
  if (b.sessions) parts.push(`${b.sessions} typing ${b.sessions === 1 ? "session" : "sessions"}`);
  if (b.days) parts.push(`${b.days} ${b.days === 1 ? "day" : "days"}`);
  return parts.length ? `This is based on your last ${joinPhrases(parts)}.` : "";
}

/** "Two things have changed compared with your usual: ... This is based on ..." */
export function explainChange(e: Evaluation): string {
  const phrases = e.changed.map((m) => m.phrase).filter((p): p is string => !!p);
  if (!phrases.length) return "Nothing stands out compared with your usual right now.";
  const n = phrases.length;
  const head = `${COUNT_WORDS[n] ?? `${n} things`} ${n === 1 ? "has" : "have"} changed compared with your usual:`;
  return `${head} ${joinPhrases(phrases)}. ${basedOnText(e.basedOn)}`.trim();
}

/** One calm sentence for home. */
export function calmLine(e: Evaluation): string {
  if (e.learning) {
    return `I'm still learning your usual rhythm (${e.daysOfData} of ${LEARNING_DAYS} days so far). Nothing is needed from you.`;
  }
  if (e.askNow) return "A few things look different from your usual. When you have a moment, have a look.";
  return "I'm keeping an eye on your rhythm. Nothing is needed from you.";
}

/** One sentence for "Your own level". */
export function weeklyInsight(e: Evaluation): string {
  if (e.learning) return `Still learning your usual rhythm: ${e.daysOfData} of ${LEARNING_DAYS} days so far.`;
  const phrases = e.changed.map((m) => m.phrase).filter((p): p is string => !!p);
  if (!phrases.length) return "Lately your rhythm looks like your usual.";
  return `Lately, compared with your usual, ${joinPhrases(phrases)}.`;
}
