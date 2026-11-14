"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRequireProfile, useToday } from "@/components/hooks";
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

  return (
    <div className="stack-lg">
      <div className="stack">
        <span className="badge badge-experiment">Experiment</span>
        <h1>Reaction test</h1>
        <p className="muted">
          Five quick taps. This is an experiment: we don&apos;t yet know how much it says about how you are, so it
          only goes into your own trends, labelled as an experiment.
        </p>
      </div>

      {phase !== "done" ? (
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
      ) : (
        <div className="card stack" aria-live="polite">
          <div>
            <div className="big-number">{result} ms</div>
            <p className="muted" style={{ margin: 0 }}>
              Your median: the middle of your five times. Lower means quicker.
            </p>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Your five times: {times.join(", ")} ms. Saved.
          </p>
          <div className="btn-row">
            <Link href="/" className="btn btn-secondary">
              Back to home
            </Link>
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setTimes([]);
                setResult(null);
                setPhase("intro");
              }}
            >
              Do it again
            </button>
          </div>
        </div>
      )}

      {previous && phase === "intro" && (
        <p className="small muted">
          Last time your median was {previous.medianMs} ms.
        </p>
      )}
      <p className="small muted">You can use the mouse, a finger, or the space bar.</p>
    </div>
  );
}
