"use client";

// "A quick reaction check" (experimental): five taps, about 15 seconds, the middle time in ms,
// shown only against the person's own usual. Never a score or a judgement. The rules are in
// lib/activities/reaction.ts (unit tested). Each result is stored through lib/storage.ts with
// where it was done.
//
// Self-contained (no page frame), so the daily hello can embed it:
//   <ReactionCheck context="hello" onFinished={(result) => ...} />

import { useCallback, useEffect, useRef, useState } from "react";
import {
  arm,
  BETWEEN_MS,
  compareWithUsual,
  COMPARE_LINE,
  go,
  initialReaction,
  median,
  ROUNDS,
  tap,
  waitMs,
  type ReactionState,
} from "@/lib/activities/reaction";
import { newId, todayKey } from "@/lib/dates";
import { readData, saveReactionCheck } from "@/lib/storage";
import type { ReactionCheckResult } from "@/lib/types";

/** Earlier results, oldest first: these checks, and the earlier timing taps if any. */
function earlierMedians(): number[] {
  const d = readData();
  const all = [
    ...(d.reaction ?? []).map((r) => ({ at: r.savedAt, ms: r.medianMs })),
    ...(d.reactionChecks ?? []).map((r) => ({ at: r.at, ms: r.medianMs })),
  ];
  return all.sort((a, b) => a.at.localeCompare(b.at)).map((r) => r.ms);
}

const PAD_TEXT: Record<Exclude<ReactionState["phase"], "done">, string> = {
  intro: "Tap here to start",
  waiting: "Wait for the change",
  go: "Tap now",
  early: "A little too soon. That one doesn't count",
  between: "",
};

export function ReactionCheck({
  context,
  onFinished,
}: {
  context: ReactionCheckResult["context"];
  onFinished?: (result: ReactionCheckResult) => void;
}) {
  const [state, setState] = useState<ReactionState>(initialReaction);
  const [result, setResult] = useState<{ ms: number; line: string } | null>(null);
  const timer = useRef<number | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const schedule = useCallback((fn: () => void, ms: number) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, ms);
  }, []);

  // Waiting: the circle changes after a random 1 to 3 s. Between rounds: the next starts by itself.
  useEffect(() => {
    if (state.phase === "waiting") schedule(() => setState((s) => go(s, performance.now())), waitMs());
    if (state.phase === "between" || state.phase === "early") schedule(() => setState((s) => arm(s)), BETWEEN_MS);
  }, [state.phase, state.times.length, state.early, schedule]);

  // Hidden partway: stop, and wait for a tap to go on with the same round.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setState((s) => (s.phase === "done" ? s : { ...s, phase: "intro", goAt: null }));
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  const press = () => {
    if (state.phase === "done" || state.phase === "between") return;
    if (state.phase === "waiting") clear();
    const next = tap(state, performance.now());
    setState(next);
    if (next.phase === "done") {
      const ms = median(next.times);
      const earlier = earlierMedians();
      const entry: ReactionCheckResult = {
        id: newId(),
        date: todayKey(),
        at: new Date().toISOString(),
        medianMs: ms,
        trialsMs: next.times,
        context,
      };
      saveReactionCheck(entry);
      setResult({ ms, line: COMPARE_LINE[compareWithUsual(ms, earlier)] });
      onFinished?.(entry);
    }
  };

  const count = Math.min(state.times.length + (state.phase === "done" ? 0 : 1), ROUNDS);

  return (
    <div className="act-reaction">
      <p className="act-reaction-head">
        <span>A quick reaction check</span>
        <span className="badge badge-experiment">Experimental</span>
      </p>
      {result ? (
        <div className="act-reaction-result" aria-live="polite">
          <p className="act-reaction-line">{result.line}</p>
          <p className="muted small">
            The middle of your five taps was {result.ms} ms. It stays on this device, as an experiment.
          </p>
        </div>
      ) : (
        <>
          <p className="muted small act-reaction-how">Wait for the circle to change, then tap it as fast as you can. Five times.</p>
          <button
            type="button"
            className="act-reaction-pad"
            data-phase={state.phase}
            aria-describedby="act-reaction-count"
            onPointerDown={(e) => {
              e.preventDefault();
              press();
            }}
            onKeyDown={(e) => {
              if ((e.key === " " || e.key === "Enter") && !e.repeat) {
                e.preventDefault();
                press();
              }
            }}
          >
            <span className="act-reaction-pad-text">
              {state.phase === "between" ? `${state.times[state.times.length - 1]} ms` : PAD_TEXT[state.phase as Exclude<ReactionState["phase"], "done">]}
            </span>
          </button>
          <p id="act-reaction-count" className="muted small act-reaction-count" aria-live="polite">
            {state.phase === "intro" && state.times.length === 0 ? "About 15 seconds" : `Tap ${count} of ${ROUNDS}`}
          </p>
        </>
      )}
    </div>
  );
}
