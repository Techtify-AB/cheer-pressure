// "Six weeks in 20 seconds": made-up days for the demo replay, and the real rule run
// on them day by day.
//
// The days are steady for five weeks, with the ordinary ups and downs of a real person
// (some days without the computer, a slightly later start on the sixth and seventh day
// of each week, uneven sessions). In the sixth week four measures drift, gradually:
// typing gets more uneven, pauses get longer, and the whole day starts and ends later.
//
// Nothing here decides what the replay shows. Each frame is `evaluatePassive` from
// lib/passive.ts on the data up to that day, exactly as the app runs it on real data.

import { addDays, minutesToClock } from "./dates";
import { evaluatePassive, type Evaluation } from "./passive";
import type { ActivityDay, AppData, DayKey, TypingSession } from "./types";

export const REPLAY_DAYS = 42;
/** Days 1 to 35 are steady; the drift is in days 36 to 42. */
export const STEADY_DAYS = 35;
/** The whole run, if it plays to the end. */
export const REPLAY_RUN_MS = 20_000;
export const REPLAY_MS_PER_DAY = Math.round(REPLAY_RUN_MS / REPLAY_DAYS);
/** Fixed, so every run shows the same six weeks. */
export const REPLAY_SEED = 78;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export interface ReplayData {
  typingSessions: TypingSession[];
  activityDays: ActivityDay[];
}

/** 0 for days 1 to 35, then 1/7, 2/7 ... up to 1 on day 42. */
export function driftOn(day: number): number {
  return day <= STEADY_DAYS ? 0 : (day - STEADY_DAYS) / (REPLAY_DAYS - STEADY_DAYS);
}

/** The made-up days. Day 1 is `REPLAY_DAYS - 1` days before `lastDay`. */
export function makeReplayData(lastDay: DayKey, seed = REPLAY_SEED): ReplayData {
  const rand = rng(seed);
  // Roughly bell-shaped noise in [-1.5, 1.5] * spread.
  const noise = (spread: number) => (rand() + rand() + rand() - 1.5) * spread;
  const typingSessions: TypingSession[] = [];
  const activityDays: ActivityDay[] = [];
  const round = (v: number) => Math.round(v * 10) / 10;

  for (let day = 1; day <= REPLAY_DAYS; day++) {
    const date = addDays(lastDay, day - REPLAY_DAYS);
    const drift = driftOn(day);
    const weekend = day % 7 === 6 || day % 7 === 0;
    // A day-level wobble: some days everything is a little slower.
    const dayFeel = noise(6);

    const offComputer = drift === 0 && rand() < 0.1;
    if (!offComputer) {
      const sessions = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < sessions; k++) {
        const presses = 250 + Math.round(rand() * 1200);
        const interval = 185 + dayFeel + noise(12) + drift * 30;
        typingSessions.push({
          id: `replay-t-${day}-${k}`,
          date,
          measuredIn: "computer",
          windowSec: Math.round(presses * (interval / 1000) * 1.6),
          presses,
          medianIntervalMs: round(interval),
          spreadMs: round(92 + noise(13) + drift * 45),
          p95PauseMs: round(640 + noise(70) + drift * 220),
          medianHoldMs: round(96 + noise(5)),
          source: "demo",
          savedAt: "",
        });
      }
    }

    const noActivity = drift === 0 && rand() < 0.06;
    if (!noActivity) {
      const first = 7 * 60 + 20 + noise(28) + (weekend ? 35 : 0) + drift * 100;
      const last = 22 * 60 + 50 + noise(28) + (weekend ? 25 : 0) + drift * 70;
      activityDays.push({ date, first: minutesToClock(first), last: minutesToClock(last), source: "demo" });
    }
  }
  return { typingSessions, activityDays };
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
    typingSessions: r.typingSessions,
    activityDays: r.activityDays,
    checkIns: [],
    settings: { muted: false },
    ladder: null,
  };
}

/** Only the days up to and including `date`. */
export function upTo(r: ReplayData, date: DayKey): ReplayData {
  return {
    typingSessions: r.typingSessions.filter((s) => s.date <= date),
    activityDays: r.activityDays.filter((d) => d.date <= date),
  };
}

/** Runs the rule once per day, on the data up to that day. */
export function replayFrames(r: ReplayData, lastDay: DayKey): ReplayFrame[] {
  return Array.from({ length: REPLAY_DAYS }, (_, i) => {
    const day = i + 1;
    const date = addDays(lastDay, day - REPLAY_DAYS);
    const data = asAppData(upTo(r, date));
    return { day, date, evaluation: evaluatePassive(data, date), data };
  });
}

/** The first day the rule asks, or null. */
export function firstAsk(frames: ReplayFrame[]): ReplayFrame | null {
  return frames.find((f) => f.evaluation.askNow) ?? null;
}

/** Moves every date `days` later (negative is earlier). The rule only looks at gaps between days, so its outcome is the same. */
export function shiftReplay(r: ReplayData, days: number): ReplayData {
  return {
    typingSessions: r.typingSessions.map((s) => ({ ...s, date: addDays(s.date, days) })),
    activityDays: r.activityDays.map((d) => ({ ...d, date: addDays(d.date, days) })),
  };
}
