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
//   Step 2 is social: the person picks who to ask, one or more of the people they trust (each
//   their own pair, lib/trusted.ts). "Could we talk or meet up soon?" goes to each through
//   lib/contact.ts, with "Sent" or "Waiting for connection" per person, then the first reply
//   with Yes, No or a few words back. With nobody added it sends nothing; in demo mode it shows
//   a reply clearly marked as simulated.
//
// Each step is one screen with one primary action and a decline. No percentages, no
// score, no diagnosis words.

import Link from "next/link";
import { activityForHelp, activityHref } from "@/lib/activities";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Disclosure, Says, Screen, StepCount } from "@/components/Screen";
import { useCompanionStatus, useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import type { CompanionState } from "@/components/companion/Companion";
import { brain, helpChoiceInput, type HelpChoice } from "@/lib/brain";
import { GreetingScreen, ReplyCrisisScreen, who } from "@/components/Greeting";
import { chooseContact, CONTACT_REQUEST_TEXT, type Contact, type ContactState } from "@/lib/contact";
import type { Answer } from "@/lib/events";
import { formatDay, newId } from "@/lib/dates";
import { DEMO_RECIPIENT_LINE } from "@/lib/report";
import { answerOffer, feedbackFromActivities, helpsOf, learnedLine, offeredIn, openOffer, recordOffer, statsFor, suggestionText } from "@/lib/helps";
import {
  answerClinic,
  answerReply,
  answerSmallThing,
  answerSomeone,
  CLINIC_AFTER_DAYS,
  isActive,
  offerNext,
  requestSomeone,
  seenClinic,
  startWithHelp,
  type Due,
} from "@/lib/ladder";
import { evaluatePassive, SOURCES } from "@/lib/passive";
import { forRule } from "@/lib/settings";
import { hasDemo, readData, saveCheckIn, saveLadder, saveSuggestions, useData } from "@/lib/storage";
import { clientOf, personName, personState, reachable, usePeople } from "@/lib/trusted";
import type { AppData, CheckInAnswer, HelpItem } from "@/lib/types";

interface Asked {
  personId: string;
  name: string;
  contact: Contact;
}

/** "Anna", "Anna and Sami", "Anna, Sami and Lea". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "them";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Where "I'll try that" goes for one thing on the person's list: a screen that helps them do it,
 * or null to stay in the conversation. The activity library plugs in here, and only here.
 */
function activityLinkFor(item: Pick<HelpItem, "id" | "label" | "own">): string | null {
  const activity = activityForHelp(item.id, item.label);
  return activity ? activityHref(activity) : null;
}

/** Offers one thing from the person's list (the brain chooses) and records it. Null: nothing is on. */
async function offerHelp(today: string, ladderStartedOn: string, simulated: boolean): Promise<HelpChoice | null> {
  const d = readData();
  const history = d.suggestions ?? [];
  const choice = await brain.chooseHelp(helpChoiceInput(today, helpsOf(d), history, offeredIn(history, ladderStartedOn), null, feedbackFromActivities(d)));
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

  // The people this conversation asked, one Contact each (state, so the screen updates with them).
  const everyone = usePeople();
  const [asked, setAsked] = useState<Asked[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const stopContact = useRef<(() => void) | null>(null);
  const [contactStates, setContactStates] = useState<Record<string, ContactState>>({});
  const [replyAnswer, setReplyAnswer] = useState<{ personId: string; answer: Answer | null; text?: string } | null>(null);
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
    const answerIt = (a: "try" | "other" | "not-now", viaActivity = false) => {
      const d = readData();
      const l = d.ladder;
      const open = l ? openOffer(d.suggestions ?? [], l.startedOn) : null;
      if (open) saveSuggestions(answerOffer(d.suggestions ?? [], open.id, a, { viaActivity }));
      return l;
    };
    const done = (a: "try" | "not-now") => {
      const link = a === "try" && item ? activityLinkFor(item) : null;
      // With an activity behind it, the activity asks "Did that help?"; otherwise Home asks once, later.
      const l = answerIt(a, !!link);
      if (l) saveLadder(answerSmallThing(l, a, today));
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
    const why = reason ?? (st?.learned && item ? learnedLine(item, statsFor([item], data.suggestions ?? [], feedbackFromActivities(data))[0]) : null);
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

  // Step 2: someone you trust. The person picks who.
  if (view === "someone") {
    const can = reachable(everyone);
    const ask = async () => {
      const chosen = can.filter((v) => picked.includes(v.id));
      const l = readData().ladder;
      if (l) saveLadder(answerSomeone(l, "yes", today, chosen.map((v) => v.id)));
      // The real request to each person picked; with nobody added, the stand-in (simulated in demo mode).
      const list: Asked[] = chosen.length
        ? chosen.map((v) => ({ personId: v.id, name: personName(v), contact: chooseContact({ client: clientOf(v.id), demo: false }) }))
        : [{ personId: "stand-in", name: "Someone you trust", contact: chooseContact({ client: null, demo }) }];
      stopContact.current?.();
      const stops = list.flatMap((x) => [
        x.contact.onChange((st) => setContactStates((cur) => ({ ...cur, [x.personId]: st }))),
        x.contact.onReply(() => setMood("joy")),
      ]);
      stopContact.current = () => stops.forEach((f) => f());
      setAsked(list);
      await Promise.all(list.map((x) => x.contact.requestContact()));
      setView("someone-asked");
    };
    const toggle = (id: string) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    return (
      <Screen
        lead={
          <>
            <Says state={voice.state === "speaking" ? "speaking" : "attention"} size={88}>
              <h1 id="someone-q">Would you like to see or talk to someone?</h1>
              {can.length > 0 && <p className="small muted">Pick who to ask. They get &quot;{CONTACT_REQUEST_TEXT}&quot;</p>}
            </Says>
            <StepCount index={1} total={3} label="Someone you trust" />
          </>
        }
        actions={
          <>
            {can.length > 0 ? (
              <button type="button" className="btn btn-primary" disabled={!picked.length} onClick={ask}>
                {picked.length > 1 ? `Ask these ${picked.length}` : "Ask them"}
              </button>
            ) : demo ? (
              <button type="button" className="btn btn-primary" onClick={ask}>
                Yes, show me
              </button>
            ) : (
              <Link href="/settings/#trust" className="btn btn-primary">
                Add someone you trust
              </Link>
            )}
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
      >
        {can.length > 0 ? (
          <div className="options people-pick" role="group" aria-labelledby="someone-q">
            {can.slice(0, 4).map((v) => (
              <button key={v.id} type="button" className="option" aria-pressed={picked.includes(v.id)} onClick={() => toggle(v.id)}>
                <span>{personName(v)}</span>
                <span className="small muted option-hint">{personState(v) === "invited" ? "Hasn't opened the invite yet" : "Connected"}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">
            {demo
              ? "Nobody is added on this device, so for the demo I can show what a reply could look like. Nothing is sent."
              : "You haven't added anyone yet. You can add someone in Settings, or call or message someone yourself."}
          </p>
        )}
      </Screen>
    );
  }

  if (view === "someone-asked") {
    const stateOf = (x: Asked) => contactStates[x.personId] ?? x.contact.state();
    // The first reply that came in, from whoever answered.
    const replied = asked.find((x) => stateOf(x).reply);
    const st = replied ? stateOf(replied) : null;
    const reply = st?.reply ?? null;
    const c = replied?.contact ?? null;
    const simulatedReply = !!asked[0]?.contact.simulated;
    const answerTheReply = (a: Answer | null, text?: string) => {
      c?.answer(a, text);
      const l = readData().ladder;
      if (l && a) saveLadder(answerReply(l, a, replied?.personId));
      setReplyAnswer({ personId: replied?.personId ?? "", answer: a, text });
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
    if (!asked.length || (simulatedReply && !demo)) {
      return (
        <Screen
          lead={
            <Says state="idle" size={88}>
              <p>
                You haven&apos;t added anyone yet, so nothing was sent. You can add someone in Settings, or call or message
                someone you trust yourself.
              </p>
            </Says>
          }
          actions={
            <>
              {home()}
              <div className="links">
                <Link href="/settings/#trust" className="btn btn-quiet">
                  Add someone
                </Link>
              </div>
            </>
          }
        />
      );
    }

    const label = (status: ContactState["status"]) =>
      status === "sent" ? "Sent" : status === "waiting for connection" ? "Waiting for connection" : status === "not sent" ? "Not sent" : "Sending";
    const anyWaiting = asked.some((x) => stateOf(x).status === "waiting for connection");
    const names = asked.map((x) => stateOf(x).trustedName ?? x.name);
    return (
      <Screen
        lead={
          <>
            {simTag}
            <Says state={mood ?? "idle"} size={88}>
              <p>
                {simulatedReply
                  ? "For the demo, here is what a reply could look like. Nothing was sent."
                  : anyWaiting
                    ? "I can't reach the messages service right now. Your request goes by itself as soon as I can."
                    : `I've asked ${joinNames(names)}. Their answer shows up here and on home.`}
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
              <ul className="asked-list">
                {asked.slice(0, 4).map((x) => {
                  const s2 = stateOf(x);
                  return (
                    <li key={x.personId}>
                      <span>{s2.trustedName ?? x.name}</span>
                      <span className="request-status" data-status={s2.status} role="status">
                        {label(s2.status)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </Screen>
    );
  }

  // Step 3: the clinic, as the person chose in onboarding or Settings (My clinic). Told
  // automatically: Cheri says so and shows exactly what was shared. Otherwise she asks first,
  // and the report is shown in full before anything is approved. A demo recipient: nothing is
  // ever sent from the app.
  if (view === "clinic") {
    const told = ladder?.clinic?.auto ? (data.clinicShared ?? []).find((e) => e.id === ladder.clinic?.sharedId) : null;
    if (ladder?.clinic?.auto) {
      return (
        <Screen
          lead={
            <>
              <span className="placeholder-tag">{DEMO_RECIPIENT_LINE}</span>
              <Says state="idle" size={88}>
                <h1>I&apos;ve told your clinic, as you asked.</h1>
                <p className="small muted">
                  Your values have not come back for {CLINIC_AFTER_DAYS} days. This is exactly what was shared
                  {told ? `, on ${formatDay(told.date)}` : ""}.
                </p>
              </Says>
              <StepCount index={2} total={3} label="Your clinic" />
            </>
          }
          actions={
            <>
              {told ? (
                <Link href={`/share/?entry=${told.id}`} className="btn btn-primary">
                  Show what was shared
                </Link>
              ) : null}
              <div className="links">
                <button
                  type="button"
                  className={told ? "btn btn-quiet" : "btn btn-primary"}
                  onClick={() => {
                    const cur = readData().ladder;
                    if (cur) saveLadder(seenClinic(cur, today));
                    router.push("/");
                  }}
                >
                  OK
                </button>
                <Link href="/settings/#clinic" className="btn btn-quiet">
                  Change this
                </Link>
              </div>
            </>
          }
        >
          <p className="muted">Only the summary of your values, compared with your own usual. Nothing you typed or said.</p>
        </Screen>
      );
    }
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
        <p className="muted">You see all of it first, and nothing goes unless you approve it. In this version the clinic is a demo recipient.</p>
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
