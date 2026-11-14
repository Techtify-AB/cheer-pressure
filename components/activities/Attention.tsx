"use client";

// 4. Move your attention for a moment. A calm guide, three lines with pauses, each shown as text
// while it is spoken. No recorded voice exists yet: the device's own on-device speech says each
// line (lib/voice.ts: on-device voices only, nothing leaves the phone; silent when muted), and
// the lines follow the time markers in lib/activities/guide.ts. Set `audioSrc` there and the
// same markers follow a recording instead. "Read instead" shows the whole guide with no sound.
// Afterwards: up to two of the person's own activities, opening directly, and "Done for now".
// Easier: "Notice one sound near you."

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { activityById, activityHref, nextActivities } from "@/lib/activities";
import { ATTENTION_GUIDE, holdFor, lineAt } from "@/lib/activities/guide";
import { helpsOf } from "@/lib/helps";
import type { Plan } from "@/lib/plan";
import { readData } from "@/lib/storage";
import { speak, stopSpeaking } from "@/lib/voice";
import { audioProps, useAudioPlayer } from "./audio";
import { ActivityScreen } from "./ActivityScreen";
import { OneStep } from "./Steps";
import { useStopOnEnd, type ActivityRun } from "./useActivity";

type Phase = "ready" | "playing" | "read" | "after";
const GUIDE = ATTENTION_GUIDE;

/**
 * On-device speech: each line is shown and spoken, and the next one starts at its marker, but
 * never before the speech has finished plus a short pause (holdFor).
 */
function runGuide(opts: {
  muted: boolean;
  onLine: (i: number) => void;
  onDone: () => void;
  later: (fn: () => void, ms: number) => void;
  onSpeech: (cancel: () => void) => void;
}) {
  const sayLine = (i: number) => {
    if (i >= GUIDE.lines.length) {
      opts.onDone();
      return;
    }
    opts.onLine(i);
    const t0 = performance.now();
    opts.onSpeech(
      speak(GUIDE.lines[i].text, {
        muted: opts.muted,
        onEnd: () => {
          const spoken = performance.now() - t0;
          opts.later(() => sayLine(i + 1), holdFor(GUIDE, i, spoken) - spoken);
        },
      }),
    );
  };
  sayLine(0);
}

export function Attention({ run }: { run: ActivityRun; plan: Plan }) {
  if (run.easier) {
    return (
      <ActivityScreen
        run={run}
        title="Move your attention for a moment"
        primary={
          <button type="button" className="btn btn-primary" data-act="done" onClick={() => run.finish()}>
            Done
          </button>
        }
      >
        <OneStep label="Just this">Notice one sound near you.</OneStep>
      </ActivityScreen>
    );
  }
  return <Guide run={run} />;
}

function Guide({ run }: { run: ActivityRun }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [line, setLine] = useState(-1);
  const timers = useRef<number[]>([]);
  const cancelSpeech = useRef<(() => void) | null>(null);
  const { ref: audioRef, play, stop: stopAudio } = useAudioPlayer();
  const { markStarted } = run;

  const stop = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    cancelSpeech.current?.();
    cancelSpeech.current = null;
    stopSpeaking();
    stopAudio();
  }, [stopAudio]);

  useStopOnEnd(run, stop);
  useEffect(() => stop, [stop]);

  // Hidden partway: stop the voice and show the whole guide to read instead.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden") return;
      stop();
      setPhase((p) => (p === "playing" ? "read" : p));
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [stop]);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, Math.max(0, ms)));
  };

  const start = () => {
    markStarted();
    stop();
    setPhase("playing");
    if (GUIDE.audioSrc) {
      // A recorded voice: the lines follow the recording's own clock.
      play({ maxMs: GUIDE.endsAt * 1000, fadeMs: 800, onEnd: () => setPhase("after") });
      const tick = () => {
        const el = audioRef.current;
        if (el) setLine(Math.max(0, lineAt(GUIDE, el.currentTime)));
        later(tick, 250);
      };
      tick();
      return;
    }
    runGuide({
      muted: readData().settings.muted,
      onLine: setLine,
      onDone: () => setPhase("after"),
      later,
      onSpeech: (cancel) => {
        cancelSpeech.current = cancel;
      },
    });
  };

  const readInstead = () => {
    markStarted();
    stop();
    setPhase("read");
  };

  const doneForNow = (
    <button
      type="button"
      className="btn btn-primary"
      data-act="done"
      onClick={() => run.finish({ endedEarly: phase === "playing" })}
    >
      Done for now
    </button>
  );

  const title = "Move your attention for a moment";
  const audio = GUIDE.audioSrc ? <audio ref={audioRef} {...audioProps(GUIDE.audioSrc)} /> : null;

  if (phase === "after") {
    const next = nextActivities(helpsOf(readData()), ["attention"], 2);
    return (
      <>
        {audio}
        <ActivityScreen run={run} title={title} hideEasier text={<p>{GUIDE.lines[GUIDE.lines.length - 1].text}</p>} primary={doneForNow}>
          <div className="act-next" aria-label="Something to do now">
            {next.map((id) => (
              <Link key={id} href={activityHref(id)} className="btn btn-secondary" data-act="next-activity">
                {activityById(id)?.title}
              </Link>
            ))}
          </div>
        </ActivityScreen>
      </>
    );
  }

  if (phase === "read") {
    return (
      <>
        {audio}
        <ActivityScreen run={run} title={title} hideEasier text={<p>Read it at your own pace.</p>} primary={doneForNow}>
          <ol className="act-guide-all" data-act="guide-text">
            {GUIDE.lines.map((l) => (
              <li key={l.at}>{l.text}</li>
            ))}
          </ol>
        </ActivityScreen>
      </>
    );
  }

  if (phase === "playing") {
    return (
      <>
        {audio}
        <ActivityScreen
          run={run}
          title={title}
          primary={doneForNow}
          links={
            <button type="button" className="btn btn-quiet" data-act="read" onClick={readInstead}>
              Read instead
            </button>
          }
        >
          <p className="act-step-label" aria-hidden="true">
            {Math.max(1, line + 1)} of {GUIDE.lines.length}
          </p>
          <p key={line} className="act-guide-line" aria-live="polite" data-act="guide-line">
            {GUIDE.lines[Math.max(0, line)].text}
          </p>
        </ActivityScreen>
      </>
    );
  }

  return (
    <>
      {audio}
      <ActivityScreen
        run={run}
        title={title}
        text={<p>A short, calm guide, three lines with pauses. Cheri reads it aloud if your device has a voice.</p>}
        primary={
          <button type="button" className="btn btn-primary" data-act="start" onClick={start}>
            Start
          </button>
        }
        links={
          <button type="button" className="btn btn-quiet" data-act="read" onClick={readInstead}>
            Read instead
          </button>
        }
      />
    </>
  );
}
