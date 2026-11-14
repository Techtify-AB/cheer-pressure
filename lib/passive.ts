// The passive measures and the one rule that decides when the companion asks.
// Pure code: give it the stored data and today's date, get back what changed.
//
// THE RULE (keep it explainable):
// - One value per measure per day. Typing: rhythm evenness and hold time, pooled over the
//   day's counted bursts of real writing (lib/typing.ts; a day needs 300 counted presses).
//   Day and night rhythm: first activity, last activity, quiet night.
// - Windows, the same for every measure: the person's usual is the 28 days before the last
//   week (at least 10 days with a value); recent is the last 7 days (at least 4 days with a
//   value). Weekdays are compared with weekdays and weekends with weekends when the usual has
//   enough of both (8 weekdays and 4 weekend days); otherwise they are pooled.
// - A measure counts as changed when CHANGE_TEST below says so: chosen by measurement (see
//   CHANGE_TESTS and scripts/measure-rule.mts).
// - Typing compares like with like: the kind of app (writing, code, browser, other) with the
//   most counted presses this week, against that kind's own usual, when that kind has enough
//   days in both windows; otherwise all kinds pooled (games are never counted).
// - The measures are grouped into sources (SOURCES below): "typing" and "sleep" (shown to
//   the person as "Day and night rhythm", an estimate of rest from the first and last key
//   press, never measured sleep). The companion proposes a check-in when measures have
//   changed in at least TWO DIFFERENT sources, or when at least TWO sleep measures have
//   changed even if nothing else has. Typing alone never asks.
// - Until there are 14 days with any data, it is still learning and never asks.
// - After a proposed check-in it waits 3 days, unless a measure changes that was
//   not part of the last one.
//
// It compares only with the person's own earlier data. No percentages, no risk
// score, no diagnosis: it says what changed, in plain words.

import { addDays, clockToMinutes, daysBetween, minutesToClock, parseDay } from "./dates";
import type { SuggestionId } from "./brain";
import { ANSWER_VALUE, answerLabel } from "./daily";
import type { AppData, DayKey, PassiveKey, PromptedCheckIn, TypingDay, TypingKind } from "./types";

/** The person's own typical range, as percentiles of their usual days. */
export const BAND = { low: 0.1, high: 0.9 };
export const USUAL_DAYS = 28;
export const RECENT_DAYS = 7;
export const MIN_USUAL_DAYS = 10;
export const MIN_RECENT_DAYS = 4;
/** Weekdays and weekends are compared apart when the usual has at least this many of each. */
export const MIN_SPLIT = { weekday: 8, weekend: 4 };
export const LEARNING_DAYS = 14;
export const PAUSE_AFTER_ASKING_DAYS = 3;
/** A day runs from 04:00 to 04:00 (the desktop app uses the same boundary). */
export const DAY_STARTS_AT_MIN = 4 * 60;
/** Typing needs this many counted presses in a day to give that day a value (lib/typing.ts). */
export const MIN_DAY_PRESSES = 300;

export type Direction = "up" | "down";

export interface Point {
  date: DayKey;
  value: number;
}

export interface Range {
  low: number; // 10th percentile (see BAND)
  median: number;
  high: number; // 90th percentile (see BAND)
  /** How many usual days. */
  n: number;
}

/**
 * The candidate tests for "changed", on the recent days against the usual band (after
 * taking out the weekday or weekend level). Measured with scripts/measure-rule.mts on 400
 * made-up periods; the numbers are with CHANGE_TEST.
 */
export const CHANGE_TESTS = {
  /** The median of the recent days lies outside the usual 10 to 90 band. */
  median: (r: number[], lo: number, hi: number): Direction | null => {
    const m = quantile([...r].sort((a, b) => a - b), 0.5);
    return m > hi ? "up" : m < lo ? "down" : null;
  },
  /**
   * The median of the recent days lies outside the usual 10 to 90 band widened by a quarter of
   * its width on each side (for bell-shaped days about the 3rd to 97th percentile, but steadier
   * than reading those percentiles off 10 to 28 days).
   */
  medianWide: (r: number[], lo: number, hi: number): Direction | null => {
    const m = quantile([...r].sort((a, b) => a - b), 0.5);
    const pad = (hi - lo) * 0.25;
    return m > hi + pad ? "up" : m < lo - pad ? "down" : null;
  },
  /** At least 5 of the recent days lie on the same side outside the band. */
  fiveOfSeven: (r: number[], lo: number, hi: number): Direction | null =>
    r.filter((v) => v > hi).length >= 5 ? "up" : r.filter((v) => v < lo).length >= 5 ? "down" : null,
  /** At least 4 of the recent days lie on the same side outside the band. */
  fourOfSeven: (r: number[], lo: number, hi: number): Direction | null =>
    r.filter((v) => v > hi).length >= 4 ? "up" : r.filter((v) => v < lo).length >= 4 ? "down" : null,
};
export type ChangeTest = keyof typeof CHANGE_TESTS;
export const CHANGE_TEST: ChangeTest = "medianWide";

export type Judgement =
  | { status: "learning" | "no-recent"; usual: Range | null; recent: null; recentValues: null; direction: null; split: boolean }
  | {
      status: "steady" | "changed";
      usual: Range;
      recent: { median: number; n: number };
      recentValues: number[];
      direction: Direction | null;
      split: boolean;
    };

export type SourceId = "typing" | "sleep" | "answers";

/**
 * Which measures belong to which source, and whether a source can make the companion ask
 * on its own. One table, so a later source is one more row: "movement" from the camera,
 * "voice", or a bedside sensor adding its measures to "sleep".
 */
export const SOURCES: {
  id: SourceId;
  /** How the person sees it. */
  label: string;
  /** In the clinic report, which is in the first person. */
  reportLabel: string;
  /** In running text: "your typing", "your day and night rhythm". */
  words: string;
  measures: PassiveKey[];
  /** How many of its measures must change for it to ask on its own; null: never on its own. */
  aloneAsksAt: number | null;
}[] = [
  { id: "typing", label: "Typing", reportLabel: "Typing", words: "your typing", measures: ["spread", "hold"], aloneAsksAt: null },
  {
    id: "sleep",
    label: "Day and night rhythm",
    reportLabel: "Day and night rhythm",
    words: "your day and night rhythm",
    measures: ["firstActivity", "lastActivity", "quietNight"],
    aloneAsksAt: 2,
  },
  // The person's own report is the best-supported signal, so it may ask on its own.
  {
    id: "answers",
    label: "Your own answers",
    reportLabel: "My own answers",
    words: "your own answers",
    measures: ["ownAnswer"],
    aloneAsksAt: 1,
  },
];

/** For the daily question: at least this many "Not so good" among the last week's answers. */
export const MIN_NOT_SO_GOOD = 4;
/** Answered days the usual needs before the daily question can count as changed. */
export const MIN_USUAL_ANSWERS = 4;

/** Different sources that must have changed for the companion to ask. */
export const MIN_SOURCES_TO_ASK = 2;

export function sourceOf(key: PassiveKey): SourceId {
  const s = SOURCES.find((x) => x.measures.includes(key));
  if (!s) throw new Error(`measure ${key} has no source`);
  return s.id;
}

/**
 * Whether these changed measures are enough to ask: two different sources, or a source that
 * may ask on its own with enough of its measures. The ladder uses the same test for "the
 * measures have come back".
 */
export function enoughToAsk(changed: { key: PassiveKey }[]): boolean {
  const bySource = new Map<SourceId, number>();
  for (const m of changed) bySource.set(sourceOf(m.key), (bySource.get(sourceOf(m.key)) ?? 0) + 1);
  if (bySource.size >= MIN_SOURCES_TO_ASK) return true;
  return SOURCES.some((s) => s.aloneAsksAt !== null && (bySource.get(s.id) ?? 0) >= s.aloneAsksAt);
}

/** Changed measures only in sources that never ask on their own (typing alone). */
export function onlyQuietSources(changed: { key: PassiveKey }[]): boolean {
  return changed.length > 0 && !enoughToAsk(changed) && changed.every((m) => SOURCES.find((s) => s.id === sourceOf(m.key))?.aloneAsksAt === null);
}

export interface PassiveMetric {
  key: PassiveKey;
  /** Which source the measure belongs to (SOURCES). */
  source: SourceId;
  label: string;
  meaning: string;
  /** One value per day for every measure. */
  unit: "day";
  format: (v: number) => string;
  points: Point[];
  status: "learning" | "no-recent" | "steady" | "changed";
  usual: Range | null;
  recent: { median: number; n: number } | null;
  /** The recent days' values (the last 7 days), oldest first: what the rule compares with the usual range. */
  recentValues: number[] | null;
  direction: Direction | null;
  /** Plain words for a change, e.g. "your typing has been more uneven". */
  phrase: string | null;
  /** True when weekdays were compared with weekdays and weekends with weekends. */
  split: boolean;
  /** For typing: which kind of app's days were compared, or "all" kinds pooled. */
  kind?: TypingKind;
}

export interface Evaluation {
  today: DayKey;
  daysOfData: number;
  learning: boolean;
  metrics: PassiveMetric[];
  changed: PassiveMetric[];
  /** How many recent days and usual days a change is based on. */
  basedOn: { days: number; usualDays: number };
  askNow: boolean;
  /** Why the companion does or does not ask. */
  reason: "learning" | "steady" | "one-change" | "typing-only" | "changed" | "waiting-after-last" | "simulated";
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

export function isWeekend(date: DayKey): boolean {
  const d = parseDay(date).getDay();
  return d === 0 || d === 6;
}

/**
 * The core rule for one measure: the usual is the 28 days before the last week, recent is
 * the last 7 days (today included). Weekday or weekend level is taken out first when the
 * usual has enough of both.
 */
export function judgeDays(points: Point[], today: DayKey, test: ChangeTest = CHANGE_TEST): Judgement {
  const age = (p: Point) => daysBetween(p.date, today);
  const recent = points.filter((p) => age(p) >= 0 && age(p) < RECENT_DAYS);
  const usual = points.filter((p) => age(p) >= RECENT_DAYS && age(p) < RECENT_DAYS + USUAL_DAYS);
  if (usual.length < MIN_USUAL_DAYS) return { status: "learning", usual: null, recent: null, recentValues: null, direction: null, split: false };
  const sortedUsual = usual.map((p) => p.value).sort((a, b) => a - b);
  const range: Range = {
    low: quantile(sortedUsual, BAND.low),
    median: quantile(sortedUsual, 0.5),
    high: quantile(sortedUsual, BAND.high),
    n: usual.length,
  };
  if (recent.length < MIN_RECENT_DAYS) return { status: "no-recent", usual: range, recent: null, recentValues: null, direction: null, split: false };
  const weekendUsual = usual.filter((p) => isWeekend(p.date));
  const weekdayUsual = usual.filter((p) => !isWeekend(p.date));
  const split = weekdayUsual.length >= MIN_SPLIT.weekday && weekendUsual.length >= MIN_SPLIT.weekend;
  const level = split
    ? { weekend: median(weekendUsual.map((p) => p.value)), weekday: median(weekdayUsual.map((p) => p.value)) }
    : null;
  const residual = (p: Point) => (level ? p.value - (isWeekend(p.date) ? level.weekend : level.weekday) : p.value);
  const ur = usual.map(residual).sort((a, b) => a - b);
  const lo = quantile(ur, BAND.low);
  const hi = quantile(ur, BAND.high);
  const direction = CHANGE_TESTS[test](recent.map(residual), lo, hi);
  const recentValues = recent.map((p) => p.value);
  return {
    status: direction ? "changed" : "steady",
    usual: range,
    recent: { median: median(recentValues), n: recent.length },
    recentValues,
    direction,
    split,
  };
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
  format: (v: number) => string;
  up: string;
  down: string;
  /** Without a pronoun, for the clinic report: "more uneven", "later". */
  upWord: string;
  downWord: string;
  /** What it is and what it is not, for the report's legend. */
  is: string;
  isNot: string;
}

const ms = (v: number) => `${Math.round(v)} ms`;

export const PASSIVE_DEFS: Def[] = [
  {
    key: "spread",
    label: "Typing evenness",
    meaning: "How uneven the rhythm of your typing is, from the gaps under a second while you write. Higher means more uneven",
    format: ms,
    up: "your typing has been more uneven",
    down: "your typing has been more even",
    upWord: "more uneven",
    downWord: "more even",
    is: "How even the rhythm of typing is: the timing between key presses while writing, gaps under a second only",
    isNot: "Never which keys, never what was written, not time spent thinking",
  },
  {
    key: "hold",
    label: "Hold time",
    meaning: "How long a key is usually held down while you write",
    format: ms,
    up: "you've held keys down longer",
    down: "you've held keys down for less time",
    upWord: "longer",
    downWord: "shorter",
    is: "How long a key is usually held down while writing",
    isNot: "Never which keys",
  },
  {
    key: "firstActivity",
    label: "First activity",
    meaning: "Your first key press of the day on this computer",
    format: dayMinutesToClock,
    up: "your days have started later",
    down: "your days have started earlier",
    upWord: "later",
    downWord: "earlier",
    is: "The first key press of the day on this computer",
    isNot: "Not the time of waking up",
  },
  {
    key: "lastActivity",
    label: "Last activity",
    meaning: "Your last key press of the day on this computer",
    format: dayMinutesToClock,
    up: "your days have ended later",
    down: "your days have ended earlier",
    upWord: "later",
    downWord: "earlier",
    is: "The last key press of the day on this computer",
    isNot: "Not the time of going to bed",
  },
  {
    key: "quietNight",
    label: "Quiet night",
    meaning:
      "Time from your last activity one day to your first the next. An estimate of rest, not measured sleep",
    format: (v) => `${v.toFixed(1)} h`,
    up: "your nights have been longer",
    down: "your nights have been shorter",
    upWord: "longer",
    downWord: "shorter",
    is: "Time from the last key press one day to the first the next",
    isNot: "An estimate of rest, not measured sleep",
  },
  {
    key: "ownAnswer",
    label: "Daily question",
    meaning: "Your answers to \"How are you today?\": Good, Okay or Not so good",
    format: answerLabel,
    up: "you've answered \"Not so good\" more often",
    down: "your answers have been better",
    upWord: "more often \"Not so good\"",
    downWord: "better",
    is: "Own answers to \"How are you today?\" (Good, Okay, Not so good)",
    isNot: "A day without an answer never counts as low",
  },
];

/**
 * The daily question's own test: at least 4 "Not so good" among the last week's answers, and
 * a larger share than in the four weeks before. Unanswered days are not values at all.
 */
export function judgeAnswers(points: Point[], today: DayKey): Judgement {
  const age = (p: Point) => daysBetween(p.date, today);
  const recent = points.filter((p) => age(p) >= 0 && age(p) < RECENT_DAYS);
  const usual = points.filter((p) => age(p) >= RECENT_DAYS && age(p) < RECENT_DAYS + USUAL_DAYS);
  if (usual.length < MIN_USUAL_ANSWERS) return { status: "learning", usual: null, recent: null, recentValues: null, direction: null, split: false };
  const sorted = usual.map((p) => p.value).sort((a, b) => a - b);
  const range: Range = { low: quantile(sorted, BAND.low), median: quantile(sorted, 0.5), high: quantile(sorted, BAND.high), n: usual.length };
  if (recent.length < MIN_RECENT_DAYS) return { status: "no-recent", usual: range, recent: null, recentValues: null, direction: null, split: false };
  const low = ANSWER_VALUE["not-so-good"];
  const nowLow = recent.filter((p) => p.value === low).length;
  const usualShare = usual.filter((p) => p.value === low).length / usual.length;
  const changed = nowLow >= MIN_NOT_SO_GOOD && nowLow / recent.length > usualShare;
  const recentValues = recent.map((p) => p.value);
  return {
    status: changed ? "changed" : "steady",
    usual: range,
    recent: { median: median(recentValues), n: recent.length },
    recentValues,
    direction: changed ? "up" : null,
    split: false,
  };
}

const TYPING_KINDS: TypingKind[] = ["writing", "code", "browser", "other"];

/** Typing days with a value for one measure, for one kind of app ("all" prefers the desktop app's row over the box's). */
function typingPoints(days: TypingDay[], key: "spread" | "hold", kind: TypingKind, today: DayKey): Point[] {
  const byDate = new Map<DayKey, TypingDay>();
  for (const d of days) {
    if (d.kind !== kind || d.date > today || d.presses < MIN_DAY_PRESSES) continue;
    const v = key === "spread" ? d.spreadMs : d.holdMs;
    if (v === null || !Number.isFinite(v)) continue;
    const cur = byDate.get(d.date);
    if (!cur || (cur.measuredIn === "box" && d.measuredIn === "computer")) byDate.set(d.date, d);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, value: (key === "spread" ? d.spreadMs : d.holdMs) as number }));
}

/**
 * Like with like: the kind of app with the most counted presses this week, when it has enough
 * days in both windows; otherwise every kind pooled ("all").
 */
export function typingKindFor(days: TypingDay[], today: DayKey): TypingKind {
  let best: { kind: TypingKind; presses: number } | null = null;
  for (const kind of TYPING_KINDS) {
    const pts = typingPoints(days, "spread", kind, today);
    const age = (p: Point) => daysBetween(p.date, today);
    const recent = pts.filter((p) => age(p) >= 0 && age(p) < RECENT_DAYS);
    const usual = pts.filter((p) => age(p) >= RECENT_DAYS && age(p) < RECENT_DAYS + USUAL_DAYS);
    if (recent.length < MIN_RECENT_DAYS || usual.length < MIN_USUAL_DAYS) continue;
    const presses = days
      .filter((d) => d.kind === kind && daysBetween(d.date, today) >= 0 && daysBetween(d.date, today) < RECENT_DAYS)
      .reduce((a, d) => a + d.presses, 0);
    if (!best || presses > best.presses) best = { kind, presses };
  }
  return best?.kind ?? "all";
}

function seriesFor(data: AppData, key: PassiveKey, today: DayKey, kind: TypingKind): Point[] {
  if (key === "spread" || key === "hold") return typingPoints(data.typingDays ?? [], key, kind, today);
  if (key === "ownAnswer") {
    return (data.dailyAnswers ?? [])
      .filter((a) => a.answer && a.date <= today)
      .map((a) => ({ date: a.date, value: ANSWER_VALUE[a.answer!] }));
  }
  const days = data.activityDays.filter((d) => d.date <= today);
  if (key === "firstActivity") return days.map((d) => ({ date: d.date, value: clockToDayMinutes(d.first) }));
  // Today's last activity is not known until the day is over.
  if (key === "lastActivity")
    return days.filter((d) => d.date < today).map((d) => ({ date: d.date, value: clockToDayMinutes(d.last) }));
  if (key !== "quietNight") return [];
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

function metric(data: AppData, def: Def, today: DayKey, kind: TypingKind, test: ChangeTest): PassiveMetric {
  const typing = def.key === "spread" || def.key === "hold";
  const points = seriesFor(data, def.key, today, kind);
  const j = def.key === "ownAnswer" ? judgeAnswers(points, today) : judgeDays(points, today, test);
  const base = {
    key: def.key,
    source: sourceOf(def.key),
    label: def.label,
    meaning: def.meaning,
    unit: "day" as const,
    format: def.format,
    points,
    split: j.split,
    ...(typing ? { kind } : {}),
  };
  if (j.status === "learning" || j.status === "no-recent") {
    return { ...base, status: j.status, usual: j.usual, recent: null, recentValues: null, direction: null, phrase: null };
  }
  return {
    ...base,
    status: j.status,
    usual: j.usual,
    recent: j.recent,
    recentValues: j.recentValues,
    direction: j.direction,
    phrase: j.direction === "up" ? def.up : j.direction === "down" ? def.down : null,
  };
}

function lastCheckIn(data: AppData): PromptedCheckIn | null {
  return data.checkIns.length ? data.checkIns[data.checkIns.length - 1] : null;
}

/** Days with any value: typing days with enough presses, or first and last activity. */
export function daysWithData(data: AppData, today: DayKey): number {
  const dates = new Set([
    ...(data.typingDays ?? []).filter((d) => d.presses >= MIN_DAY_PRESSES).map((d) => d.date),
    ...data.activityDays.map((d) => d.date),
  ]);
  return [...dates].filter((d) => d <= today).length;
}

export function evaluatePassive(data: AppData, today: DayKey, opts: { test?: ChangeTest } = {}): Evaluation {
  const test = opts.test ?? CHANGE_TEST;
  const kind = typingKindFor(data.typingDays ?? [], today);
  // In source order (typing, then day and night rhythm), so the wording groups them.
  const metrics = PASSIVE_DEFS.map((d) => metric(data, d, today, kind, test));
  const changed = metrics.filter((m) => m.status === "changed");
  const daysOfData = daysWithData(data, today);
  const learning = daysOfData < LEARNING_DAYS;
  const basedOn = {
    days: Math.max(0, ...changed.map((m) => m.recent?.n ?? 0)),
    usualDays: Math.max(0, ...changed.map((m) => m.usual?.n ?? 0)),
  };
  const simulated =
    !!data.settings.simulatedChangeAt ||
    [...(data.typingDays ?? []), ...data.activityDays].some((e) => e.source === "demo");

  let reason: Evaluation["reason"];
  let askNow = false;
  if (learning) reason = "learning";
  else if (changed.length === 0) reason = "steady";
  else if (!enoughToAsk(changed)) reason = onlyQuietSources(changed) ? "typing-only" : "one-change";
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

/**
 * Thinking pauses (gaps of 1 to 2 s per 100 presses) this week and in the four weeks before.
 * Shown as context under the demo; never part of the rule.
 */
export function thinkingContext(data: AppData, today: DayKey): { recent: number | null; usual: number | null; kind: TypingKind } {
  const kind = typingKindFor(data.typingDays ?? [], today);
  const rows = (data.typingDays ?? []).filter((d) => d.kind === kind && d.presses >= MIN_DAY_PRESSES && d.thinkingPer100 !== null);
  const age = (d: TypingDay) => daysBetween(d.date, today);
  const recent = rows.filter((d) => age(d) >= 0 && age(d) < RECENT_DAYS).map((d) => d.thinkingPer100 as number);
  const usual = rows.filter((d) => age(d) >= RECENT_DAYS && age(d) < RECENT_DAYS + USUAL_DAYS).map((d) => d.thinkingPer100 as number);
  return { recent: recent.length ? median(recent) : null, usual: usual.length ? median(usual) : null, kind };
}

// Words. These are the rule-based wording; the app reaches them through `brain`
// (lib/brain.ts), so a trained model can replace them. Whether to ask is decided
// above, in evaluatePassive, and never by the brain.

/** What the wording below needs: an Evaluation, or the brain's plain-data input. */
export interface PassiveView {
  daysOfData: number;
  learning: boolean;
  askNow: boolean;
  basedOn: { days: number; usualDays: number };
  changed: Pick<PassiveMetric, "key" | "direction" | "phrase">[];
}

/** True when what changed is only typing: shown under the demo, never asked about. */
export function typingAloneChanged(e: PassiveView): boolean {
  return !e.learning && onlyQuietSources(e.changed);
}

const COUNT_WORDS = ["No things", "One thing", "Two things", "Three things", "Four things", "Five things", "Six things"];

export function joinPhrases(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function basedOnText(b: PassiveView["basedOn"]): string {
  if (!b.days || !b.usualDays) return "";
  return `This compares ${b.days} ${b.days === 1 ? "day" : "days"} this week with ${b.usualDays} days in the four weeks before.`;
}

/**
 * "Two things have changed: over the last week your typing has been more uneven and your days
 * have started later than in the four weeks before. This compares 6 days this week with 24 ..."
 */
export function explainChange(e: PassiveView): string {
  const phrases = e.changed.map((m) => m.phrase).filter((p): p is string => !!p);
  if (!phrases.length || typingAloneChanged(e)) return "Nothing stands out compared with your usual right now.";
  const n = phrases.length;
  const head = `${COUNT_WORDS[n] ?? `${n} things`} ${n === 1 ? "has" : "have"} changed:`;
  return `${head} over the last week ${joinPhrases(phrases)} than in the four weeks before. ${basedOnText(e.basedOn)}`.trim();
}

/** One calm sentence for home. */
export function calmLine(e: PassiveView): string {
  if (e.learning) {
    return `I'm still learning your usual rhythm (${e.daysOfData} of ${LEARNING_DAYS} days so far). Nothing is needed from you.`;
  }
  if (e.askNow) return "A few things look different from your usual. When you have a moment, have a look.";
  return "I'm keeping an eye on your rhythm. Nothing is needed from you.";
}

/** One sentence for "Your own level". */
export function weeklyInsight(e: PassiveView): string {
  if (e.learning) return `Still learning your usual rhythm: ${e.daysOfData} of ${LEARNING_DAYS} days so far.`;
  const phrases = e.changed.map((m) => m.phrase).filter((p): p is string => !!p);
  if (!phrases.length) return "Lately your rhythm looks like your usual.";
  const line = `Over the last week ${joinPhrases(phrases)} than in the four weeks before.`;
  return typingAloneChanged(e) ? `${line} Typing alone never makes me ask.` : line;
}

/** One small thing to try after "Not my best", picked from what changed. */
export function suggestionFor(e: PassiveView): SuggestionId {
  const keys = new Set(e.changed.map((m) => `${m.key}:${m.direction}`));
  if (keys.has("firstActivity:up") || keys.has("quietNight:down")) return "morning-light";
  if (keys.has("lastActivity:up")) return "regular-bedtime";
  if ([...keys].some((k) => k.startsWith("spread") || k.startsWith("pauses") || k.startsWith("hold"))) return "walk";
  return "music";
}
