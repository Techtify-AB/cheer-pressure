"use client";

import { useRef } from "react";

/** The header on every screen: the name, and "Need help now?" with 112 and the clinic. */
export function Shell({ children }: { children: React.ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <div className="app">
      <header className="top">
        <span className="brand">Cheer Pressure</span>
        <button type="button" className="help-link" onClick={() => dialog.current?.showModal()}>
          Need help now?
        </button>
      </header>
      {children}
      <dialog ref={dialog} className="help" aria-labelledby="help-title">
        <div className="help-body">
          <h1 id="help-title">Need help now?</h1>
          <p>If you or someone else is in danger, call the emergency number right away.</p>
          <a className="call" href="tel:112">
            Call 112
          </a>
          <div className="placeholder" role="note">
            <strong>Placeholder: the clinic</strong>
            The clinic&apos;s phone number and opening hours go here.
          </div>
          <button type="button" className="quiet" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
      </dialog>
    </div>
  );
}

/** One step: the lead (title and one line), what to look at or pick, and the actions. */
export function Screen({
  title,
  line,
  children,
  actions,
}: {
  title: string;
  line?: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <main className="screen">
      <div className="lead">
        <h1>{title}</h1>
        {line ? <p>{line}</p> : null}
      </div>
      {children ? <div className="body">{children}</div> : null}
      {actions ? <div className="actions">{actions}</div> : null}
    </main>
  );
}

export function statusLabel(status: string): string {
  if (status === "sending") return "Sending";
  if (status === "sent") return "Sent";
  if (status === "waiting for connection") return "Waiting for connection. It goes when you're back online.";
  return "Not sent";
}

export function when(ts: string): string {
  const d = new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday at ${time}`;
  return `${d.toLocaleDateString([], { weekday: "long" })} at ${time}`;
}

export function Offline({ show }: { show: boolean }) {
  return show ? (
    <p className="offline" role="status">
      You&apos;re offline. Messages go as soon as you&apos;re back.
    </p>
  ) : null;
}
