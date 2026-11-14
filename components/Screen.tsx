"use client";

// The building blocks every screen uses, so they all have the same order and fit in
// one view: the lead (the answer or the question first), the content, then the
// actions at the bottom (one primary action, everything else a quiet link). Long
// content is paged one item at a time, and details sit behind one disclosure.

import { useEffect, useId, useRef, useState } from "react";
import { Companion, type CompanionState } from "@/components/companion/Companion";

export function Screen({
  lead,
  children,
  actions,
}: {
  lead: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="screen">
      <div className="screen-lead">{lead}</div>
      {children ? <div className="screen-body">{children}</div> : null}
      {actions ? <div className="screen-actions">{actions}</div> : null}
    </div>
  );
}

/** The companion and what it says. */
export function Says({
  state,
  size = 72,
  children,
}: {
  state: CompanionState;
  size?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="says">
      <Companion state={state} size={size} />
      <div className="bubble" aria-live="polite">
        {children}
      </div>
    </div>
  );
}

/** "2 of 4" with a bar, for flows with several steps. */
export function StepCount({ index, total, label }: { index: number; total: number; label?: string }) {
  return (
    <div className="step-count">
      <div className="progress" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i <= index ? "on" : ""} />
        ))}
      </div>
      <span>
        {label ? `${label}, ` : ""}
        {index + 1} of {total}
      </span>
    </div>
  );
}

/** Previous, "3 of 6" with dots, Next. Next is the screen's one primary action. */
export function Pager({
  index,
  total,
  onChange,
  nextLabel = "Next",
  onPastEnd,
  pastEndLabel,
  secondary = false,
}: {
  index: number;
  total: number;
  onChange: (i: number) => void;
  nextLabel?: string;
  onPastEnd?: () => void;
  pastEndLabel?: string;
  /** Next as a secondary button, when the screen's one primary action is something else. */
  secondary?: boolean;
}) {
  const last = index >= total - 1;
  const nextClass = secondary ? "btn btn-secondary" : "btn btn-primary";
  return (
    <div className="pager">
      <button
        type="button"
        className="btn btn-quiet"
        disabled={index === 0}
        style={index === 0 ? { visibility: "hidden" } : undefined}
        onClick={() => onChange(index - 1)}
      >
        Previous
      </button>
      <div className="pager-count" aria-live="polite">
        <span>
          {index + 1} of {total}
        </span>
        <span className="pager-dots" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={i === index ? "on" : ""} />
          ))}
        </span>
      </div>
      {last ? (
        onPastEnd ? (
          <button type="button" className={nextClass} onClick={onPastEnd}>
            {pastEndLabel ?? "Done"}
          </button>
        ) : (
          <span />
        )
      ) : (
        <button type="button" className={nextClass} onClick={() => onChange(index + 1)}>
          {nextLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The one disclosure on a screen: a clearly labelled quiet button that opens a sheet
 * with the details. Escape or "Close" closes it. Never a panel inside a panel.
 */
export function Disclosure({
  label = "Show how this is worked out",
  title,
  children,
}: {
  label?: string;
  title: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="btn btn-quiet disclosure"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {label}
      </button>
      <dialog
        ref={ref}
        className="sheet"
        aria-labelledby={titleId}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          // A click on the dimmed area outside the sheet closes it.
          const r = e.currentTarget.getBoundingClientRect();
          const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
          if (e.target === e.currentTarget && outside) setOpen(false);
        }}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="sheet-body">{children}</div>
        <button type="button" className="btn btn-secondary sheet-close" onClick={() => setOpen(false)}>
          Close
        </button>
      </dialog>
    </>
  );
}
