"use client";

// 3. One song, one first step. Up to 60 seconds of the chosen sound while the edge of the
// screen fades to a warm colour, then the first step the person chose (lib/plan.ts).
// Easier: the first 15 seconds, then the step.

import { soundById, SOUNDS } from "@/lib/activities/sounds";
import type { Plan } from "@/lib/plan";
import { ListenActivity } from "./ListenActivity";
import type { ActivityRun } from "./useActivity";

export function Song({ run, plan }: { run: ActivityRun; plan: Plan }) {
  const sound = soundById(plan.sound) ?? SOUNDS[0];
  return (
    <ListenActivity
      key={run.easier ? "easier" : "full"}
      run={run}
      title="One song, one first step"
      text={
        run.easier
          ? "Listen for 15 seconds. Then Cheri shows the first step you chose."
          : "Listen for a while. When the music fades, Cheri shows the first step you chose."
      }
      src={sound.src}
      soundLabel={sound.label}
      maxMs={run.easier ? 15_000 : 60_000}
      playLabel={run.easier ? "Play 15 seconds" : "Play"}
      stepLabel="Your first step"
      step={plan.firstStepAfterMusic}
      doneLabel="Done"
      lightFadeMs={8000}
    />
  );
}
