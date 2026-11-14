// The activity timer's logic, pure and unit tested (scripts/test-activities.mts). The END TIME
// is what is stored (lib/storage.ts, activityTimer), never a count of seconds left, so the
// countdown is right after the app was in the background or closed: what is left is always
// worked out from the clock. A timer whose end time has passed while the app was closed is
// "finished" the moment the activity is opened again.

import type { ActivityTimer } from "../types";

export type TimerPhase = "idle" | "running" | "finished";

export function startTimer(activity: string, durationMs: number, now: number): ActivityTimer {
  return { activity, startedAt: now, endsAt: now + Math.max(0, durationMs) };
}

/** Milliseconds left, never below zero. */
export function remainingMs(timer: Pick<ActivityTimer, "endsAt">, now: number): number {
  return Math.max(0, timer.endsAt - now);
}

/** Where this activity's timer stands. Another activity's timer counts as idle here. */
export function timerPhase(timer: ActivityTimer | null | undefined, activity: string, now: number): TimerPhase {
  if (!timer || timer.activity !== activity) return "idle";
  return now >= timer.endsAt ? "finished" : "running";
}

/** 0 to 1, how much of the time has gone. */
export function timerProgress(timer: ActivityTimer, now: number): number {
  const total = timer.endsAt - timer.startedAt;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (now - timer.startedAt) / total));
}

/** "4:59": whole seconds, rounded up, so it never shows 0:00 while time is left. */
export function formatClock(ms: number): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "4 minutes 59 seconds", for screen readers. */
export function spokenClock(ms: number): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (r || !m) parts.push(`${r} second${r === 1 ? "" : "s"}`);
  return parts.join(" ");
}
