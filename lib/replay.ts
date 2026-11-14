// "Eight weeks in 20 seconds": made-up days for the demo replay, and the real rule run on
// them day by day.
//
// The usual is the 28 days before the last week, and recent is the last week (lib/passive.ts),
// so six weeks could not hold a learning period, a full usual and a clear week of change with
// any margin. The replay is eight weeks: six steady, then the drift.
//
// Steady weeks have the ordinary ups and downs of a real person: weekends start and end
// later and have less typing, some days are spent away from the computer, some days have
// too little writing to count (under 300 presses), and every day wobbles a little. In week
// seven the drift begins, one category after the other:
//
// 1. Sleep slips first: from day 43 the evenings run later while the mornings barely move, so
//    the estimated nights get shorter, quickly (sleepDriftOn).
// 2. Then movement drops: from day 45 there is less movement and fewer position changes in
//    front of the camera (movementDriftOn).
// 3. The person's own daily answers lean towards "Not so good" in the last days, from day 47
//    (answerDriftOn).
//
// Typing drifts only a little and never carries the story; messages with the person they trust
// stay as they were. The rule (two different categories, no category alone) asks once Sleep and
// Energy have both changed.
//
// Nothing here decides what the replay shows. Each frame is `evaluatePassive` from
// lib/passive.ts on the data up to that day, exactly as the app runs it on real data.

import { addDays, daysBetween, minutesToClock } from "./dates";
import { evaluatePassive, isWeekend, type ChangeTest, type Evaluation } from "./passive";
import type { ActivityDay, AppData, ContactDay, DailyAnswer, DayKey, StoredMovementSession, TypingDay } from "./types";

export const REPLAY_DAYS = 56;
/** Days 1 to 42 are steady; the drift begins on day 43. */
export const STEADY_DAYS = 42;
/** The drift reaches its full size this many days after it began. */
export const DRIFT_RAMP_DAYS = 7;
/** The whole run, if it plays to the end. */
export const REPLAY_RUN_MS = 20_000;
export const REPLAY_MS_PER_DAY = Math.round(REPLAY_RUN_MS / REPLAY_DAYS);
/** Fixed, so every run shows the same eight weeks (chosen with scripts/test-ladder.mts: every weekday asks on Sleep and Energy). */
export const REPLAY_SEED = 238;
/** Movement starts to drop this many days after sleep has started to slip. */
export const MOVEMENT_LAG_DAYS = 2;
/** The daily answers start to lean towards "Not so good" this many days after sleep. */
export const ANSWER_LAG_DAYS = 4;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface ReplayData {
  typingDays: TypingDay[];
  activityDays: ActivityDay[];
  /** Answers to the daily question; some days are not answered. */
  dailyAnswers: DailyAnswer[];
  /** Stretches with the camera on; on many days it is not on at all. */
  movementSessions: StoredMovementSession[];
  /** Messages with the person they trust, per day (Social). */
  contactDays: ContactDay[];
}

export interface DriftShape {
  /** The last steady day. */
  steadyDays: number;
  /** How many days the replay has. */
  days: number;
}

const DEFAULT_SHAPE: DriftShape = { steadyDays: STEADY_DAYS, days: REPLAY_DAYS };

/** Typing drifts gradually: 0 while steady, then 1/7, 2/7 ... and 1 from a week after it began. */
export function driftOn(day: number, steadyDays = STEADY_DAYS): number {
  return day <= steadyDays ? 0 : Math.min(1, (day - steadyDays) / DRIFT_RAMP_DAYS);
}

/** Sleep slips first: faster than driftOn (0.38 on its first day, 0.65 on its third, 1 after a week). */
export function sleepDriftOn(day: number, steadyDays = STEADY_DAYS): number {
  return Math.sqrt(driftOn(day, steadyDays));
}

/** Movement drops next: like sleep, but MOVEMENT_LAG_DAYS later. */
export function movementDriftOn(day: number, steadyDays = STEADY_DAYS): number {
  return Math.sqrt(driftOn(day, steadyDays + MOVEMENT_LAG_DAYS));
}

/** The daily answers lean towards "Not so good" last, gradually, from ANSWER_LAG_DAYS after sleep. */
export function answerDriftOn(day: number, steadyDays = STEADY_DAYS): number {
  return driftOn(day, steadyDays + ANSWER_LAG_DAYS);
}

/** The made-up days. Day 1 is `days - 1` days before `lastDay`. */
export function makeReplayData(lastDay: DayKey, seed = REPLAY_SEED, shape: DriftShape = DEFAULT_SHAPE): ReplayData {
  const rand = rng(seed);
  // Roughly bell-shaped noise in [-1.5, 1.5] * spread.
  const noise = (spread: number) => (rand() + rand() + rand() - 1.5) * spread;
  const typingDays: TypingDay[] = [];
  const activityDays: ActivityDay[] = [];
  const dailyAnswers: DailyAnswer[] = [];
  // Their own random numbers, so adding answers and movement left the other measures as they were.
  const ask = rng(seed + 707);
  const cam = rng(seed + 104729);
  const camNoise = (spread: number) => (cam() + cam() + cam() - 1.5) * spread;
  const movementSessions: StoredMovementSession[] = [];
  const mover = { level: 0.06 + camNoise(0.012), shifts: 8 + camNoise(2) };
  const talk = rng(seed + 15485863);
  const contactDays: ContactDay[] = [];
  const chatty = 1.5 + talk() * 2.5;
  const round = (v: number) => Math.round(v * 10) / 10;
  // This person's own levels.
  const person = { spread: 88 + noise(10), hold: 94 + noise(8), first: 7 * 60 + 15 + noise(20), last: 22 * 60 + 50 + noise(20) };

  for (let day = 1; day <= shape.days; day++) {
    const date = addDays(lastDay, day - shape.days);
    const weekend = isWeekend(date);
    const drift = driftOn(day, shape.steadyDays);
    const sleepDrift = sleepDriftOn(day, shape.steadyDays);
    const moveDrift = movementDriftOn(day, shape.steadyDays);
    const answerDrift = answerDriftOn(day, shape.steadyDays);
    const steady = drift === 0;

    // Typing: on weekends less of it, and a little looser.
    const away = rand() < (weekend ? 0.3 : 0.08);
    const presses = Math.round((weekend ? 150 + rand() * 1100 : 450 + rand() * 2400) * (steady ? 1 : 1));
    if (!away) {
      const enough = presses >= 300;
      // Only a little drift: typing is a small part of Energy and never what the story rests on.
      const spread = person.spread + (weekend ? 7 : 0) + noise(14) + drift * 6;
      const hold = person.hold + (weekend ? 2 : 0) + noise(7) + drift * 1.5;
      typingDays.push({
        date,
        kind: "all",
        measuredIn: "computer",
        presses,
        bursts: Math.max(1, Math.round(presses / 90)),
        spreadMs: enough ? round(spread) : null,
        holdMs: enough ? round(hold) : null,
        thinkingPer100: enough ? round(4 + noise(2.5)) : null,
        source: "demo",
        savedAt: "",
      });
    }

    // Day and night rhythm: weekends start and end later. As sleep slips, the evenings run
    // much later and the mornings start a little earlier, so the estimated night gets shorter.
    const noActivity = rand() < (weekend ? 0.12 : 0.05);
    if (!noActivity) {
      const first = person.first + noise(38) + (weekend ? 55 : 0) - sleepDrift * 10;
      const last = person.last + noise(34) + (weekend ? 35 : 0) + sleepDrift * 105;
      activityDays.push({ date, first: minutesToClock(first), last: minutesToClock(last), source: "demo" });
    }

    // Movement: the camera is on most days, for a while; less movement and fewer position
    // changes once movement starts to drop, after sleep.
    if (cam() < (weekend ? 0.55 : 0.85)) {
      const minutes = Math.round(20 + cam() * 200);
      const level = Math.max(0.005, mover.level + (weekend ? 0.006 : 0) + camNoise(0.016) - moveDrift * 0.03);
      const shifts = Math.max(0, mover.shifts + camNoise(3) - moveDrift * 3.5);
      movementSessions.push({ date, minutes, movementMean: Math.round(level * 1000) / 1000, shiftsPerHour: Math.round(shifts * 10) / 10, source: "demo", savedAt: "" });
    }

    // Social: a few messages most days with the person they trust, as usual all along.
    {
      const mean = chatty * (weekend ? 1.3 : 1);
      let n = 0;
      for (let k = 0; k < 8; k++) if (talk() < mean / 8) n++;
      contactDays.push({ date, exchanged: n, source: "demo" });
    }

    // The daily question: answered on about two days in three; "Not so good" now and then,
    // more often in the last days (after sleep and movement).
    if (ask() < (weekend ? 0.55 : 0.75)) {
      const low = 0.1 + 0.5 * answerDrift;
      const r = ask();
      const answer = r < low ? "not-so-good" : r < low + (1 - low) * 0.5 ? "okay" : "good";
      dailyAnswers.push({ date, answer, dismissed: false, at: "", source: "demo" });
    }
  }
  return { typingDays, activityDays, dailyAnswers, movementSessions, contactDays };
}

export interface ReplayFrame {
  /** 1 to REPLAY_DAYS. */
  day: number;
  date: DayKey;
  /** The real rule on the data up to and including this day. */
  evaluation: Evaluation;
  /** The data the rule saw, for wording the explanation the same way the app does. */
  data: AppData;
}

function asAppData(r: ReplayData): AppData {
  return {
    version: 1,
    profile: { createdAt: "", earlySigns: [] },
    daily: [],
    weekly: [],
    reaction: [],
    typingSessions: [],
    typingDays: r.typingDays,
    activityDays: r.activityDays,
    dailyAnswers: r.dailyAnswers,
    movementSessions: r.movementSessions,
    contactDays: r.contactDays,
    checkIns: [],
    settings: { muted: false },
    ladder: null,
  };
}

/** Only the days up to and including `date`. */
export function upTo(r: ReplayData, date: DayKey): ReplayData {
  return {
    typingDays: r.typingDays.filter((s) => s.date <= date),
    activityDays: r.activityDays.filter((d) => d.date <= date),
    dailyAnswers: r.dailyAnswers.filter((d) => d.date <= date),
    movementSessions: r.movementSessions.filter((d) => d.date <= date),
    contactDays: r.contactDays.filter((d) => d.date <= date),
  };
}

/** Runs the rule once per day, on the data up to that day. */
export function replayFrames(r: ReplayData, lastDay: DayKey, opts: { days?: number; test?: ChangeTest } = {}): ReplayFrame[] {
  const days = opts.days ?? REPLAY_DAYS;
  return Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const date = addDays(lastDay, day - days);
    const data = asAppData(upTo(r, date));
    return { day, date, evaluation: evaluatePassive(data, date, { test: opts.test }), data };
  });
}

/** The first day the rule asks, or null. */
export function firstAsk(frames: ReplayFrame[]): ReplayFrame | null {
  return frames.find((f) => f.evaluation.askNow) ?? null;
}

/** Moves every date `days` later (negative is earlier). Weekdays stay weekdays when `days` is a multiple of 7. */
export function shiftReplay(r: ReplayData, days: number): ReplayData {
  return {
    typingDays: r.typingDays.map((s) => ({ ...s, date: addDays(s.date, days) })),
    activityDays: r.activityDays.map((d) => ({ ...d, date: addDays(d.date, days) })),
    dailyAnswers: r.dailyAnswers.map((d) => ({ ...d, date: addDays(d.date, days) })),
    movementSessions: r.movementSessions.map((d) => ({ ...d, date: addDays(d.date, days) })),
    contactDays: r.contactDays.map((d) => ({ ...d, date: addDays(d.date, days) })),
  };
}

/**
 * The replay placed so that the day the rule asks is `today`, for "See what it asks". The rule
 * compares weekdays with weekdays, so the days are made for those dates rather than moved.
 */
export function replayEndingOn(today: DayKey): { data: ReplayData; lastDay: DayKey; stopDay: number } | null {
  for (let ahead = 0; ahead < REPLAY_DAYS; ahead++) {
    const lastDay = addDays(today, ahead);
    const data = makeReplayData(lastDay);
    const stop = firstAsk(replayFrames(data, lastDay));
    if (stop && daysBetween(stop.date, today) === 0) return { data, lastDay, stopDay: stop.day };
  }
  return null;
}
