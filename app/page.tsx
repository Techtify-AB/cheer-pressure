"use client";

// Home is the companion and one calm line. It measures by itself and speaks up only
// when the person's measures stand out from their own usual range (lib/passive.ts,
// lib/ladder.ts). The one thing it asks day to day is the optional daily question (one tap,
// or "Not now"; lib/daily.ts), as often as the person sets. "Talk to me" is there
// for when they want to. "What I'm noticing" lists the four categories, Sleep, Energy, Social
// and Mood, each with one short line; each opens its view in My values.
//
// When someone the person trusts sends a greeting or a question (lib/trusted.ts), it becomes
// home's single primary thing, at any time, also in quiet hours: "Sara: Walk after lunch?"
// with Yes, No and Write back. Once answered, home goes back to its calm state.

import Link from "next/link";
import { useEffect, useState } from "react";
import { GreetingScreen, ReplyCrisisScreen, who } from "@/components/Greeting";
import { afterAnswer, DailyAnswers, useDailyQuestion } from "@/components/DailyQuestion";
import { QUESTION } from "@/lib/daily";
import type { DailyAnswerValue } from "@/lib/types";
import { Companion } from "@/components/companion/Companion";
import { useDesktopTyping } from "@/components/desktop";
import { Screen } from "@/components/Screen";
import { useCompanionStatus, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { CATEGORY_IDS, categoryLine } from "@/lib/categories";
import { SOURCES } from "@/lib/passive";
import { isActive } from "@/lib/ladder";
import { moodFor } from "@/lib/mood";
import { quietHoursOf, sourcesOf } from "@/lib/settings";
import { readData, saveOnboarding, useData } from "@/lib/storage";
import { answerTo, pendingMessage } from "@/lib/contact";
import type { Answer } from "@/lib/events";
import { messagesClient, useTrusted } from "@/lib/trusted";

/** How long "Sent to Sara." stays on home after an answer has gone. */
const SENT_LINE_MS = 4000;

export default function HomePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const { reflection } = useReflection(data);
  const { evaluation, outcome } = useCompanionStatus(data);
  const { desktop, status } = useDesktopTyping();
  const messages = useTrusted();
  const today = useToday();
  const paired = !!messages?.pairing && messages.connection !== "ended";
  const pending = pendingMessage(messages);
  // The message just answered here, so home can say whether the answer has gone.
  const [answered, setAnswered] = useState<{ id: string; name: string } | null>(null);
  const answerState = answered && messages ? answerTo(messages, answered.id) : null;
  const sent = answerState?.status === "sent";
  useEffect(() => {
    if (!sent) return;
    const t = window.setTimeout(() => setAnswered(null), SENT_LINE_MS);
    return () => window.clearTimeout(t);
  }, [sent]);

  // Crisis words in a written answer: the help card stays until the person moves on.
  const [crisisFor, setCrisisFor] = useState<string | null>(null);
  // The daily question, and the line after an answer ("Not so good" keeps its gentle line).
  const daily = useDailyQuestion(data);
  const [answeredToday, setAnsweredToday] = useState<DailyAnswerValue | null>(null);
  useEffect(() => {
    if (!answeredToday || answeredToday === "not-so-good") return;
    const t = window.setTimeout(() => setAnsweredToday(null), SENT_LINE_MS);
    return () => window.clearTimeout(t);
  }, [answeredToday]);

  // People who set up before the phone flow's onboarding: the new questions, offered once,
  // quietly, on the first day home is seen, as a quiet link and never the primary action.
  const offerNew = !!data?.profile && (data.onboarding?.version ?? 0) < 2 && (!data.onboarding?.offeredOn || data.onboarding.offeredOn === today);
  useEffect(() => {
    if (!offerNew) return;
    const o = readData().onboarding;
    if (!o?.offeredOn) saveOnboarding({ version: o?.version ?? 1, ...o, offeredOn: today });
  }, [offerNew, today]);

  if (!data || !ready || !evaluation || !outcome || !reflection) return null;

  if (crisisFor) return <ReplyCrisisScreen name={crisisFor} onDone={() => setCrisisFor(null)} />;

  if (pending?.id) {
    const id = pending.id;
    const answer = (a: Answer | null, text?: string) => {
      messagesClient().sendReply(id, a, text);
      setAnswered({ id, name: pending.fromName ?? "them" });
    };
    return <GreetingScreen key={id} reply={pending} onAnswer={answer} onCrisis={() => setCrisisFor(who(pending))} hero />;
  }

  const settings = data.settings;
  const sources = sourcesOf(settings);
  const pausedAll = !!settings.pausedAll;
  const running = desktop && status?.listener === "running";
  const menuPaused = running && !!status?.paused;
  const quiet = quietHoursOf(settings);

  if (daily.due) {
    return (
      <Screen
        lead={
          <div className="home-hero">
            <Companion state="attention" size={220} />
            <h1 className="calm-line daily-question">{QUESTION}</h1>
          </div>
        }
        actions={
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={daily.dismiss}>
              Not now
            </button>
          </div>
        }
      >
        <DailyAnswers
          onAnswer={(v) => {
            daily.answer(v);
            setAnsweredToday(v);
          }}
        />
      </Screen>
    );
  }

  let line: string;
  if (answeredToday) {
    line = afterAnswer(answeredToday);
  } else if (answered && answerState) {
    line =
      answerState.status === "sent"
        ? `Sent to ${answered.name}.`
        : answerState.status === "waiting for connection"
          ? `Waiting for connection. Your answer goes to ${answered.name} as soon as I can reach the service.`
          : answerState.status === "not sent"
            ? `That could not be sent to ${answered.name}.`
            : `Sending to ${answered.name}.`;
  } else if (pausedAll) line = "Measuring is paused. I'll stay quiet until you turn it back on in Settings.";
  else if (outcome.speakUp && outcome.due === "ask") line = reflection.passive.calmLine;
  else if (outcome.speakUp) line = "Some things still look different from your usual. When you have a moment, have a look.";
  else if (outcome.quiet) line = `It's quiet hours, so I'm resting until ${quiet.to}. Nothing is needed from you.`;
  else if (isActive(data.ladder)) line = "I'm keeping an eye on things and will look again in a few days. Nothing is needed from you.";
  else line = reflection.passive.calmLine;

  const mood = answered || answeredToday === "good" ? "joy" : moodFor({ wantsToAsk: outcome.speakUp, quiet: outcome.quiet && !pausedAll });

  // Paused, or the desktop app's typing waits for a permission: said once, under the four lines.
  let note: string | null = null;
  if (pausedAll || menuPaused) note = "Paused: nothing new is measured.";
  else if (desktop && status?.listener === "permission-needed") note = "Typing rhythm waits for your permission on this computer.";
  else if (!desktop && (sources.dayRhythm || sources.typing)) note = "The estimate of sleep, and typing, are measured in the desktop app.";

  return (
    <Screen
      lead={
        <div className="home-hero">
          <Companion state={mood} size={232} />
          <p className="calm-line" aria-live="polite">
            {line}
          </p>
        </div>
      }
      actions={
        outcome.speakUp ? (
          <Link href="/prompt/" className="btn btn-primary">
            Have a look
          </Link>
        ) : (
          <div className="links">
            <Link href="/prompt/" className="btn btn-quiet">
              Talk to me
            </Link>
            {offerNew && (
              <Link href="/setup/" className="btn btn-quiet">
                A few new questions, if you like
              </Link>
            )}
          </div>
        )
      }
    >
      <section className="card noticing-card" aria-labelledby="noticing-title">
        <h2 id="noticing-title" className="noticing-label">
          What I&apos;m noticing
        </h2>
        <ul className="noticing-list">
          {CATEGORY_IDS.map((id) => (
            <li key={id}>
              <Link href={`/values/?c=${id}`} className="noticing-row">
                <span className="noticing-name">{SOURCES.find((c) => c.id === id)!.label}</span>
                <span className="noticing-value">{categoryLine(id, data, evaluation, today, paired)}</span>
              </Link>
            </li>
          ))}
        </ul>
        {note && <p className="small muted noticing-note">{note}</p>}
      </section>
    </Screen>
  );
}
