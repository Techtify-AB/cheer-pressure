"use client";

// Steps and checklists for the activities: one card per step, the current one clearly marked,
// and a checklist the person can tick (ticking is never required for "Done").

import { useState } from "react";

/** Steps as cards, the current one marked; earlier ones show as done. */
export function StepCards({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="act-steps" aria-label="Steps">
      {steps.map((s, i) => {
        const state = i < current ? "done" : i === current ? "current" : "next";
        return (
          <li key={i} className="act-step" data-state={state} aria-current={i === current ? "step" : undefined}>
            <span className="act-step-num" aria-hidden="true">
              {state === "done" ? <Check /> : i + 1}
            </span>
            <span className="act-step-body">
              <span className="act-step-label">
                Step {i + 1} of {steps.length}
                {state === "current" ? ", now" : state === "done" ? ", done" : ""}
              </span>
              <span className="act-step-text">{s}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** One step, large: the thing to do right now. */
export function OneStep({ children, label = "Your first step" }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="act-one-step">
      <span className="act-step-label">{label}</span>
      <p className="act-one-step-text">{children}</p>
    </div>
  );
}

/** A checklist: tap a row to tick it. */
export function Checklist({ items, label, onTick }: { items: string[]; label: string; onTick?: () => void }) {
  const [ticked, setTicked] = useState<boolean[]>(() => items.map(() => false));
  return (
    <ul className="act-checklist" aria-label={label}>
      {items.map((item, i) => (
        <li key={i}>
          <button
            type="button"
            role="checkbox"
            aria-checked={ticked[i]}
            className="act-check"
            onClick={() => {
              onTick?.();
              setTicked((t) => t.map((v, j) => (j === i ? !v : v)));
            }}
          >
            <span className="act-check-box" aria-hidden="true">
              {ticked[i] ? <Check /> : null}
            </span>
            <span>{item}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Check() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
