"use client";

// The shared screen for "listen for a while, then the step" (One song, one first step and
// Wind down the evening): ready, listening, then the step. Sound and screen light have their
// own switches and either can be off.

import { SwitchRow } from "@/components/Switch";
import { formatClock } from "@/lib/activities/timer";
import { audioProps } from "./audio";
import { ActivityScreen } from "./ActivityScreen";
import { EdgeLight } from "./EdgeLight";
import { OneStep } from "./Steps";
import type { ActivityRun } from "./useActivity";
import { useListen } from "./useListen";

export function ListenActivity({
  run,
  title,
  text,
  src,
  soundLabel,
  maxMs,
  playLabel,
  stepLabel,
  step,
  doneLabel,
  lightFadeMs,
}: {
  run: ActivityRun;
  title: string;
  text: string;
  src: string;
  soundLabel: string;
  maxMs: number;
  playLabel: string;
  stepLabel: string;
  step: string;
  doneLabel: string;
  lightFadeMs: number;
}) {
  const { phase, elapsedMs, sound, light, setSound, setLight, start, skip, audioRef, soundFailed } = useListen(run, {
    maxMs,
    fadeMs: maxMs > 20_000 ? 6000 : 3000,
  });
  const left = maxMs - elapsedMs;

  const switches = (
    <div className="act-switches" role="group" aria-label="Sound and light">
      <SwitchRow
        label="Sound"
        hint={soundFailed ? "The sound could not play here" : soundLabel}
        on={sound}
        onChange={setSound}
      />
      <SwitchRow label="Screen light" hint="A warm glow at the edge of the screen" on={light} onChange={setLight} />
    </div>
  );

  return (
    <>
      <audio ref={audioRef} {...audioProps(src)} />
      <EdgeLight on={light && phase === "listening"} fadeMs={lightFadeMs} />
      {phase === "after" ? (
        <ActivityScreen
          run={run}
          title={title}
          hideEasier
          primary={
            <button
              type="button"
              className="btn btn-primary"
              data-act="done"
              onClick={() => run.finish({ endedEarly: elapsedMs < maxMs - 500 })}
            >
              {doneLabel}
            </button>
          }
        >
          <OneStep label={stepLabel}>{step}</OneStep>
        </ActivityScreen>
      ) : (
        <ActivityScreen
          run={run}
          title={title}
          text={<p>{text}</p>}
          primary={
            phase === "ready" ? (
              <button type="button" className="btn btn-primary" data-act="start" onClick={start}>
                {playLabel}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" data-act="skip" onClick={skip}>
                Go straight to the step
              </button>
            )
          }
          links={
            phase === "ready" ? (
              <button type="button" className="btn btn-quiet" data-act="skip" onClick={skip}>
                Go straight to the step
              </button>
            ) : null
          }
        >
          <div className="act-listen" data-phase={phase}>
            <span className="act-listen-dot" aria-hidden="true" />
            <span className="act-listen-text" aria-live="off">
              {phase === "listening" ? `Listening, ${formatClock(left)} left` : `Up to ${Math.round(maxMs / 1000)} seconds`}
            </span>
          </div>
          {switches}
        </ActivityScreen>
      )}
    </>
  );
}
