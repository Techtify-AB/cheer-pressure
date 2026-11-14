"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRequireProfile, useToday } from "@/components/hooks";
import { Screen, StepCount } from "@/components/Screen";
import { median } from "@/lib/levels";
import { newId } from "@/lib/dates";
import { saveReaction, useData } from "@/lib/storage";

const TRIALS = 5;

type Phase = "intro" | "waiting" | "go" | "early" | "between" | "done";

export default function ReactionPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const [phase, setPhase] = useState<Phase>("intro");
  const [times, setTimes] = useState<number[]>([]);
  const [result, setResult] = useState<number | null>(null);
  const goAt = useRef(0);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  if (!data || !ready) return null;

  const previous = data.reaction[data.reaction.length - 1];

  const arm = () => {
    setPhase("waiting");
    const wait = 1200 + Math.random() * 2300;
    timer.current = window.setTimeout(() => {
      goAt.current = performance.now();
      setPhase("go");
    }, wait);
  };

  const press = () => {
    if (phase === "intro" || phase === "between" || phase === "early") {
      if (phase === "intro") setTimes([]);
      arm();
      return;
    }
    if (phase === "waiting") {
      if (timer.current) window.clearTimeout(timer.current);
      setPhase("early");
      return;
    }
    if (phase === "go") {
      const ms = Math.round(performance.now() - goAt.current);
      const next = [...times, ms];
      setTimes(next);
      if (next.length >= TRIALS) {
        const m = Math.round(median(next));
        setResult(m);
        saveReaction({
          id: newId(),
          date: today,
          trialsMs: next,
          medianMs: m,
          source: "user",
          savedAt: new Date().toISOString(),
        });
        setPhase("done");
      } else {
        setPhase("between");
      }
    }
  };

  const padText: Record<Exclude<Phase, "done">, { title: string; sub: string }> = {
    intro: { title: "Tap here to start", sub: "Then wait for the circle to turn green and tap as fast as you can." },
    waiting: { title: "Wait for green…", sub: "Tap the moment it changes." },
    go: { title: "Tap now", sub: "" },
    early: { title: "A little too soon", sub: "That one doesn't count. Tap to try it again." },
    between: {
      title: `${times[times.length - 1] ?? ""} ms`,
      sub: `${times.length} of ${TRIALS} done. Tap for the next one.`,
    },
  };

  const again = () => {
    setTimes([]);
    setResult(null);
    setPhase("intro");
  };

  if (phase === "done") {
    return (
      <Screen
        lead={
          <div aria-live="polite">
            <h1 className="result-line">
              Your median: {result} ms <span className="badge badge-experiment">Experiment</span>
            </h1>
            <p className="muted">The middle of your five times. Lower means quicker.</p>
          </div>
        }
        actions={
          <>
            <Link href="/" className="btn btn-primary">
              Back to home
            </Link>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={again}>
                Do it again
              </button>
            </div>
          </>
        }
      >
        <div className="card">
          <p style={{ marginBottom: 0 }}>
            Your five times: {times.join(", ")} ms, each the time from green to your tap. Saved, and shown under your
            own level labelled as an experiment.
          </p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen
      lead={
        <>
          <h1 className="result-line">
            Reaction test <span className="badge badge-experiment">Experiment</span>
          </h1>
          <p className="muted">
            Five quick taps. We don&apos;t yet know how much this says about how you are, so it only goes into your own
            trends, labelled as an experiment.
          </p>
          <StepCount index={Math.min(times.length, TRIALS - 1)} total={TRIALS} label="Taps" />
        </>
      }
      actions={
        <div className="links">
          <Link href="/" className="btn btn-quiet">
            Back to home
          </Link>
        </div>
      }
    >
      <button
        type="button"
        className="reaction-pad"
        data-phase={phase}
        onPointerDown={(e) => {
          e.preventDefault();
          press();
        }}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            if (!e.repeat) press();
          }
        }}
      >
        <span className="reaction-title">{padText[phase].title}</span>
        {padText[phase].sub && <span className="reaction-sub">{padText[phase].sub}</span>}
      </button>
      <p className="small muted">
        You can use the mouse, a finger, or the space bar.
        {previous && phase === "intro" ? ` Last time your median was ${previous.medianMs} ms.` : ""}
      </p>
    </Screen>
  );
}
