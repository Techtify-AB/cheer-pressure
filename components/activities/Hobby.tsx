"use client";

// 7. Pick your hobby back up. The saved hobby and its first action. "Start" begins an optional
// two-minute timer (the same timer as Five minutes outside, kept by its end time); "Done" is
// there the whole time. When the time is up they can finish or carry on by themselves.
// Easier: only the smallest step.

import { useState } from "react";
import type { Plan } from "@/lib/plan";
import { ActivityScreen } from "./ActivityScreen";
import { OneStep } from "./Steps";
import { endedAt, TimerFace, useActivityTimer } from "./Timer";
import type { ActivityRun } from "./useActivity";

export const HOBBY_MS = 2 * 60_000;

export function Hobby({ run, plan }: { run: ActivityRun; plan: Plan }) {
  if (run.easier) {
    return (
      <ActivityScreen
        run={run}
        title="Pick your hobby back up"
        primary={
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Did it
          </button>
        }
      >
        <OneStep label={`${plan.hobby.name}, just this`}>{plan.hobby.smallestStep}</OneStep>
      </ActivityScreen>
    );
  }
  return <HobbyTimer run={run} plan={plan} />;
}

function HobbyTimer({ run, plan }: { run: ActivityRun; plan: Plan }) {
  const timer = useActivityTimer(run, HOBBY_MS);
  const [carryOn, setCarryOn] = useState(false);
  const step = <OneStep label={plan.hobby.name}>{plan.hobby.firstStep}</OneStep>;
  const done = (early: boolean) => (
    <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish({ endedEarly: early })}>
      Done
    </button>
  );

  if (carryOn) {
    return (
      <ActivityScreen run={run} title="Pick your hobby back up" hideEasier text={<p>Carry on as long as you like.</p>} primary={done(false)}>
        {step}
      </ActivityScreen>
    );
  }
  if (timer.phase === "finished") {
    return (
      <ActivityScreen
        run={run}
        title="Pick your hobby back up"
        hideEasier
        text={
          <p>
            {timer.ranOutAway ? `Your two minutes were up at ${endedAt(timer.timer)}. ` : "That's two minutes. "}
            You can finish here or carry on by yourself.
          </p>
        }
        primary={done(false)}
        secondary={
          <button
            type="button"
            className="btn btn-secondary"
            data-act="keep-going"
            onClick={() => {
              timer.clear();
              setCarryOn(true);
            }}
          >
            Carry on
          </button>
        }
      >
        {step}
      </ActivityScreen>
    );
  }
  if (timer.phase === "running") {
    return (
      <ActivityScreen run={run} title="Pick your hobby back up" text={<p>Just the first step. Two minutes is plenty.</p>} primary={done(true)}>
        {step}
        <TimerFace control={timer} label="left" />
      </ActivityScreen>
    );
  }
  return (
    <ActivityScreen
      run={run}
      title="Pick your hobby back up"
      text={<p>Just the first step. A two-minute timer helps, if you like.</p>}
      primary={
        <button type="button" className="btn btn-primary" data-act="start" onClick={timer.start}>
          Start
        </button>
      }
      secondary={
        <button type="button" className="btn btn-secondary" data-act="done-early" onClick={() => run.finish()}>
          Done
        </button>
      }
    >
      {step}
    </ActivityScreen>
  );
}
