"use client";

// 2. Let the daylight in. Two steps, one at a time, as two cards with the current one marked:
// open the curtains, then sit by the window (or go out). Easier: only the first step.

import { useState } from "react";
import type { Plan } from "@/lib/plan";
import { ActivityScreen } from "./ActivityScreen";
import { OneStep, StepCards } from "./Steps";
import type { ActivityRun } from "./useActivity";

const STEPS = ["Open the curtains or blinds.", "Sit by the window for a while, or go outside if that suits you better."];

export function Daylight({ run }: { run: ActivityRun; plan: Plan }) {
  const [step, setStep] = useState(0);
  if (run.easier) {
    return (
      <ActivityScreen
        run={run}
        title="Let the daylight in"
        primary={
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Did it
          </button>
        }
      >
        <OneStep label="Just this">{STEPS[0]}</OneStep>
      </ActivityScreen>
    );
  }
  const last = step === STEPS.length - 1;
  return (
    <ActivityScreen
      run={run}
      title="Let the daylight in"
      text={<p>One step at a time.</p>}
      primary={
        last ? (
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Done
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            data-act="start"
            onClick={() => {
              run.markStarted();
              setStep((s) => s + 1);
            }}
          >
            Next
          </button>
        )
      }
    >
      <StepCards steps={STEPS} current={step} />
    </ActivityScreen>
  );
}
