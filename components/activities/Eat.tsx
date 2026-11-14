"use client";

// 5. Get something to eat ready. The person's simple meal (lib/plan.ts) as a checklist on one
// screen, at most three steps; a meal saved with only its name is one action. "Done" works
// even if they ate something else. Easier: the simplest saved option.

import type { Plan } from "@/lib/plan";
import { mealActions } from "@/lib/plan";
import { ActivityScreen } from "./ActivityScreen";
import { Checklist, OneStep } from "./Steps";
import type { ActivityRun } from "./useActivity";

export function Eat({ run, plan }: { run: ActivityRun; plan: Plan }) {
  if (run.easier) {
    return (
      <ActivityScreen
        run={run}
        title="Get something to eat ready"
        primary={
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Did it
          </button>
        }
      >
        <OneStep label="Just this">{plan.meal.smallest}</OneStep>
      </ActivityScreen>
    );
  }
  const items = mealActions(plan);
  return (
    <ActivityScreen
      run={run}
      title="Get something to eat ready"
      text={
        <p>
          {items.length > 1 ? `${plan.meal.name}. Tick the steps as you go, if you like.` : "Just this one thing."} Something
          else is fine too.
        </p>
      }
      primary={
        <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
          Done
        </button>
      }
    >
      <Checklist items={items} label={plan.meal.name} onTick={run.markStarted} />
    </ActivityScreen>
  );
}
