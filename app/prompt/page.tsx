"use client";

// The conversation with the companion. It opens on what is due (lib/ladder.ts):
//
// - When at least two measures stand out (lib/passive.ts): first a plain explanation
//   of what changed, then "How are you doing?" with three answers.
// - Opened by the person's own choice with nothing standing out: the question only.
// - After "Not my best": step 1, one small thing from the routines the person has on.
//   Two days later, if the measures have not come back: step 2, someone you trust.
//   Seven days later: step 3, a short summary for the clinic.
//   "I'd like someone to check in on me" goes straight to step 2.
//
// Each step is one screen with one primary action and a decline. No percentages, no
// score, no diagnosis words.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Disclosure, Says, Screen, StepCount } from "@/components/Screen";
import { useCompanionStatus, useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import type { CompanionState } from "@/components/companion/Companion";
import { SUGGESTIONS } from "@/lib/brain";
import { createLocalContact, type Contact, type ContactReply } from "@/lib/contact";
import { newId } from "@/lib/dates";
import {
  answerClinic,
  answerReply,
  answerSmallThing,
  answerSomeone,
  clinicSummary,
  isActive,
  requestSomeone,
  startAfterNotBest,
  type Due,
} from "@/lib/ladder";
import { evaluatePassive } from "@/lib/passive";
import { forRule, pickSmallThing, routinesOf } from "@/lib/settings";
import { hasDemo, readData, saveCheckIn, saveLadder, useData } from "@/lib/storage";
import type { AppData, CheckInAnswer } from "@/lib/types";

const QUESTION = "How are you doing?";

const ANSWERS: { value: Exclude<CheckInAnswer, "not-now">; label: string }[] = [
  { value: "okay", label: "I'm okay" },
  { value: "not-best", label: "Not my best" },
  { value: "someone", label: "I'd like someone to check in on me" },
];

type View =
  | "explain"
  | "ask"
  | "okay"
  | "small-thing"
  | "small-thing-done"
  | "someone"
  | "someone-asked"
  | "clinic"
  | "clinic-done"
  | "declined"
  | "waiting";

function firstView(due: Due, ladderActive: boolean): View {
  if (due === "ask") return "explain";
  if (due === "small-thing" || due === "someone" || due === "clinic") return due;
  return ladderActive ? "waiting" : "ask";
}

export default function PromptPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const { outcome } = useCompanionStatus(data);
  if (!data || !ready || !outcome) return null;
  return <Conversation data={data} start={firstView(outcome.due, isActive(data.ladder))} />;
}

function Conversation({ data, start }: { data: AppData; start: View }) {
  const router = useRouter();
  const today = useToday();
  const voice = useCompanionVoice();
  // Judged once when the conversation opens, so saving an answer does not change the text.
  const [evaluation] = useState(() => evaluatePassive(forRule(data), today));
  const [view, setView] = useState<View>(start);
  const [mood, setMood] = useState<CompanionState | null>(null);
  // What to say comes from the brain (lib/brain.ts); whether to ask came from lib/passive.ts.
  const { reflection } = useReflection(data, evaluation);
  const demo = hasDemo(data) || !!data.settings.simulatedChangeAt;
  const simulated = evaluation.simulated || demo;
  const ladder = data.ladder;

  const contact = useRef<Contact | null>(null);
  const [reply, setReply] = useState<ContactReply | null>(null);
  const [replyAnswer, setReplyAnswer] = useState<"yes" | "no" | null>(null);

  const record = (value: CheckInAnswer) =>
    saveCheckIn({
      id: newId(),
      date: today,
      at: new Date().toISOString(),
      answer: value,
      triggeredBy: evaluation.askNow ? evaluation.changed.map((m) => ({ key: m.key, direction: m.direction ?? "up" })) : [],
      basedOn: evaluation.basedOn,
      simulated: evaluation.simulated,
    });

  // "I'm okay" ends by itself after a short closing line.
  useEffect(() => {
    if (view !== "okay") return;
    const t = window.setTimeout(() => router.push("/"), 4000);
    return () => window.clearTimeout(t);
  }, [view, router]);

  const answer = (value: Exclude<CheckInAnswer, "not-now">) => {
    record(value);
    if (value === "okay") {
      setMood("joy");
      setView("okay");
    } else if (value === "not-best") {
      const preferred = reflection?.passive.suggestion.id ?? "walk";
      const routine = pickSmallThing(preferred, routinesOf(data.settings));
      saveLadder(startAfterNotBest(today, routine, simulated));
      setView("small-thing");
    } else {
      saveLadder(requestSomeone(readData().ladder, today, simulated));
      setView("someone");
    }
  };

  const home = (label = "Back to home") => (
    <Link href="/" className="btn btn-primary">
      {label}
    </Link>
  );

  const declinedLine = (
    <Screen
      lead={
        <Says state="idle" size={88}>
          <p>That&apos;s fine. I won&apos;t bring this up again for a few days.</p>
        </Says>
      }
      actions={home()}
    />
  );

  if (view === "declined") return declinedLine;

  if (view === "okay") {
    return (
      <Screen
        lead={
          <Says state={mood ?? "joy"} size={88}>
            <p>Good to hear. Thanks for telling me. That&apos;s all for now.</p>
          </Says>
        }
        actions={home()}
      />
    );
  }

  if (view === "waiting") {
    return (
      <Screen
        lead={
          <Says state="idle" size={88}>
            <p>
              Last time you said it wasn&apos;t your best. I&apos;m keeping an eye on things and will look again in a
              few days. Nothing is needed from you.
            </p>
          </Says>
        }
        actions={
          <>
            {home()}
            <div className="links">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  saveLadder(requestSomeone(readData().ladder, today, simulated));
                  setView("someone");
                }}
              >
                I&apos;d like someone to check in on me
              </button>
            </div>
          </>
        }
      />
    );
  }

  // Step 1: one small thing
  if (view === "small-thing" || view === "small-thing-done") {
    const routine = ladder?.smallThing?.routine ?? null;
    if (view === "small-thing-done") {
      const tried = ladder?.smallThing?.answer === "try";
      return (
        <Screen
          lead={
            <Says state={tried ? "joy" : "idle"} size={88}>
              <p>{tried ? "Good. I'll look again in two days." : "That's fine. I'll look again in a few days."}</p>
            </Says>
          }
          actions={
            <>
              {home()}
              <div className="links">
                <Link href="/weekly/" className="btn btn-quiet">
                  A few more questions, if you like
                </Link>
              </div>
            </>
          }
        />
      );
    }
    const done = (a: "try" | "not-now") => {
      const l = readData().ladder;
      if (l) saveLadder(answerSmallThing(l, a, today));
      setView("small-thing-done");
    };
    return (
      <Screen
        lead={
          <>
            <Says state="concern" size={88}>
              <p>Thanks for telling me. Not every day is a good one.</p>
              {routine ? (
                <p className="suggestion">
                  <strong>One small thing:</strong> {SUGGESTIONS[routine]}
                </p>
              ) : null}
            </Says>
            <StepCount index={0} total={3} label="One small thing" />
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => done("try")}>
              {routine ? "I'll try that" : "Okay"}
            </button>
            <div className="links">
              {routine && (
                <button type="button" className="btn btn-quiet" onClick={() => done("not-now")}>
                  Not now
                </button>
              )}
            </div>
          </>
        }
      >
        <p className="muted">I&apos;ll look again in two days and only come back if things still look different.</p>
      </Screen>
    );
  }

  // Step 2: someone you trust
  if (view === "someone") {
    return (
      <Screen
        lead={
          <>
            <Says state={voice.state === "speaking" ? "speaking" : "attention"} size={88}>
              <h1 id="someone-q">Would you like someone you trust to check in on you?</h1>
            </Says>
            <StepCount index={1} total={3} label="Someone you trust" />
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={async () => {
                const l = readData().ladder;
                if (l) saveLadder(answerSomeone(l, "yes", today));
                const c = createLocalContact({ demo });
                contact.current = c;
                c.onReply((r) => {
                  setReply(r);
                  setMood("joy");
                });
                await c.requestContact();
                setView("someone-asked");
              }}
            >
              Yes
            </button>
            <div className="links">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  const l = readData().ladder;
                  if (l) saveLadder(answerSomeone(l, "not-now", today));
                  setView("declined");
                }}
              >
                Not now
              </button>
            </div>
          </>
        }
      />
    );
  }

  if (view === "someone-asked") {
    const answerTheReply = (a: "yes" | "no") => {
      const l = readData().ladder;
      if (l) saveLadder(answerReply(l, a));
      setReplyAnswer(a);
      setMood(a === "yes" ? "joy" : "idle");
    };
    return (
      <Screen
        lead={
          <>
            {demo && (
              <span className="placeholder-tag sim-tag" role="note">
                Simulated reply, not connected yet
              </span>
            )}
            <Says state={mood ?? "idle"} size={88}>
              {replyAnswer ? (
                <p>{replyAnswer === "yes" ? "Lovely. Enjoy it." : "That's fine. You can answer them whenever you like."}</p>
              ) : (
                <p>
                  This isn&apos;t connected to anyone yet, so nothing was sent.
                  {demo ? " For the demo, here is what a reply could look like." : " You can call or message someone you trust yourself."}
                </p>
              )}
            </Says>
          </>
        }
        actions={
          reply && !replyAnswer ? (
            <>
              <button type="button" className="btn btn-primary" onClick={() => answerTheReply("yes")}>
                Yes
              </button>
              <div className="links">
                <button type="button" className="btn btn-quiet" onClick={() => answerTheReply("no")}>
                  No
                </button>
              </div>
            </>
          ) : (
            home()
          )
        }
      >
        {demo && (
          <section className="card reply-card" aria-live="polite" aria-label="Reply">
            {reply ? (
              <>
                <p className="small muted">Someone you trust (simulated)</p>
                <p className="reply-text">{reply.text}</p>
              </>
            ) : (
              <p className="muted">Waiting for a reply</p>
            )}
          </section>
        )}
      </Screen>
    );
  }

  // Step 3: the clinic
  if (view === "clinic" || view === "clinic-done") {
    const l = readData().ladder;
    if (view === "clinic-done") {
      return (
        <Screen
          lead={
            <Says state="idle" size={88}>
              <p>Marked as a demo recipient. Nothing was sent.</p>
            </Says>
          }
          actions={home()}
        />
      );
    }
    const text = l ? clinicSummary({ ladder: l, passive: evaluation, checkIns: data.checkIns }) : "";
    return (
      <Screen
        lead={
          <>
            <Says state={voice.state === "speaking" ? "speaking" : "attention"} size={88}>
              <h1>Would you like your clinic to get a short summary?</h1>
            </Says>
            <StepCount index={2} total={3} label="Your clinic" />
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const cur = readData().ladder;
                if (cur) saveLadder(answerClinic(cur, "approve", today));
                setView("clinic-done");
              }}
            >
              Approve
            </button>
            <div className="links">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  const cur = readData().ladder;
                  if (cur) saveLadder(answerClinic(cur, "not-now", today));
                  setView("declined");
                }}
              >
                Not now
              </button>
            </div>
          </>
        }
      >
        <section className="card stack-sm" aria-labelledby="share-title">
          <h2 id="share-title" className="small muted share-title">
            This is exactly what they would get
          </h2>
          <pre className="summary">{text}</pre>
        </section>
      </Screen>
    );
  }

  if (!reflection) return null;
  const explanation = reflection.passive.explanation;
  const notNow = () => {
    record("not-now");
    router.push("/");
  };

  if (view === "explain") {
    return (
      <Screen
        lead={
          <>
            <Says state={voice.state === "speaking" ? "speaking" : "attention"} size={88}>
              <p>{explanation}</p>
            </Says>
            <StepCount index={0} total={2} />
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => setView("ask")}>
              Next
            </button>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={notNow}>
                Not now
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => voice.say(explanation)}>
                Read this aloud
              </button>
            </div>
          </>
        }
      >
        <p className="muted">This compares you only with your own earlier days, never with other people.</p>
        <Disclosure title="How this is worked out">
          <p>
            A measure counts as changed only when your last three sessions or days in a row are all outside your usual
            range on the same side. I only ask when at least two have changed.
          </p>
          <ul className="worked-out">
            {evaluation.changed.map((m) => (
              <li key={m.key}>
                <strong>{m.label}</strong>: your last three were {(m.recentValues ?? []).map(m.format).join(", ")}.
                Your usual range is {m.usual ? `${m.format(m.usual.low)} to ${m.format(m.usual.high)}` : "not known yet"}
                , from {m.usual?.n ?? 0} earlier {m.unit === "session" ? "sessions" : "days"}.
              </li>
            ))}
          </ul>
          {evaluation.simulated && <p>This change is simulated with made-up demo data.</p>}
        </Disclosure>
      </Screen>
    );
  }

  // The question. Opened by the person's own choice, it comes without an explanation.
  const own = !evaluation.askNow;
  return (
    <Screen
      lead={
        <>
          <Says state={voice.state === "speaking" ? "speaking" : own ? "idle" : "attention"} size={88}>
            {own && <p className="small muted ask-note">Nothing stands out compared with your usual right now.</p>}
            <h1 id="question">{QUESTION}</h1>
          </Says>
          {!own && <StepCount index={1} total={2} />}
        </>
      }
      actions={
        <div className="links">
          {!own && (
            <button type="button" className="btn btn-quiet" onClick={() => setView("explain")}>
              Back
            </button>
          )}
          {own ? (
            <Link href="/" className="btn btn-quiet">
              Not now
            </Link>
          ) : (
            <button type="button" className="btn btn-quiet" onClick={notNow}>
              Not now
            </button>
          )}
          <button type="button" className="btn btn-quiet" onClick={() => voice.say(QUESTION)}>
            Read this aloud
          </button>
        </div>
      }
    >
      <div className="options" role="group" aria-labelledby="question">
        {ANSWERS.map((a) => (
          <button key={a.value} type="button" className="option" onClick={() => answer(a.value)}>
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </Screen>
  );
}
