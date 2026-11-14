"use client";

// Other ways to reach someone, for people with no one to ask (step two of the ladder, and
// Settings, People you trust). One screen, at most three choices (lib/ladder.ts someoneOptions):
//
//   1. Add someone now: the existing invite flow (Settings, People you trust).
//   2. Your clinic's contact person: the clearly marked placeholder from the help screen. No
//      message is sent.
//   3. Someone who has been through this too: a peer. NOT a real connection in this version, and
//      it never looks like one: the whole flow says "Demo. Peer contact is not connected yet." A
//      made-up exchange in the trusted-person pattern, with local states only. Nothing goes to the
//      messages service or anywhere else. No matching, no accounts, no real peer messaging.

import Link from "next/link";
import { useEffect, useState } from "react";
import { ClinicContactPlaceholder } from "@/components/ClinicContactPlaceholder";
import { GreetingScreen, ReplyCrisisScreen } from "@/components/Greeting";
import { Says, Screen } from "@/components/Screen";
import type { ContactReply } from "@/lib/contact";
import { PEER_DEMO_REPLY, PEER_DEMO_REPLY_AFTER_MS, PEER_REQUEST_TEXT } from "@/lib/ladder";

export const PEER_DEMO_TAG = "Demo. Peer contact is not connected yet.";

type View = "list" | "clinic" | "peer" | "peer-sent" | "peer-reply" | "peer-done" | "crisis";

export function OtherWays({
  onBack,
  onChose,
  backLabel = "Back",
  title = "Would you like to see or talk to someone?",
}: {
  onBack: () => void;
  /** Called when the person takes a way forward (the clinic's contact, or the peer demo). */
  onChose?: (way: "clinic-contact" | "peer-demo") => void;
  backLabel?: string;
  title?: string;
}) {
  const [view, setView] = useState<View>("list");
  const [answer, setAnswer] = useState<string | null>(null);

  useEffect(() => {
    if (view !== "peer-sent") return;
    const t = window.setTimeout(() => setView("peer-reply"), PEER_DEMO_REPLY_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [view]);

  const tag = (
    <span className="placeholder-tag sim-tag" role="note">
      {PEER_DEMO_TAG}
    </span>
  );
  const back = (
    <div className="links">
      <button type="button" className="btn btn-quiet" onClick={() => (view === "list" ? onBack() : setView("list"))}>
        {view === "list" ? backLabel : "Back"}
      </button>
    </div>
  );

  if (view === "crisis") return <ReplyCrisisScreen name="Sam (demo)" onDone={() => setView("list")} />;

  if (view === "clinic") {
    return (
      <Screen
        lead={
          <Says state="idle" size={72}>
            <h1>Your clinic&apos;s contact person</h1>
            <p className="small muted">You can call or write to them yourself. Nothing is sent from here.</p>
          </Says>
        }
        actions={back}
      >
        <ClinicContactPlaceholder />
      </Screen>
    );
  }

  if (view === "peer") {
    return (
      <Screen
        lead={
          <>
            {tag}
            <Says state="idle" size={72}>
              <h1>Someone who has been through this too</h1>
            </Says>
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                onChose?.("peer-demo");
                setView("peer-sent");
              }}
            >
              Show me how it would go
            </button>
            {back}
          </>
        }
      >
        <ul className="card peer-how">
          <li>Both of you say yes to it first.</li>
          <li>First names only.</li>
          <li>It runs through your clinic&apos;s own peer group, and someone from the clinic can step in.</li>
        </ul>
      </Screen>
    );
  }

  if (view === "peer-sent") {
    return (
      <Screen
        lead={
          <>
            {tag}
            <Says state="idle" size={72}>
              <p>For the demo: you would send this. Nothing was sent.</p>
            </Says>
          </>
        }
        actions={back}
      >
        <section className="card reply-card" aria-live="polite">
          <p className="small muted">{PEER_REQUEST_TEXT}</p>
          <p className="muted">Waiting for a demo reply</p>
        </section>
      </Screen>
    );
  }

  if (view === "peer-reply") {
    const reply: ContactReply = { id: null, text: PEER_DEMO_REPLY, kind: "question", fromName: "Sam (demo)", simulated: true, at: new Date().toISOString() };
    return (
      <GreetingScreen
        reply={reply}
        note={tag}
        onAnswer={(a, text) => {
          setAnswer(a === "yes" ? "yes" : a === "no" ? "no" : (text ?? ""));
          setView("peer-done");
        }}
        onCrisis={() => setView("crisis")}
      />
    );
  }

  if (view === "peer-done") {
    return (
      <Screen
        lead={
          <>
            {tag}
            <Says state="idle" size={72}>
              <p>
                {answer === "no" ? "That's fine." : "That's how it would go."} In a real version your clinic&apos;s peer group would set
                this up. Nothing was sent.
              </p>
            </Says>
          </>
        }
        actions={
          <>
            <Link href="/" className="btn btn-primary">
              Back to home
            </Link>
            {back}
          </>
        }
      />
    );
  }

  return (
    <Screen
      lead={
        <Says state="idle" size={72}>
          <h1 id="other-ways">{title}</h1>
          <p className="small muted">A few ways to reach someone. Pick one, or none.</p>
        </Says>
      }
      actions={back}
    >
      <div className="options" role="group" aria-labelledby="other-ways">
        <Link href="/settings/#trust" className="option">
          <span>Add someone now</span>
          <span className="small muted option-hint">A friend, family</span>
        </Link>
        <button
          type="button"
          className="option"
          onClick={() => {
            onChose?.("clinic-contact");
            setView("clinic");
          }}
        >
          <span>Your clinic&apos;s contact person</span>
        </button>
        <button type="button" className="option" onClick={() => setView("peer")}>
          <span>Someone who has been through this too</span>
          <span className="small muted option-hint">Demo</span>
        </button>
      </div>
    </Screen>
  );
}
