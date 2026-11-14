// The daily hello (/hello/): when it comes, and what its readings add up to. Pure code on top of
// lib/daily.ts, which decides the same thing for the daily question on Home and in the desktop
// app's bubble. All of them store to the same place (dailyAnswers), so a day answered in one is
// never asked again in another. On the phone the reminder is a notification planned by
// lib/phone.ts (planNotifications) from the very same settings and answers.
//
// - Every day for the first two weeks when the person chose it, then as often as they chose.
// - Never in quiet hours, never twice a day, and a missed day is never stacked up.
//
// Readings: each hello may leave a few numbers (face movement through lib/camera/faceModel.ts,
// tone of voice through lib/voice), stored per day as this person's own values. Their usual (the
// neutral state) exists once LEARNING_DAYS different days have readings; until then the screen
// says it is still learning. Never compared with anyone else.

import { addDays, dayKey, daysBetween } from "./dates";
import { questionDue, type DueReason } from "./daily";
import type { AppData, DayKey, HelloReading } from "./types";

/** Cheri ends the hello herself by then. */
export const HELLO_MAX_MS = 40_000;
/** The longest one hold to talk may last. */
export const HOLD_MAX_MS = 20_000;
/** Days with readings before this person's usual exists (two weeks of hellos). */
export const LEARNING_DAYS = 14;
/** The usual is taken from the readings of the last four weeks before today. */
export const USUAL_WINDOW_DAYS = 28;

/** The day the person started: their profile's creation day, if any. */
export function startedOnOf(data: Pick<AppData, "profile">): DayKey | undefined {
  return data.profile ? dayKey(new Date(data.profile.createdAt)) : undefined;
}

/** Whether today's hello is due now, and if not, why (the same rule as the daily question). */
export function helloDue(data: Pick<AppData, "profile" | "settings" | "dailyAnswers">, now: Date): { due: boolean; reason: DueReason | "no-profile" } {
  if (!data.profile) return { due: false, reason: "no-profile" };
  return questionDue({
    today: dayKey(now),
    minutesNow: now.getHours() * 60 + now.getMinutes(),
    settings: data.settings,
    answers: data.dailyAnswers ?? [],
    startedOn: startedOnOf(data),
  });
}

/** True when today already has an answer or a dismissal (from the hello, Home or the bubble). */
export function answeredOn(data: Pick<AppData, "dailyAnswers">, day: DayKey): boolean {
  return (data.dailyAnswers ?? []).some((a) => a.date === day);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** One value per day per named reading: the middle of that day's readings. */
export function dayValues(readings: HelloReading[]): Map<DayKey, Record<string, number>> {
  const byDay = new Map<DayKey, Map<string, number[]>>();
  for (const r of readings) {
    const all = { ...(r.face?.readings ?? {}), ...(r.tone?.readings ?? {}) };
    for (const [name, v] of Object.entries(all)) {
      if (!Number.isFinite(v)) continue;
      const day = byDay.get(r.date) ?? new Map<string, number[]>();
      day.set(name, [...(day.get(name) ?? []), v]);
      byDay.set(r.date, day);
    }
  }
  const out = new Map<DayKey, Record<string, number>>();
  for (const [day, m] of byDay) out.set(day, Object.fromEntries([...m].map(([k, xs]) => [k, median(xs)])));
  return out;
}

export interface HelloUsual {
  /** True until LEARNING_DAYS days before today have readings. */
  learning: boolean;
  /** Days before today with readings, in the last four weeks. */
  days: number;
  daysLeft: number;
  /** Per named reading: the middle and the usual range (the middle half), once learnt. */
  usual: Record<string, { median: number; low: number; high: number; n: number }>;
}

/** This person's own usual from the hello's readings, from the days before `today`. */
export function helloUsual(readings: HelloReading[], today: DayKey): HelloUsual {
  const from = addDays(today, -USUAL_WINDOW_DAYS);
  const days = [...dayValues(readings)].filter(([d]) => d < today && d >= from);
  const learning = days.length < LEARNING_DAYS;
  const usual: HelloUsual["usual"] = {};
  if (!learning) {
    const names = new Set(days.flatMap(([, v]) => Object.keys(v)));
    for (const name of names) {
      const xs = days.map(([, v]) => v[name]).filter((x): x is number => Number.isFinite(x)).sort((a, b) => a - b);
      if (xs.length < LEARNING_DAYS) continue;
      const q = (p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];
      usual[name] = { median: median(xs), low: q(0.25), high: q(0.75), n: xs.length };
    }
  }
  return { learning, days: days.length, daysLeft: Math.max(0, LEARNING_DAYS - days.length), usual };
}

/** How the readings are worded: an observation against this person's own usual, never a feeling. */
const WORDS: Record<string, { what: string; more: string; less: string }> = {
  animation: { what: "your face", more: "moved more than your usual", less: "moved less than your usual" },
  smilingShare: { what: "your mouth corners", more: "were raised more than your usual", less: "were raised less than your usual" },
  pitchVariability: { what: "your voice", more: "moved up and down more than your usual", less: "moved up and down less than your usual" },
  segmentsPerMinute: { what: "your speaking pace", more: "was quicker than your usual", less: "was slower than your usual" },
};

/** One plain line about today's reading against the person's usual, or the learning line. */
export function helloObservation(reading: HelloReading | null, u: HelloUsual): string | null {
  if (u.learning) return `I'm still learning your usual: ${u.days} of ${LEARNING_DAYS} days so far.`;
  if (!reading) return null;
  const all = { ...(reading.face?.readings ?? {}), ...(reading.tone?.readings ?? {}) };
  for (const [name, v] of Object.entries(all)) {
    const w = WORDS[name];
    const range = u.usual[name];
    if (!w || !range || !Number.isFinite(v)) continue;
    if (v > range.high) return `Today ${w.what} ${w.more}. Just an observation.`;
    if (v < range.low) return `Today ${w.what} ${w.less}. Just an observation.`;
  }
  return "Today looked like your usual.";
}

/** The day the hello's learning period ends for this person (two weeks from the start). */
export function learningEndsOn(data: Pick<AppData, "profile">): DayKey | null {
  const s = startedOnOf(data);
  return s ? addDays(s, LEARNING_DAYS) : null;
}

/** Days since the start, for wording ("day 3 of 14"). */
export function dayOfLearning(data: Pick<AppData, "profile">, today: DayKey): number | null {
  const s = startedOnOf(data);
  return s ? daysBetween(s, today) + 1 : null;
}

/** The reaction check at the end of the hello: at most this many times in seven days... */
export const REACTION_PER_WEEK = 2;

/**
 * Whether to offer the optional reaction check at the end of today's hello: at most twice in
 * seven days, and every day during the first two weeks only when the person agreed in
 * onboarding ("Include a 15-second reaction check"). Never twice on one day.
 */
export function reactionOffered(data: Pick<AppData, "profile" | "settings" | "helloReadings">, today: DayKey): boolean {
  const offered = (data.helloReadings ?? []).filter((r) => r.reactionOffered);
  if (offered.some((r) => r.date === today)) return false;
  const day = dayOfLearning(data, today);
  if (data.settings.helloReaction && day !== null && day <= LEARNING_DAYS) return true;
  const lastWeek = offered.filter((r) => daysBetween(r.date, today) < 7 && daysBetween(r.date, today) > 0);
  return lastWeek.length < REACTION_PER_WEEK;
}
