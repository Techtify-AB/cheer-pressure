"use client";

// What every activity shares: "Make it easier", "End", "Done" and "Did that help?".
//
// - Each running thing (a sound, the screen light, a timer, speech) registers how to stop it.
//   Leaving the view another way (a header link, the back button) stops sound, light and speech
//   in their own clean-up, but keeps a running timer, so the countdown is right on return.
// - "Make it easier" stops all of it and switches to the smaller step.
// - "End" works at any moment and stops all of it. Before anything was started it simply goes
//   back to the library. Once the person has started (markStarted), it records the activity as
//   ended early and asks "Did any of it help?" in a gentler wording.
// - "Done" (or "Did it", "That works") stops all of it and records what the person said they
//   did: the activity, the day, whether the easier version was used, and whether it came before
//   the timer or the sound had run out. Then one question, "Did that help?", whose answer is
//   stored on the same record. Self-reported only, nothing is measured.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityId } from "@/lib/activities";
import { newId, todayKey } from "@/lib/dates";
import { saveActivityDone } from "@/lib/storage";
import type { ActivityDone, ActivityFeedback } from "@/lib/types";

export const LIBRARY_HREF = "/activities/";

export interface DoneState {
  entry: ActivityDone;
  message?: string;
  /** "feedback": asking "Did that help?"; "after": answered or skipped. */
  stage: "feedback" | "after";
  /** Ended with "End" partway: the gentler wording. */
  ended: boolean;
}

export interface ActivityRun {
  id: ActivityId;
  easier: boolean;
  started: boolean;
  /** Call on the person's first real step (start, play, a card, a send). */
  markStarted: () => void;
  makeEasier: () => void;
  end: () => void;
  finish: (opts?: { endedEarly?: boolean; message?: string }) => void;
  answer: (feedback: ActivityFeedback | null) => void;
  done: DoneState | null;
  /** Registers how to stop something that runs; returns the unregister. */
  register: (stop: () => void) => () => void;
  stopAll: () => void;
}

export function useActivity(id: ActivityId): ActivityRun {
  const router = useRouter();
  const stoppers = useRef(new Set<() => void>());
  const [easier, setEasier] = useState(false);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState<DoneState | null>(null);

  const stopAll = useCallback(() => {
    for (const stop of [...stoppers.current]) {
      try {
        stop();
      } catch {
        // stopping one thing must never keep the others running
      }
    }
  }, []);

  const register = useCallback((stop: () => void) => {
    stoppers.current.add(stop);
    return () => {
      stoppers.current.delete(stop);
    };
  }, []);

  const markStarted = useCallback(() => setStarted(true), []);

  const makeEasier = useCallback(() => {
    stopAll();
    setEasier(true);
  }, [stopAll]);

  const record = useCallback(
    (endedEarly: boolean, ended: boolean, message?: string) => {
      stopAll();
      const entry: ActivityDone = {
        id: newId(),
        activity: id,
        date: todayKey(),
        at: new Date().toISOString(),
        easier,
        endedEarly,
        feedback: null,
      };
      saveActivityDone(entry);
      // TODO(helps): lib/helps.ts has no export that marks a step-one suggestion as taken from
      // here. The ladder's step-one screen records "try" itself (answerOffer, viaActivity) before
      // it opens the activity, and lib/helps.ts reads this record's "Did that help?" through
      // feedbackFromActivities. If a "taken" mark is ever wanted from the activity, add it here.
      setDone({ entry, message, stage: "feedback", ended });
    },
    [id, easier, stopAll],
  );

  const finish = useCallback(
    (opts?: { endedEarly?: boolean; message?: string }) => record(!!opts?.endedEarly, false, opts?.message),
    [record],
  );

  const end = useCallback(() => {
    if (started) {
      record(true, true);
      return;
    }
    stopAll();
    router.push(LIBRARY_HREF);
  }, [started, record, stopAll, router]);

  const answer = useCallback(
    (feedback: ActivityFeedback | null) => {
      if (!done || done.stage !== "feedback") return;
      const entry = { ...done.entry, feedback };
      saveActivityDone(entry);
      setDone({ ...done, entry, stage: "after" });
    },
    [done],
  );

  return { id, easier, started, markStarted, makeEasier, end, finish, answer, done, register, stopAll };
}

/** Registers a stop function for as long as the component is mounted. */
export function useStopOnEnd(run: Pick<ActivityRun, "register">, stop: () => void) {
  const ref = useRef(stop);
  useEffect(() => {
    ref.current = stop;
  });
  const { register } = run;
  useEffect(() => register(() => ref.current()), [register]);
}
