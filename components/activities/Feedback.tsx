"use client";

// After an activity: one question on its own screen, "Did that help?" (gentler when it was
// ended partway), three taps and a quiet Skip; one tap answers and closes. Then a short close,
// with a quick reaction check offered as an optional extra at most once a day.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Says, Screen } from "@/components/Screen";
import { mayOfferReaction } from "@/lib/activities/reaction";
import { todayKey } from "@/lib/dates";
import { markReactionOffered, readData } from "@/lib/storage";
import type { ActivityFeedback } from "@/lib/types";
import { ReactionCheck } from "./ReactionCheck";
import type { ActivityRun } from "./useActivity";
import { LIBRARY_HREF } from "./useActivity";

const ANSWERS: { value: ActivityFeedback; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "a-little", label: "A little" },
  { value: "no", label: "Not really" },
];

export function FeedbackView({ run }: { run: ActivityRun }) {
  const ended = !!run.done?.ended;
  return (
    <Screen
      lead={
        <Says state="attention" size={80}>
          {ended ? <p className="act-feedback-pre">Stopping partway is fine.</p> : null}
          <h1 className="act-done-title" id="act-feedback-q">
            {ended ? "Did any of it help?" : "Did that help?"}
          </h1>
        </Says>
      }
      actions={
        <div className="links">
          <button type="button" className="btn btn-quiet" data-act="skip-feedback" onClick={() => run.answer(null)}>
            Skip
          </button>
        </div>
      }
    >
      <div className="act-feedback" role="group" aria-labelledby="act-feedback-q">
        {ANSWERS.map((a) => (
          <button
            key={a.value}
            type="button"
            className="option act-feedback-option"
            data-feedback={a.value}
            onClick={() => run.answer(a.value)}
          >
            {a.label}
          </button>
        ))}
      </div>
      <p className="muted small act-done-note">This helps Cheri suggest what works for you. It stays on this device.</p>
    </Screen>
  );
}

/** The close after the question, with the once-a-day offer of a reaction check. */
export function AfterView({ run }: { run: ActivityRun }) {
  const today = todayKey();
  const [offer] = useState(() => mayOfferReaction(readData().reactionOfferedOn, today));
  const [answer, setAnswer] = useState<"open" | "yes" | "no">("open");
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (offer) markReactionOffered(today);
  }, [offer, today]);

  const ended = !!run.done?.ended;
  const fb = run.done?.entry.feedback;
  const line =
    run.done?.message && !ended
      ? run.done.message
      : ended
        ? "Thanks. You can come back to it any time."
        : fb === "no"
          ? "Thanks for telling me. Next time I can suggest something else."
          : "Good. That was one thing for you.";

  if (answer === "yes") {
    return (
      <Screen
        lead={<ReactionCheck context="after-activity" onFinished={() => setFinished(true)} />}
        actions={
          finished ? (
            <Link href="/" className="btn btn-primary" data-act="home">
              Back to home
            </Link>
          ) : (
            <div className="links">
              <button type="button" className="btn btn-quiet" data-act="stop-reaction" onClick={() => setAnswer("no")}>
                Stop
              </button>
            </div>
          )
        }
      />
    );
  }

  return (
    <Screen
      lead={
        <Says state="joy" size={80}>
          <h1 className="act-done-title">{line}</h1>
        </Says>
      }
      actions={
        <>
          <Link href="/" className="btn btn-primary" data-act="home">
            Back to home
          </Link>
          <div className="links">
            <Link href={LIBRARY_HREF} className="btn btn-quiet">
              Something else
            </Link>
          </div>
        </>
      }
    >
      <p className="muted act-done-note">Noted on this device. Only you see it.</p>
      {offer && answer === "open" ? (
        <div className="act-offer" data-act="reaction-offer">
          <span>A quick reaction check? 15 seconds.</span>
          <span className="act-offer-buttons">
            <button type="button" className="btn btn-quiet" data-act="reaction-yes" onClick={() => setAnswer("yes")}>
              Okay
            </button>
            <button type="button" className="btn btn-quiet" data-act="reaction-no" onClick={() => setAnswer("no")}>
              Not now
            </button>
          </span>
        </div>
      ) : null}
    </Screen>
  );
}
