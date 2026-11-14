// Raw sleep samples from the phone's health data, reduced to one record per night. Pure code, no
// React Native imports, so scripts/test-phone.mts can test it from the repository root.
//
// THE REDUCTION (keep it explainable):
// - Each source (a watch, a sleep app, the phone's own sleep feature) is reduced on its own, and
//   per night the source with the most time asleep wins (then the most time in bed). Sources are
//   never mixed in one night, so two sources recording the same night never count it twice. Which
//   source won is not kept: the record has no app name.
// - Samples of one source that touch or lie within 30 minutes of each other form one stretch.
// - A night belongs to the morning it ends: the stretches that start between 12:00 the day before
//   and 12:00 that day. Its main stretch is the longest one whose middle lies between 20:00 and
//   10:00; stretches within 90 minutes of it join it (woke up for a while, then slept again).
//   Anything else is a nap and is left out. A day with no such stretch has no night (missing, not 0).
// - Asleep minutes: the union of the asleep samples (all stages), or null when the source only
//   records time in bed. Bedtime: the first sample of the night. Wake: the end of the last asleep
//   sample, else of the last in-bed sample. Times awake: awake samples between falling asleep and
//   waking, only when the source records awake samples (null otherwise).

/** The stages HealthKit (and later Health Connect) give, reduced to three. */
export type SleepStage = "inBed" | "asleep" | "awake";

export interface RawSleepSample {
  /** Milliseconds since 1970. */
  start: number;
  end: number;
  stage: SleepStage;
  /** Keeps sources apart while reducing; never part of the result. */
  source: string;
  /** Written by the development build's "Add eight made-up weeks to Health". */
  madeUp?: boolean;
}

/** One night, as lib/types.ts HealthNight and lib/phone.ts PhoneNight. */
export interface ReducedNight {
  date: string;
  bedtime: string;
  wake: string;
  asleepMinutes: number | null;
  inBedMinutes: number | null;
  awakenings: number | null;
  source: "user" | "demo";
}

const MIN = 60_000;
export const STRETCH_GAP_MIN = 30;
export const JOIN_GAP_MIN = 90;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The morning a stretch starting at `ms` belongs to: starts from 12:00 on go to the next day. */
function nightOf(ms: number): string {
  const d = new Date(ms);
  if (d.getHours() >= 12) d.setDate(d.getDate() + 1);
  return localDay(d.getTime());
}

/** True when the middle of [start, end] lies between 20:00 and 10:00 local time. */
function nightish(start: number, end: number): boolean {
  const h = new Date((start + end) / 2).getHours();
  return h >= 20 || h < 10;
}

interface Stretch {
  start: number;
  end: number;
  samples: RawSleepSample[];
}

/** The total length of the union of some intervals, in minutes. */
export function unionMinutes(intervals: { start: number; end: number }[]): number {
  return mergeIntervals(intervals, 0).reduce((a, i) => a + (i.end - i.start), 0) / MIN;
}

function mergeIntervals(intervals: { start: number; end: number }[], gapMs: number): { start: number; end: number }[] {
  const sorted = [...intervals].filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end + gapMs) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

function stretchesOf(samples: RawSleepSample[]): Stretch[] {
  const sorted = [...samples].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const out: Stretch[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end + STRETCH_GAP_MIN * MIN) {
      last.end = Math.max(last.end, s.end);
      last.samples.push(s);
    } else out.push({ start: s.start, end: s.end, samples: [s] });
  }
  return out;
}

function nightFrom(date: string, samples: RawSleepSample[]): ReducedNight {
  const asleep = samples.filter((s) => s.stage === "asleep");
  const inBed = samples.filter((s) => s.stage === "inBed");
  const awake = samples.filter((s) => s.stage === "awake");
  const bedtime = Math.min(...samples.map((s) => s.start));
  const wake = asleep.length ? Math.max(...asleep.map((s) => s.end)) : Math.max(...inBed.map((s) => s.end));
  let awakenings: number | null = null;
  if (awake.length && asleep.length) {
    const first = Math.min(...asleep.map((s) => s.start));
    const last = Math.max(...asleep.map((s) => s.end));
    awakenings = mergeIntervals(awake, 0).filter((a) => a.start >= first && a.end <= last).length;
  }
  return {
    date,
    bedtime: localClock(bedtime),
    wake: localClock(wake),
    asleepMinutes: asleep.length ? Math.round(unionMinutes(asleep)) : null,
    inBedMinutes: inBed.length ? Math.round(unionMinutes(inBed)) : null,
    awakenings,
    source: samples.every((s) => s.madeUp) ? "demo" : "user",
  };
}

/** One source's nights, by morning. */
function nightsOfSource(samples: RawSleepSample[]): Map<string, ReducedNight> {
  const byNight = new Map<string, Stretch[]>();
  for (const st of stretchesOf(samples)) {
    const key = nightOf(st.start);
    byNight.set(key, [...(byNight.get(key) ?? []), st]);
  }
  const out = new Map<string, ReducedNight>();
  for (const [date, stretches] of byNight) {
    const length = (s: Stretch) => s.end - s.start;
    const main = stretches.filter((s) => nightish(s.start, s.end)).sort((a, b) => length(b) - length(a))[0];
    if (!main) continue;
    // Join the stretches close to the night, growing it as they join.
    const night = { start: main.start, end: main.end, samples: [...main.samples] };
    let grew = true;
    const rest = stretches.filter((s) => s !== main);
    while (grew) {
      grew = false;
      for (let i = rest.length - 1; i >= 0; i--) {
        const s = rest[i];
        const gap = s.start > night.end ? s.start - night.end : night.start > s.end ? night.start - s.end : 0;
        if (gap <= JOIN_GAP_MIN * MIN) {
          night.start = Math.min(night.start, s.start);
          night.end = Math.max(night.end, s.end);
          night.samples.push(...s.samples);
          rest.splice(i, 1);
          grew = true;
        }
      }
    }
    if (!night.samples.some((s) => s.stage !== "awake")) continue;
    out.set(date, nightFrom(date, night.samples));
  }
  return out;
}

/**
 * Raw samples to one record per night, from `since` (a morning, "YYYY-MM-DD") on, oldest first.
 * Tonight's night, still going, is left out until it has ended (`now`).
 */
export function reduceNights(samples: RawSleepSample[], opts: { since?: string; now?: number } = {}): ReducedNight[] {
  const now = opts.now ?? Date.now();
  const bySource = new Map<string, RawSleepSample[]>();
  for (const s of samples) {
    if (s.end > now) continue;
    bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);
  }
  const best = new Map<string, ReducedNight>();
  const score = (n: ReducedNight) => [n.asleepMinutes ?? -1, n.inBedMinutes ?? -1];
  for (const list of bySource.values()) {
    for (const [date, n] of nightsOfSource(list)) {
      const cur = best.get(date);
      if (!cur) {
        best.set(date, n);
        continue;
      }
      const [a1, b1] = score(n);
      const [a2, b2] = score(cur);
      if (a1 > a2 || (a1 === a2 && b1 > b2)) best.set(date, n);
    }
  }
  return [...best.values()].filter((n) => !opts.since || n.date >= opts.since).sort((a, b) => a.date.localeCompare(b.date));
}

/** One number per full day for steps, from day buckets (midnight to midnight). Today is left out. */
export function reduceSteps(
  buckets: { start: number; steps: number }[],
  opts: { since?: string; today: string; madeUpDays?: Set<string> },
): { date: string; steps: number; source: "user" | "demo" }[] {
  const byDay = new Map<string, number>();
  for (const b of buckets) {
    const day = localDay(b.start);
    if (day >= opts.today || (opts.since && day < opts.since)) continue;
    if (!(b.steps > 0)) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + b.steps);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, steps]) => ({ date, steps: Math.round(steps), source: opts.madeUpDays?.has(date) ? "demo" : "user" }));
}
