"use client";

// 8. Ask someone to get in touch. A LOCAL DEMO: nothing is sent, and the messages service
// (lib/messages.ts, another part of the app) is not used. The person edits a short draft to the
// contact in their plan, taps Send, and after a short moment a made-up reply that matches the
// draft appears, marked Demo (lib/activities/reply.ts). They end with "That works".
// States: draft, sent, reply, then confirmed (the shared Done).
// Crisis words in the draft show the fixed help card (lib/crisis.ts); the demo send still completes.
// Easier: "Hi, do you have time to talk for a bit?", editable before sending.

import { useEffect, useId, useRef, useState } from "react";
import { CrisisCard } from "@/components/CrisisCard";
import { demoReply, DEMO_REPLY_DELAY_MS, EASIER_DRAFT, walkDraft } from "@/lib/activities/reply";
import { containsCrisisWords, containsCrisisWordsWhileTyping } from "@/lib/crisis";
import type { Plan } from "@/lib/plan";
import { ActivityScreen } from "./ActivityScreen";
import { useStopOnEnd, type ActivityRun } from "./useActivity";

type Stage = "draft" | "sent" | "reply";

export function Ask({ run, plan }: { run: ActivityRun; plan: Plan }) {
  const name = plan.contact.name;
  const [draft, setDraft] = useState(() => (run.easier ? EASIER_DRAFT : walkDraft(name)));
  const [stage, setStage] = useState<Stage>("draft");
  const [sent, setSent] = useState("");
  const [crisisOpen, setCrisisOpen] = useState(false);
  const shownFor = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const fieldId = useId();

  const stopReply = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useStopOnEnd(run, stopReply);
  useEffect(() => stopReply, []);

  const showCrisis = (text: string) => {
    if (shownFor.current === text) return;
    shownFor.current = text;
    setCrisisOpen(true);
  };

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    run.markStarted();
    setSent(text);
    setStage("sent");
    stopReply();
    timer.current = window.setTimeout(() => setStage("reply"), DEMO_REPLY_DELAY_MS);
    if (containsCrisisWords(text)) showCrisis(text);
  };

  const reply = demoReply(sent);
  const confirm = () =>
    run.finish({
      message:
        reply.kind === "walk"
          ? `Good. Enjoy the walk with ${name}.`
          : reply.kind === "talk"
            ? `Good. Enjoy talking with ${name}.`
            : `Good. Enjoy seeing ${name}.`,
    });

  return (
    <>
      <ActivityScreen
        run={run}
        title="Ask someone to get in touch"
        hideEasier={stage !== "draft"}
        text={
          stage === "draft" ? (
            <p>Send {name} a short message. You can change it first.</p>
          ) : stage === "sent" ? (
            <p>Sent. Waiting for {name}.</p>
          ) : (
            <p>{name} answered.</p>
          )
        }
        primary={
          stage === "draft" ? (
            <button type="button" className="btn btn-primary" data-act="send" onClick={send} disabled={!draft.trim()}>
              Send
            </button>
          ) : stage === "sent" ? (
            <button type="button" className="btn btn-primary" disabled>
              Waiting for a reply
            </button>
          ) : (
            <button type="button" className="btn btn-primary" data-act="done" onClick={confirm}>
              That works
            </button>
          )
        }
      >
        <p className="act-demo-note">
          <span className="placeholder-tag">Demo</span>
          <span>Nothing is sent. The reply is made up on this device.</span>
        </p>
        {stage === "draft" ? (
          <div className="act-field">
            <label htmlFor={fieldId} className="act-ask-label">
              To {name}
            </label>
            <textarea
              id={fieldId}
              className="act-draft"
              value={draft}
              maxLength={240}
              data-act="draft"
              onChange={(e) => {
                setDraft(e.target.value);
                if (containsCrisisWordsWhileTyping(e.target.value)) showCrisis(e.target.value);
              }}
              onBlur={(e) => {
                if (containsCrisisWords(e.target.value)) showCrisis(e.target.value);
              }}
            />
          </div>
        ) : (
          <div className="act-bubbles" aria-live="polite">
            <p className="act-bubble act-bubble-own">{sent}</p>
            <span className="act-bubble-meta">{stage === "sent" ? "Sending" : "Delivered (demo)"}</span>
            {stage === "reply" ? (
              <>
                <p className="act-bubble act-bubble-them" data-act="reply">
                  {reply.text}
                </p>
                <span className="act-bubble-meta">
                  <span className="placeholder-tag">Demo</span> {name}, a made-up reply
                </span>
              </>
            ) : null}
          </div>
        )}
      </ActivityScreen>
      <CrisisSheet open={crisisOpen} onClose={() => setCrisisOpen(false)} />
    </>
  );
}

/** The fixed help card, over the screen, until the person closes it. */
function CrisisSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet act-crisis-sheet" aria-label="Help now" onClose={onClose}>
      {open ? <CrisisCard /> : null}
      <button type="button" className="btn btn-secondary sheet-close" data-act="crisis-close" onClick={onClose}>
        Back to my message
      </button>
    </dialog>
  );
}
