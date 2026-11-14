// Compares the person with their own earlier entries. Never with anyone else.
//
// "Recent" is the last 7 days (today included). "Usual" (the baseline) is the
// person's entries from the 8 weeks before that. Weekly answers compare the
// newest answer with the earlier ones.

import { addDays, clockToMinutes, clockToNightMinutes, minutesToClock, nightMinutesToClock, sleepHours } from "./dates";
import type { AppData, DayKey, Scale03, WeeklyEntry } from "./types";

export const RECENT_DAYS = 7;
/** Fewest entries in the last 7 days before they are compared with the usual level. */
export const MIN_RECENT_ENTRIES = 3;
export const CHART_DAYS = 14;
const BASELINE_DAYS = 56;
const MIN_BASELINE = 5;

export type MetricKey = "bedtime" | "wake" | "sleep" | "form" | "speech" | "reaction";
export type Direction = "up" | "down" | "steady";

export interface Summary {
  median: number;
  low: number; // 25th percentile
  high: number; // 75th percentile
  n: number;
}

export interface MetricLevel {
  key: MetricKey;
  label: string;
  /** Plain meaning of the number, shown next to it. */
  meaning: string;
  format: (v: number) => string;
  series: { date: DayKey; value: number | null }[];
  usual: Summary | null;
  recent: Summary | null;
  /** Every value from the last 7 days, oldest first, also when there are too few to compare. */
  recentValues: number[];
  /** recent median minus usual median, in the metric's own unit. */
  delta: number | null;
  /** Whether the change is big enough to mention. */
  direction: Direction | null;
  experimental?: boolean;
}

export interface WeeklyItemLevel {
  key: string;
  label: string;
  latest: Scale03;
  usual: number | null; // median of earlier answers
  direction: Direction | null;
}

export interface WeeklyLevel {
  latest: WeeklyEntry | null;
  /** True when the newest weekly answer is from the last 10 days. */
  latestIsRecent: boolean;
  items: WeeklyItemLevel[];
}

export interface Levels {
  today: DayKey;
  metrics: MetricLevel[];
  weekly: WeeklyLevel;
  /** Enough history to compare at all. */
  hasBaseline: boolean;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function summarise(values: number[]): Summary | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return { median: quantile(s, 0.5), low: quantile(s, 0.25), high: quantile(s, 0.75), n: s.length };
}

export function median(values: number[]): number {
  return summarise(values)?.median ?? 0;
}

interface MetricDef {
  key: MetricKey;
  label: string;
  meaning: string;
  format: (v: number) => string;
  /** Change at or above this size (absolute, in the unit) counts as a change. */
  threshold: (usual: Summary) => number;
  experimental?: boolean;
}

const DEFS: Record<MetricKey, MetricDef> = {
  bedtime: {
    key: "bedtime",
    label: "Bedtime",
    meaning: "When you went to bed",
    format: nightMinutesToClock,
    threshold: () => 30,
  },
  wake: {
    key: "wake",
    label: "Wake time",
    meaning: "When you woke up",
    format: minutesToClock,
    threshold: () => 30,
  },
  sleep: {
    key: "sleep",
    label: "Hours of sleep",
    meaning: "Time from bedtime to waking",
    format: (v) => `${v.toFixed(1)} h`,
    threshold: () => 1,
  },
  form: {
    key: "form",
    label: "Form",
    meaning: "Your own 1 to 5 rating of the day",
    format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
    threshold: () => 1,
  },
  speech: {
    key: "speech",
    label: "Reading pace",
    meaning: "Words per second when reading the sentence aloud",
    format: (v) => `${v.toFixed(1)} words/s`,
    threshold: (u) => Math.max(0.25, u.median * 0.12),
  },
  reaction: {
    key: "reaction",
    label: "Reaction time",
    meaning: "Middle of your five taps, in milliseconds. Lower is quicker",
    format: (v) => `${Math.round(v)} ms`,
    threshold: (u) => Math.max(30, u.median * 0.12),
    experimental: true,
  },
};

function valuesByDay(data: AppData, key: MetricKey): Map<DayKey, number> {
  const map = new Map<DayKey, number>();
  if (key === "reaction") {
    for (const r of data.reaction) map.set(r.date, r.medianMs); // last test of a day wins
    return map;
  }
  for (const e of data.daily) {
    let v: number | null = null;
    if (key === "bedtime") v = clockToNightMinutes(e.bedtime);
    else if (key === "wake") v = clockToMinutes(e.wakeTime);
    else if (key === "sleep") v = sleepHours(e.bedtime, e.wakeTime);
    else if (key === "form") v = e.form;
    else if (key === "speech") v = e.speechRate;
    if (v !== null && Number.isFinite(v)) map.set(e.date, v);
  }
  return map;
}

export function minRecentFor(key: MetricKey): number {
  return key === "reaction" ? 1 : MIN_RECENT_ENTRIES;
}

function metricLevel(data: AppData, def: MetricDef, today: DayKey): MetricLevel {
  const byDay = valuesByDay(data, def.key);
  const recentStart = addDays(today, -(RECENT_DAYS - 1));
  const baselineStart = addDays(recentStart, -BASELINE_DAYS);
  const recentDated: [DayKey, number][] = [];
  const usualVals: number[] = [];
  for (const [date, v] of byDay) {
    if (date >= recentStart && date <= today) recentDated.push([date, v]);
    else if (date >= baselineStart && date < recentStart) usualVals.push(v);
  }
  const recentVals = recentDated.sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  const series = Array.from({ length: CHART_DAYS }, (_, i) => {
    const date = addDays(today, i - (CHART_DAYS - 1));
    return { date, value: byDay.get(date) ?? null };
  });
  const minBase = def.key === "reaction" ? 2 : MIN_BASELINE;
  const minRecent = minRecentFor(def.key);
  const usual = usualVals.length >= minBase ? summarise(usualVals) : null;
  const recent = recentVals.length >= minRecent ? summarise(recentVals) : null;
  let delta: number | null = null;
  let direction: Direction | null = null;
  if (usual && recent) {
    delta = recent.median - usual.median;
    const t = def.threshold(usual);
    direction = delta >= t ? "up" : delta <= -t ? "down" : "steady";
  }
  return {
    key: def.key,
    label: def.label,
    meaning: def.meaning,
    format: def.format,
    series,
    usual,
    recent,
    recentValues: recentVals,
    delta,
    direction,
    experimental: def.experimental,
  };
}

const WEEKLY_ITEMS: { key: "down" | "interest" | "sleep" | "tense"; label: string }[] = [
  { key: "down", label: "Feeling down or hopeless" },
  { key: "interest", label: "Little interest or pleasure" },
  { key: "sleep", label: "Trouble with sleep" },
  { key: "tense", label: "Feeling tense" },
];

function weeklyLevel(data: AppData, today: DayKey): WeeklyLevel {
  const list = data.weekly;
  const latest = list.length ? list[list.length - 1] : null;
  if (!latest) return { latest: null, latestIsRecent: false, items: [] };
  const earlier = list.slice(0, -1).slice(-8);
  const latestIsRecent = latest.date >= addDays(today, -10);
  const item = (key: string, label: string, value: Scale03, history: number[]): WeeklyItemLevel => {
    const usual = history.length >= 2 ? median(history) : null;
    let direction: Direction | null = null;
    if (usual !== null) direction = value - usual >= 1 ? "up" : usual - value >= 1 ? "down" : "steady";
    return { key, label, latest: value, usual, direction };
  };
  const items = WEEKLY_ITEMS.map((w) =>
    item(w.key, w.label, latest[w.key], earlier.map((e) => e[w.key])),
  );
  for (const s of latest.signs) {
    const history = earlier.flatMap((e) => e.signs.filter((x) => x.sign === s.sign).map((x) => x.value));
    items.push(item(`sign:${s.sign}`, s.sign, s.value, history));
  }
  return { latest, latestIsRecent, items };
}

export function computeLevels(data: AppData, today: DayKey): Levels {
  const metrics = (Object.keys(DEFS) as MetricKey[]).map((k) => metricLevel(data, DEFS[k], today));
  return {
    today,
    metrics,
    weekly: weeklyLevel(data, today),
    hasBaseline: metrics.some((m) => m.usual !== null),
  };
}

export const WEEKLY_ITEM_LABELS = WEEKLY_ITEMS;
