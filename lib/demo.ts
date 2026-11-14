// Made-up entries for trying the app. The passive measures the companion's rule reads
// (typing per day, first and last activity) are the replay's eight weeks (lib/replay.ts),
// ending today: six steady weeks, then sleep slips and typing follows. The older entries
// (daily check-ins, weekly answers, reaction tests) cover six weeks with a final drifting
// week. Everything is tagged source "demo" so it can be cleared on its own.

import { addDays, minutesToClock } from "./dates";
import { makeReplayData } from "./replay";
import type { DailyEntry, ReactionResult, Scale03, TypingSession, WeeklyEntry } from "./types";

const DAYS = 42;
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
  for (let w = 5; w >= 0; w--) {
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

  // Typing per day and first and last activity: the replay's eight weeks, ending today, so
  // "Load demo data" and "Eight weeks in 20 seconds" tell the same story.
  const { typingDays, activityDays, dailyAnswers } = makeReplayData(today);
  const typingSessions: TypingSession[] = [];

  return { daily, weekly, reaction, typingSessions, typingDays, activityDays, dailyAnswers };
}
