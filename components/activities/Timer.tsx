"use client";

// The activity timer. What is saved is the END TIME (lib/storage.ts, activityTimer), so the
// time left is always worked out from the clock: right after the app was in the background,
// and "finished" straight away if the time ran out while the app was closed. The logic is in
// lib/activities/timer.ts (unit tested); this is the hook and the face.

import { useCallback, useEffect, useRef, useState } from "react";
import { formatClock, remainingMs, spokenClock, startTimer, timerPhase, timerProgress, type TimerPhase } from "@/lib/activities/timer";
import { readData, saveActivityTimer, useData } from "@/lib/storage";
import type { ActivityTimer } from "@/lib/types";
import { chime } from "./audio";
import { useStopOnEnd, type ActivityRun } from "./useActivity";

export interface TimerControl {
  phase: TimerPhase;
  timer: ActivityTimer | null;
  now: number;
  left: number;
  /** True when the time ran out while the app was closed or hidden (no chime was heard). */
  ranOutAway: boolean;
  start: () => void;
  /** Forgets the timer (Done, End, Make it easier, "I'll keep going"). */
  clear: () => void;
}

export function useActivityTimer(run: ActivityRun, durationMs: number): TimerControl {
  const data = useData();
  const timer = data?.activityTimer && data.activityTimer.activity === run.id ? data.activityTimer : null;
  const [now, setNow] = useState(() => Date.now());
  // The end time of a timer that rang while on screen.
  const [rang, setRang] = useState<number | null>(null);
  const phase = timerPhase(timer, run.id, now);

  const timerRef = useRef(timer);
  useEffect(() => {
    timerRef.current = timer;
  });
  // The end time of a timer seen running on screen; cleared when the page is hidden, so a
  // timer that ran out while away does not ring late.
  const watched = useRef<number | null>(null);

  // Ticks only while running; coming back to the page re-reads the clock at once.
  useEffect(() => {
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const cur = timerRef.current;
      if (!cur) return;
      const visible = document.visibilityState === "visible";
      if (t < cur.endsAt) {
        if (visible) watched.current = cur.endsAt;
        return;
      }
      if (visible && watched.current === cur.endsAt) {
        watched.current = null;
        chime.ring();
        setRang(cur.endsAt);
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") watched.current = null;
      else tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", tick);
    window.addEventListener("focus", tick);
    const id = phase === "running" ? window.setInterval(tick, 250) : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", tick);
      window.removeEventListener("focus", tick);
      if (id !== null) window.clearInterval(id);
    };
  }, [phase]);

  // A timer already running (or run out) when the view opens: the person had started.
  const { markStarted } = run;
  useEffect(() => {
    if (phase !== "idle") markStarted();
  }, [phase, markStarted]);

  const start = useCallback(() => {
    markStarted();
    chime.unlock();
    const t = Date.now();
    const next = startTimer(run.id, durationMs, t);
    watched.current = next.endsAt;
    setNow(t);
    saveActivityTimer(next);
  }, [run.id, durationMs, markStarted]);

  const clear = useCallback(() => {
    watched.current = null;
    if (readData().activityTimer?.activity === run.id) saveActivityTimer(null);
  }, [run.id]);

  useStopOnEnd(run, clear);

  return {
    phase,
    timer,
    now,
    left: timer ? remainingMs(timer, now) : durationMs,
    ranOutAway: phase === "finished" && rang !== timer?.endsAt,
    start,
    clear,
  };
}

/** The time left, large, with a calm ring that fills as time goes. */
export function TimerFace({ control, label }: { control: TimerControl; label: string }) {
  const { timer, now, left, phase } = control;
  const k = timer ? timerProgress(timer, now) : 0;
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <div className="act-timer" data-phase={phase}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="act-timer-track" cx="60" cy="60" r={r} />
        <circle
          className="act-timer-fill"
          cx="60"
          cy="60"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - k)}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <div className="act-timer-text">
        <span className="act-timer-clock" data-left-ms={left}>
          {formatClock(left)}
        </span>
        <span className="act-timer-label">{label}</span>
      </div>
      <span className="sr-only" role="timer" aria-live="off">
        {spokenClock(left)} left
      </span>
    </div>
  );
}

/** "Your time was up at 14:32", when it ran out while the app was away. */
export function endedAt(timer: ActivityTimer | null): string {
  if (!timer) return "";
  return new Date(timer.endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
