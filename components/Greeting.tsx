"use client";

// A greeting or question from someone the person trusts, and the person's answer: Yes or No
// to a question, a thank-you to a greeting, or a few written words. One screen at a time: the
// message with its answers, then (if they choose to write) a box with Send.
//
// Used on home (when a greeting arrives at any time) and in the ladder's step two (the reply
// to "get in touch"). Only the newest unanswered message is ever shown; no history.

import Link from "next/link";
import { useState } from "react";
import { Companion } from "@/components/companion/Companion";
import { CrisisCard } from "@/components/CrisisCard";
import { Says, Screen } from "@/components/Screen";
import type { ContactReply } from "@/lib/contact";
import { containsCrisisWords } from "@/lib/crisis";
import { charLength, checkText, TEXT_MAX, type Answer } from "@/lib/events";

export const who = (r: ContactReply) => r.fromName ?? (r.simulated ? "Someone you trust (simulated)" : "Someone you trust");

/** "Sara: Walk after lunch?" */
export function MessageLine({ reply, className = "greeting-line" }: { reply: ContactReply; className?: string }) {
  return (
    <p className={className}>
      <span className="greeting-from">{who(reply)}:</span> <span className="greeting-text">{reply.text}</span>
    </p>
  );
}

export function GreetingScreen({
  reply,
  onAnswer,
  hero = false,
  note,
}: {
  reply: ContactReply;
  /** Called with the answer; the caller sends it and the screen moves on. */
  onAnswer: (answer: Answer | null, text?: string) => void;
  /** The large companion, as on home. */
  hero?: boolean;
  /** A short line above the message, for example the stand-in's "Simulated" tag. */
  note?: React.ReactNode;
}) {
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState("");
  const [crisis, setCrisis] = useState(false);
  const name = who(reply);
  const question = reply.kind === "question";

  if (crisis) {
    return (
      <Screen
        lead={
          <Says state="concern" size={72}>
            <p>Your words went to {name}.</p>
          </Says>
        }
        actions={
          <div className="links">
            <Link href="/" className="btn btn-quiet">
              Back to home
            </Link>
          </div>
        }
      >
        <CrisisCard />
      </Screen>
    );
  }

  if (writing) {
    const t = text.trim();
    const valid = checkText(t).ok;
    const left = TEXT_MAX - charLength(t);
    const send = () => {
      if (!valid) return;
      // Crisis words in a reply to the trusted person: the message is still sent. It is the
      // person's own message to someone they chose to trust, and holding it back could keep
      // help away. The fixed help card (lib/crisis.ts, components/CrisisCard.tsx) is shown to
      // the person as everywhere else.
      onAnswer(null, t);
      if (containsCrisisWords(t)) setCrisis(true);
    };
    return (
      <Screen
        lead={
          <Says state="listening" size={72}>
            <MessageLine reply={reply} className="greeting-line small-line" />
          </Says>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" disabled={!valid || left < 0} onClick={send}>
              Send to {name}
            </button>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={() => setWriting(false)}>
                Back
              </button>
            </div>
          </>
        }
      >
        <div className="field">
          <label htmlFor="reply-text">A few words back</label>
          <textarea
            id="reply-text"
            value={text}
            maxLength={TEXT_MAX + 20}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <p className={left < 0 ? "small field-note error-text" : "small muted field-note"} aria-live="polite">
            {t ? (left < 0 ? `${-left} characters too long` : `${left} characters left`) : `Only ${name} sees this.`}
          </p>
        </div>
      </Screen>
    );
  }

  const lead = hero ? (
    <div className="home-hero">
      {note}
      <Companion state="joy" size={260} />
      <MessageLine reply={reply} className="calm-line greeting-line" />
    </div>
  ) : (
    <>
      {note}
      <Says state="joy" size={88}>
        <MessageLine reply={reply} />
      </Says>
    </>
  );

  return (
    <Screen
      lead={lead}
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={() => onAnswer(question ? "yes" : null, question ? undefined : "Thank you")}>
            {question ? "Yes" : "Thank you"}
          </button>
          <div className="links">
            {question && (
              <button type="button" className="btn btn-quiet" onClick={() => onAnswer("no")}>
                No
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={() => setWriting(true)}>
              Write back
            </button>
          </div>
        </>
      }
    />
  );
}
