"use client";

// 1. Five minutes outside. "I'm going out now" starts five minutes; the end time is saved, so
// the count is right when the person comes back to the app, and if the time ran out while the
// app was closed, the finish view shows straight away. "Done" works at any moment.
// Easier: step outside the door for a moment.

import type { Plan } from "@/lib/plan";
import { ActivityScreen } from "./ActivityScreen";
import { OneStep } from "./Steps";
import { endedAt, TimerFace, useActivityTimer } from "./Timer";
import type { ActivityRun } from "./useActivity";
import { useState } from "react";

export const OUTSIDE_MS = 5 * 60_000;

export function Outside({ run }: { run: ActivityRun; plan: Plan }) {
  if (run.easier) {
    return (
      <ActivityScreen
        run={run}
        title="Five minutes outside"
        primary={
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Did it
          </button>
        }
      >
        <OneStep label="Just this">Step outside the door for a moment.</OneStep>
      </ActivityScreen>
    );
  }
  return <OutsideTimer run={run} />;
}

function OutsideTimer({ run }: { run: ActivityRun }) {
  const timer = useActivityTimer(run, OUTSIDE_MS);
  const [keepGoing, setKeepGoing] = useState(false);
  const title = "Five minutes outside";

  if (keepGoing) {
    return (
      <ActivityScreen
        run={run}
        title={title}
        hideEasier
        text={<p>Keep going as long as it feels good. Tap Done when you are back.</p>}
        primary={
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Done
          </button>
        }
      />
    );
  }

  if (timer.phase === "finished") {
    return (
      <ActivityScreen
        run={run}
        title={title}
        hideEasier
        text={
          <p>
            {timer.ranOutAway ? `Your five minutes were up at ${endedAt(timer.timer)}. ` : "That's five minutes. "}
            You can turn back or keep going.
          </p>
        }
        primary={
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Done
          </button>
        }
        secondary={
          <button
            type="button"
            className="btn btn-secondary"
            data-act="keep-going"
            onClick={() => {
              timer.clear();
              setKeepGoing(true);
            }}
          >
            I&apos;ll keep going
          </button>
        }
      >
        <TimerFace control={timer} label="Time is up" />
      </ActivityScreen>
    );
  }

  if (timer.phase === "running") {
    return (
      <ActivityScreen
        run={run}
        title={title}
        text={<p>Walk whichever way feels easiest. When the timer rings you can turn back or keep going.</p>}
        primary={
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish({ endedEarly: true })}>
            Done
          </button>
        }
      >
        <TimerFace control={timer} label="left" />
      </ActivityScreen>
    );
  }

  return (
    <ActivityScreen
      run={run}
      title={title}
      text={
        <p>
          Put your shoes on and go out. Walk whichever way feels easiest. When the timer rings you can turn back or keep
          going.
        </p>
      }
      primary={
        <button type="button" className="btn btn-primary" data-act="start" onClick={timer.start}>
          I&apos;m going out now
        </button>
      }
    >
      <TimerFace control={timer} label="5 minutes" />
    </ActivityScreen>
  );
}
