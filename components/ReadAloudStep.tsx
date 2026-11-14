"use client";

import { useEffect, useRef, useState } from "react";
import { startPaceMeter, type PaceError, type PaceMeter, type PaceResult } from "@/lib/paceMeter";

export const READ_SENTENCE = "The morning light came in through the window, and I put the kettle on for tea.";
const WORD_COUNT = READ_SENTENCE.split(/\s+/).filter(Boolean).length;

const ERRORS: Record<PaceError, string> = {
  denied: "The microphone wasn't allowed, which is completely fine. You can finish without this step.",
  unavailable: "There's no microphone I can use here. You can finish without this step.",
  "not-heard": "I couldn't hear the sentence clearly. You can try again in a quieter spot, or finish without it.",
};

type Phase = "ready" | "starting" | "listening" | "result" | "error";

export function ReadAloudStep({
  usualRate,
  onListening,
  onFinish,
  links,
}: {
  usualRate: number | null;
  onListening: (on: boolean) => void;
  onFinish: (wordsPerSecond: number | null) => void;
  /** Quiet links shown with this step's own (Back, for example). */
  links?: React.ReactNode;
}) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [level, setLevel] = useState(0);
  const [result, setResult] = useState<PaceResult | null>(null);
  const [error, setError] = useState<PaceError | null>(null);
  const meter = useRef<PaceMeter | null>(null);

  useEffect(
    () => () => {
      meter.current?.cancel();
      onListening(false);
    },
    [onListening],
  );

  const start = async () => {
    setError(null);
    setResult(null);
    setPhase("starting");
    const m = await startPaceMeter({
      wordCount: WORD_COUNT,
      onLevel: setLevel,
      onResult: (r) => {
        onListening(false);
        setResult(r);
        setPhase("result");
      },
      onError: (e) => {
        onListening(false);
        setError(e);
        setPhase("error");
      },
    });
    if (m) {
      meter.current = m;
      onListening(true);
      setPhase("listening");
    }
  };

  const comparison =
    result && usualRate
      ? Math.abs(result.wordsPerSecond - usualRate) < usualRate * 0.12
        ? "About your usual pace."
        : result.wordsPerSecond < usualRate
          ? "A bit slower than your usual pace."
          : "A bit quicker than your usual pace."
      : null;

  let info: React.ReactNode = null;
  let primary: React.ReactNode = null;
  let quiet: React.ReactNode = null;

  if (phase === "ready") {
    info = (
      <p className="muted small">
        Tap start, then read the sentence at your normal pace. I only measure how fast you read it. Nothing is recorded
        or sent, and it all happens on this device.
      </p>
    );
    primary = (
      <button type="button" className="btn btn-primary" onClick={start}>
        Start reading
      </button>
    );
    quiet = (
      <button type="button" className="btn btn-quiet" onClick={() => onFinish(null)}>
        Skip this step and finish
      </button>
    );
  } else if (phase === "starting") {
    info = <p className="muted">Waiting for the microphone…</p>;
  } else if (phase === "listening") {
    info = (
      <>
        <p aria-live="polite">
          <strong>Listening.</strong> Read the sentence now. I&apos;ll stop by myself when you&apos;re done.
        </p>
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
      </>
    );
    primary = (
      <button type="button" className="btn btn-primary" onClick={() => meter.current?.stop()}>
        I&apos;m done reading
      </button>
    );
  } else if (phase === "result" && result) {
    info = (
      <div className="card" aria-live="polite">
        <div className="big-number">{result.wordsPerSecond.toFixed(1)} words per second</div>
        <p className="muted" style={{ marginBottom: 0 }}>
          How fast you read the sentence ({WORD_COUNT} words in {result.speakingSeconds.toFixed(1)} seconds). Only
          this number is kept. {comparison}
        </p>
      </div>
    );
    primary = (
      <button type="button" className="btn btn-primary" onClick={() => onFinish(result.wordsPerSecond)}>
        Save and finish
      </button>
    );
    quiet = (
      <button type="button" className="btn btn-quiet" onClick={start}>
        Read it again
      </button>
    );
  } else if (phase === "error" && error) {
    info = <p role="status">{ERRORS[error]}</p>;
    primary = (
      <button type="button" className="btn btn-primary" onClick={() => onFinish(null)}>
        Finish without it
      </button>
    );
    quiet =
      error !== "unavailable" ? (
        <button type="button" className="btn btn-quiet" onClick={start}>
          Try again
        </button>
      ) : null;
  }

  return (
    <>
      <div className="screen-body">
        <p className="sentence" lang="en">
          {READ_SENTENCE}
        </p>
        {info}
      </div>
      <div className="screen-actions">
        {primary}
        <div className="links">
          {quiet}
          {links}
        </div>
      </div>
    </>
  );
}
