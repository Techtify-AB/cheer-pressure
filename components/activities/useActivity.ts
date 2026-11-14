"use client";

// What every activity shares: "Make it easier", "End" and "Done".
//
// - Each running thing (a sound, the screen light, a timer, speech) registers how to stop it.
//   Leaving the view another way (a header link, the back button) stops sound, light and speech
//   in their own clean-up, but keeps a running timer, so the countdown is right on return.
// - "Make it easier" stops all of it and switches to the smaller step.
// - "End" works at any moment: it stops all of it, forgets a running timer, and goes back to
//   the library. Nothing is recorded: ending is always fine.
// - "Done" (or "Did it") stops all of it and records what the person said they did: the
//   activity, the day, whether the easier version was used, and whether it came before the
//   timer or the sound had run out. Self-reported only, nothing is measured.

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActivityId } from "@/lib/activities";
import { newId, todayKey } from "@/lib/dates";
import { saveActivityDone } from "@/lib/storage";
import type { ActivityDone } from "@/lib/types";

export const LIBRARY_HREF = "/activities/";

export interface ActivityRun {
  id: ActivityId;
  easier: boolean;
  makeEasier: () => void;
  end: () => void;
  finish: (opts?: { endedEarly?: boolean; message?: string }) => void;
  done: { entry: ActivityDone; message?: string } | null;
  /** Registers how to stop something that runs; returns the unregister. */
  register: (stop: () => void) => () => void;
  stopAll: () => void;
}

export function useActivity(id: ActivityId): ActivityRun {
  const router = useRouter();
  const stoppers = useRef(new Set<() => void>());
  const [easier, setEasier] = useState(false);
  const [done, setDone] = useState<ActivityRun["done"]>(null);

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

  const makeEasier = useCallback(() => {
    stopAll();
    setEasier(true);
  }, [stopAll]);

  const end = useCallback(() => {
    stopAll();
    router.push(LIBRARY_HREF);
  }, [stopAll, router]);

  const finish = useCallback(
    (opts?: { endedEarly?: boolean; message?: string }) => {
      stopAll();
      const entry: ActivityDone = {
        id: newId(),
        activity: id,
        date: todayKey(),
        at: new Date().toISOString(),
        easier,
        endedEarly: !!opts?.endedEarly,
      };
      saveActivityDone(entry);
      // TODO(helps): lib/helps.ts has no export that marks a step-one suggestion as taken; the
      // ladder's step-one screen already records "try" when the person says "I'll try that".
      // When lib/helps.ts gets one, call it here with the matching item.
      setDone({ entry, message: opts?.message });
    },
    [id, easier, stopAll],
  );

  return { id, easier, makeEasier, end, finish, done, register, stopAll };
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
