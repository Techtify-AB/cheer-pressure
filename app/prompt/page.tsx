"use client";

// The conversation with Cheri. It opens on what is due (lib/ladder.ts):
//
// - When the measures stand out the way lib/passive.ts asks about (at least two different
//   categories; no category alone): first a plain explanation
//   of what changed, then "How are you doing?" with three answers.
// - Opened by the person's own choice with nothing standing out: the question only.
// - After "Not my best": step 1, ONE thing from the person's own "What helps you?" list,
//   chosen by the brain (lib/brain.ts chooseHelp; the rule version orders the list by the plain
//   count in lib/helps.ts). "I'll try that", "Something else" (the next one) or "Not now".
//   Each offer is recorded, and later judged by whether the categories came back.
//   Two days later, if the measures have not come back: step 2, someone you trust.
//   Seven days later: step 3, a short summary for the clinic.
//   "I'd like someone to check in on me" goes straight to step 2.
//   Step 2 sends a real request through lib/contact.ts when a pair exists (Settings, Someone
//   you trust), shows "Sent" or "Waiting for connection", then the trusted person's reply with
//   Yes, No or a few words back. Without a pair it sends nothing; in demo mode it shows a reply
//   clearly marked as simulated.
//
// Each step is one screen with one primary action and a decline. No percentages, no
// score, no diagnosis words.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Disclosure, Says, Screen, StepCount } from "@/components/Screen";
import { useCompanionStatus, useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import type { CompanionState } from "@/components/companion/Companion";
import { brain, helpChoiceInput, type HelpChoice } from "@/lib/brain";
import { GreetingScreen, ReplyCrisisScreen, who } from "@/components/Greeting";
import { chooseContact, CONTACT_REQUEST_TEXT, type Contact, type ContactState } from "@/lib/contact";
import type { Answer } from "@/lib/events";
import { newId } from "@/lib/dates";
import { answerOffer, helpsOf, learnedLine, offeredIn, openOffer, recordOffer, suggestionText } from "@/lib/helps";
import {
  answerClinic,
  answerReply,
  answerSmallThing,
  answerSomeone,
  isActive,
  offerNext,
  requestSomeone,
  startWithHelp,
  type Due,
} from "@/lib/ladder";
import { evaluatePassive, SOURCES } from "@/lib/passive";
import { forRule } from "@/lib/settings";
import { hasDemo, readData, saveCheckIn, saveLadder, saveSuggestions, useData } from "@/lib/storage";
import { messagesClient } from "@/lib/trusted";
import type { AppData, CheckInAnswer, HelpItem } from "@/lib/types";

/**
 * Where "I'll try that" goes for one thing on the person's list: a screen that helps them do it,
 * or null to stay in the conversation. The activity library plugs in here, and only here.
 */
function activityLinkFor(item: Pick<HelpItem, "id" | "label" | "own">): string | null {
  // activity link goes here
  void item;
  return null;
}

/** Offers one thing from the person's list (the brain chooses) and records it. Null: nothing is on. */
async function offerHelp(today: string, ladderStartedOn: string, simulated: boolean): Promise<HelpChoice | null> {
  const d = readData();
  const history = d.suggestions ?? [];
  const choice = await brain.chooseHelp(helpChoiceInput(today, helpsOf(d), history, offeredIn(history, ladderStartedOn)));
  if (choice) saveSuggestions(recordOffer(history, { id: newId(), ladderStartedOn, today, item: choice.item, learned: choice.learned, simulated }));
  return choice;
}

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

  // The contact this conversation asked through (state, so the screen updates with it).
  const [contact, setContact] = useState<Contact | null>(null);
  const stopContact = useRef<(() => void) | null>(null);
  const [contactState, setContactState] = useState<ContactState | null>(null);
  const [replyAnswer, setReplyAnswer] = useState<{ answer: Answer | null; text?: string } | null>(null);
  const [crisisFor, setCrisisFor] = useState<string | null>(null);
  // The plain line when step one's suggestion comes first because of what followed it before.
  const [reason, setReason] = useState<string | null>(null);
  const [listDone, setListDone] = useState(false);
  useEffect(() => () => stopContact.current?.(), []);

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
      void offerHelp(today, today, simulated).then((choice) => {
        saveLadder(startWithHelp(today, choice && { item: choice.item.id, label: choice.item.label, learned: choice.learned }, simulated));
        setReason(choice?.reason ?? null);
        setView("small-thing");
      });
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

  // Step 1: one thing from the person's own list
  if (view === "small-thing" || view === "small-thing-done") {
    const st = ladder?.smallThing;
    const item = st?.item ? helpsOf(data).find((h) => h.id === st.item) ?? { id: st.item, label: st.label ?? st.item, on: true, own: true } : null;
    if (view === "small-thing-done") {
      const tried = st?.answer === "try";
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
    const answerIt = (a: "try" | "other" | "not-now") => {
      const d = readData();
      const l = d.ladder;
      const open = l ? openOffer(d.suggestions ?? [], l.startedOn) : null;
      if (open) saveSuggestions(answerOffer(d.suggestions ?? [], open.id, a));
      return l;
    };
    const done = (a: "try" | "not-now") => {
      const l = answerIt(a);
      if (l) saveLadder(answerSmallThing(l, a, today));
      const link = a === "try" && item ? activityLinkFor(item) : null;
      if (link) router.push(link);
      else setView("small-thing-done");
    };
    const somethingElse = () => {
      const l = answerIt("other");
      if (!l) return;
      void offerHelp(today, l.startedOn, simulated).then((next) => {
        if (!next) {
          setListDone(true);
          return;
        }
        saveLadder(offerNext(readData().ladder ?? l, { item: next.item.id, label: next.item.label, learned: next.learned }, today));
        setReason(next.reason);
      });
    };
    const empty = !item || listDone;
    const why = reason ?? (st?.learned && item ? learnedLine(item) : null);
    return (
      <Screen
        lead={
          <>
            <Says state="concern" size={88}>
              <p>Thanks for telling me. Not every day is a good one.</p>
              {!empty ? (
                <p className="suggestion">
                  <strong>From your list:</strong> {suggestionText(item)}
                </p>
              ) : (
                <p className="suggestion">
                  {listDone ? "That's everything on your list for now." : "Your list of what helps is empty, so I have nothing to suggest yet."}
                </p>
              )}
              {!empty && why && <p className="learned-line">{why}</p>}
            </Says>
            <StepCount index={0} total={3} label="Something for you" />
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => done(empty ? "not-now" : "try")}>
              {empty ? "Okay" : "I'll try that"}
            </button>
            <div className="links">
              {!empty && (
                <button type="button" className="btn btn-quiet" onClick={somethingElse}>
                  Something else
                </button>
              )}
              {!empty ? (
                <button type="button" className="btn btn-quiet" onClick={() => done("not-now")}>
                  Not now
                </button>
              ) : (
                <Link href="/settings/#helps" className="btn btn-quiet">
                  Change what helps you
                </Link>
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
                // The real request when a pair exists; the stand-in (simulated in demo mode) otherwise.
                const c = chooseContact({ client: messagesClient(), demo });
                setContact(c);
                stopContact.current?.();
                const stopChange = c.onChange(setContactState);
                const stopReply = c.onReply(() => setMood("joy"));
                stopContact.current = () => {
                  stopChange();
                  stopReply();
                };
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
    const c = contact;
    const st = contactState ?? c?.state() ?? null;
    const reply = st?.reply ?? null;
    const simulatedReply = !!c?.simulated;
    const answerTheReply = (a: Answer | null, text?: string) => {
      c?.answer(a, text);
      const l = readData().ladder;
      if (l && a) saveLadder(answerReply(l, a));
      setReplyAnswer({ answer: a, text });
      setMood(a === "no" ? "idle" : "joy");
    };
    const simTag = simulatedReply && demo && (
      <span className="placeholder-tag sim-tag" role="note">
        Simulated reply, not connected yet
      </span>
    );

    if (reply && crisisFor) return <ReplyCrisisScreen name={crisisFor} onDone={() => router.push("/")} />;

    if (reply && !replyAnswer && !st?.answered) {
      return (
        <GreetingScreen
          key={reply.id ?? "simulated"}
          reply={reply}
          onAnswer={answerTheReply}
          onCrisis={() => setCrisisFor(who(reply))}
          note={simTag}
        />
      );
    }

    if (reply) {
      const given = replyAnswer ?? st?.answered;
      const name = who(reply);
      const delivery = !simulatedReply ? st?.answered?.status : undefined;
      return (
        <Screen
          lead={
            <>
              {simTag}
              <Says state={mood ?? "joy"} size={88}>
                <p>
                  {given?.answer === "yes"
                    ? "Lovely. Enjoy it."
                    : given?.answer === "no"
                      ? "That's fine. You can talk to them whenever you like."
                      : `Thanks. Your words are on their way to ${name}.`}
                </p>
              </Says>
            </>
          }
          actions={home()}
        >
          {delivery && delivery !== "sent" && (
            <p className="small muted" role="status">
              {delivery === "waiting for connection"
                ? "Waiting for connection. Your answer goes as soon as I can reach the service."
                : delivery === "not sent"
                  ? "Your answer could not be sent."
                  : "Sending"}
            </p>
          )}
        </Screen>
      );
    }

    // Nobody is connected and this is not the demo: nothing was sent, and it says so.
    if (!c || (simulatedReply && !demo)) {
      return (
        <Screen
          lead={
            <Says state="idle" size={88}>
              <p>
                You haven&apos;t connected anyone yet, so nothing was sent. You can invite someone in Settings, or call or
                message someone you trust yourself.
              </p>
            </Says>
          }
          actions={
            <>
              {home()}
              <div className="links">
                <Link href="/settings/#trust" className="btn btn-quiet">
                  Invite someone
                </Link>
              </div>
            </>
          }
        />
      );
    }

    const status = st?.status ?? "sending";
    const name = st?.trustedName;
    const statusLabel =
      status === "sent" ? "Sent" : status === "waiting for connection" ? "Waiting for connection" : status === "not sent" ? "Not sent" : "Sending";
    return (
      <Screen
        lead={
          <>
            {simTag}
            <Says state={mood ?? "idle"} size={88}>
              <p>
                {simulatedReply
                  ? "For the demo, here is what a reply could look like. Nothing was sent."
                  : status === "waiting for connection"
                    ? "I can't reach the messages service right now. Your request goes by itself as soon as I can."
                    : status === "not sent"
                      ? "Your request could not be sent. You can call or message them yourself."
                      : name
                        ? `I've asked ${name} to get in touch. Their answer shows up here and on home.`
                        : "I've asked them to get in touch. They'll see it when they open your invite."}
              </p>
            </Says>
          </>
        }
        actions={home()}
      >
        <section className="card reply-card" aria-live="polite" aria-label="Your request">
          {simulatedReply ? (
            <p className="muted">Waiting for a simulated reply</p>
          ) : (
            <>
              <p className="small muted">{CONTACT_REQUEST_TEXT}</p>
              <p className="request-status" data-status={status} role="status">
                {statusLabel}
              </p>
            </>
          )}
        </section>
      </Screen>
    );
  }

  // Step 3: the clinic. The report itself is on "Share with my clinic", shown in full before
  // anything is saved or printed; nothing is ever sent from the app.
  if (view === "clinic") {
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
            <Link href="/share/?from=ladder" className="btn btn-primary">
              Show me what they would get
            </Link>
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
        <p className="muted">
          You see all of it first. Nothing is sent: you save it as a PDF or print it yourself, and give it to them.
        </p>
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
            A measure counts as changed when the middle of your last week is clearly outside your usual range from the
            four weeks before. Weekdays are compared with weekdays and weekends with weekends. I only ask how you are doing
            when at least two different categories have changed (Sleep, Energy, Social, Mood). No category asks alone.
          </p>
          <ul className="worked-out">
            {SOURCES.flatMap((c) => evaluation.changed.filter((m) => m.source === c.id)).map((m) => (
              <li key={m.key}>
                <strong>
                  {SOURCES.find((c) => c.id === m.source)!.label}, {m.label.toLowerCase()}
                </strong>
                : the middle of your last week was {m.recent ? m.format(m.recent.median) : "not known"},
                over {m.recent?.n ?? 0} days. Your usual range is{" "}
                {m.usual ? `${m.format(m.usual.low)} to ${m.format(m.usual.high)}` : "not known yet"}, from {m.usual?.n ?? 0}{" "}
                days in the four weeks before.
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
