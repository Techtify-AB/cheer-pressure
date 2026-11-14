// Made-up entries for trying the app. Everything Cheri's rule reads, in the four categories,
// is the replay's eight weeks (lib/replay.ts), ending today: six steady weeks, then sleep
// slips first (shorter nights), movement in front of the camera drops, and the daily answers
// lean towards "Not so good" in the last days; typing drifts only a little and messages with
// the person they trust stay as usual. The entries from earlier versions (bedtimes, weekly
// answers, reaction times) cover the same eight weeks with a final drifting week; only the
// weekly answers are still shown, in the clinic report. Everything is tagged source "demo" so
// it can be cleared on its own.
//
// What helps, told by the same made-up weeks (lib/helps.ts learns it from the values): two
// rough patches in the steady weeks (fewer messages and "Not so good" on days 19 to 21; later
// mornings and looser typing on days 31 to 33), each followed by letting the daylight in on
// days 22 and 34 and by days back within the usual, and the person said yes both times (the two
// signals agree). Music on day 51, in the middle of the drift: the person said it helped, but
// the days that followed stayed about as far from the usual (no clear change). A short walk
// yesterday: too early to tell. The replay itself (lib/replay.ts) is left exactly as it was.

import { addDays, minutesToClock, shiftClock } from "./dates";
import { makeReplayData } from "./replay";
import type { ActivityDone, DailyEntry, ReactionResult, Scale03, TypingSession, WeeklyEntry } from "./types";
import type { ReplayData } from "./replay";

const DAYS = 56;
const DRIFT_DAYS = 6; // the last six days before today

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function makeDemoData(today: string, earlySigns: string[]) {
  const rand = rng(20261114);
  const jitter = (spread: number) => (rand() + rand() + rand() - 1.5) * spread;
  const now = new Date().toISOString();

  const daily: DailyEntry[] = [];
  for (let i = DAYS; i >= 1; i--) {
    const date = addDays(today, -i);
    const drift = i <= DRIFT_DAYS ? (DRIFT_DAYS + 1 - i) / DRIFT_DAYS : 0; // 0 normally, up to 1 on the last day
    const inDrift = i <= DRIFT_DAYS;
    if (!inDrift && rand() < 0.1) continue; // a few ordinary missed days
    const bedMin = 23 * 60 + 5 + jitter(40) + (inDrift ? 55 + drift * 50 : 0);
    const wakeMin = 7 * 60 + 5 + jitter(30) + (inDrift ? 25 + drift * 25 : 0);
    const formBase = inDrift ? 2.7 - drift * 0.8 : 3.7;
    const form = clamp(Math.round(formBase + jitter(1.2)), 1, 5) as DailyEntry["form"];
    const speech = inDrift ? 2.25 - drift * 0.2 + jitter(0.2) : 2.75 + jitter(0.25);
    daily.push({
      id: `demo-d-${date}`,
      date,
      bedtime: minutesToClock(bedMin),
      wakeTime: minutesToClock(wakeMin),
      form,
      speechRate: rand() < 0.08 && !inDrift ? null : Math.round(speech * 100) / 100,
      source: "demo",
      savedAt: now,
    });
  }

  const weekly: WeeklyEntry[] = [];
  for (let w = 7; w >= 0; w--) {
    const date = addDays(today, -(1 + w * 7));
    const last = w === 0;
    const pick = (normal: number[], drifted: number): Scale03 =>
      (last ? drifted : normal[Math.floor(rand() * normal.length)]) as Scale03;
    weekly.push({
      id: `demo-w-${date}`,
      date,
      down: pick([0, 0, 1], 2),
      interest: pick([0, 1, 0], 2),
      sleep: pick([0, 1, 1], 2),
      tense: pick([1, 0, 1], 2),
      signs: earlySigns.map((sign) => ({ sign, value: pick([0, 0, 1], 2) })),
      source: "demo",
      savedAt: now,
    });
  }

  const reaction: ReactionResult[] = [];
  for (const i of [40, 33, 26, 19, 12, 3]) {
    const date = addDays(today, -i);
    const base = i <= DRIFT_DAYS ? 345 : 290;
    const trialsMs = Array.from({ length: 5 }, () => Math.round(base + jitter(60)));
    const sorted = [...trialsMs].sort((a, b) => a - b);
    reaction.push({ id: `demo-r-${date}`, date, trialsMs, medianMs: sorted[2], source: "demo", savedAt: now });
  }

  // The four categories: the replay's eight weeks, ending today, so "Load demo data" and
  // "Eight weeks in 20 seconds" tell the same story.
  const { typingDays, activityDays, dailyAnswers, movementSessions, contactDays } = withRoughPatches(makeReplayData(today), today);
  const typingSessions: TypingSession[] = [];
  const activitiesDone = demoActivitiesDone(today, now);

  return { daily, weekly, reaction, typingSessions, typingDays, activityDays, dailyAnswers, movementSessions, contactDays, activitiesDone };
}

/** The replay's day number (1 to 56, today is 56) as a date. */
const onDay = (today: string, day: number) => addDays(today, day - 56);

/** The days of the two rough patches, and what each one changes. */
export const ROUGH_PATCHES = [
  { days: [19, 20, 21], kind: "quiet" as const },
  { days: [31, 32, 33], kind: "late" as const },
];

/** The activities done in the made-up weeks, with the person's own answer. */
export const DEMO_ACTIVITIES: { day: number; activity: string; feedback: ActivityDone["feedback"] }[] = [
  { day: 22, activity: "daylight", feedback: "yes" },
  { day: 34, activity: "daylight", feedback: "yes" },
  { day: 51, activity: "song", feedback: "yes" },
  { day: 55, activity: "outside", feedback: null },
];

/**
 * The two rough patches, on top of the replay's days: "quiet" is no messages, a "Not so good"
 * answer and looser typing; "late" is later mornings and longer key holds. Neither touches the
 * evenings or the movement that carry the drift at the end, so the rule still asks as before.
 */
export function withRoughPatches(r: ReplayData, today: string): ReplayData {
  const dates = (kind: "quiet" | "late") => new Set(ROUGH_PATCHES.filter((p) => p.kind === kind).flatMap((p) => p.days.map((d) => onDay(today, d))));
  const quiet = dates("quiet");
  const late = dates("late");
  const answered = new Set(r.dailyAnswers.map((a) => a.date));
  return {
    ...r,
    contactDays: r.contactDays.map((c) => (quiet.has(c.date) ? { ...c, exchanged: 0 } : c)),
    dailyAnswers: [
      ...r.dailyAnswers.map((a) => (quiet.has(a.date) ? { ...a, answer: "not-so-good" as const } : a)),
      ...[...quiet].filter((d) => !answered.has(d)).map((date) => ({ date, answer: "not-so-good" as const, dismissed: false, at: "", source: "demo" as const })),
    ].sort((a, b) => a.date.localeCompare(b.date)),
    typingDays: r.typingDays.map((t) =>
      quiet.has(t.date) && t.spreadMs !== null
        ? { ...t, spreadMs: t.spreadMs + 40 }
        : late.has(t.date) && t.holdMs !== null
          ? { ...t, holdMs: t.holdMs + 25 }
          : t,
    ),
    activityDays: r.activityDays.map((d) => (late.has(d.date) ? { ...d, first: shiftClock(d.first, 110) } : d)),
  };
}

export function demoActivitiesDone(today: string, now = new Date().toISOString()): ActivityDone[] {
  return DEMO_ACTIVITIES.map((a) => ({
    id: `demo-a-${a.day}-${a.activity}`,
    activity: a.activity,
    date: onDay(today, a.day),
    at: now,
    easier: false,
    endedEarly: false,
    feedback: a.feedback,
    source: "demo" as const,
  }));
}
