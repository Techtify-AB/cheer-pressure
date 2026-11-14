"use client";

// 9. Wind down the evening. A calm sound for up to 60 seconds with a still, warm screen light,
// then the first evening step. Works with the sound off, the light off, or both.
// Easier: the smallest evening step straight away.

import { EVENING_SOUND, soundById, SOUNDS } from "@/lib/activities/sounds";
import type { Plan } from "@/lib/plan";
import { ActivityScreen } from "./ActivityScreen";
import { ListenActivity } from "./ListenActivity";
import { OneStep } from "./Steps";
import type { ActivityRun } from "./useActivity";

export function Evening({ run, plan }: { run: ActivityRun; plan: Plan }) {
  if (run.easier) {
    return (
      <ActivityScreen
        run={run}
        title="Wind down the evening"
        primary={
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Did it
          </button>
        }
      >
        <OneStep label="Just this">{plan.eveningSmallest}</OneStep>
      </ActivityScreen>
    );
  }
  const sound = soundById(EVENING_SOUND) ?? SOUNDS[0];
  return (
    <ListenActivity
      run={run}
      title="Wind down the evening"
      text="Listen for a while. When the sound fades, Cheri shows your first evening step."
      src={sound.src}
      soundLabel={sound.label}
      maxMs={60_000}
      playLabel="Play"
      stepLabel="Your first evening step"
      step={plan.eveningStep}
      doneLabel="Did it"
      lightFadeMs={2500}
    />
  );
}
