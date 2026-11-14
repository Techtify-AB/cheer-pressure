"use client";

// Home is the companion and one calm line. It measures by itself and speaks up only
// when the person's measures stand out from their own usual range (lib/passive.ts,
// lib/ladder.ts). Nothing is needed from the person day to day: "Talk to me" is there
// for when they want to, and one summary row opens what is being noticed.
//
// When someone the person trusts sends a greeting or a question (lib/trusted.ts), it becomes
// home's single primary thing, at any time, also in quiet hours: "Sara: Walk after lunch?"
// with Yes, No and Write back. Once answered, home goes back to its calm state.

import Link from "next/link";
import { useEffect, useState } from "react";
import { GreetingScreen, ReplyCrisisScreen, who } from "@/components/Greeting";
import { Companion } from "@/components/companion/Companion";
import { useDesktopTyping } from "@/components/desktop";
import { Disclosure, Screen } from "@/components/Screen";
import { useCompanionStatus, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { isActive } from "@/lib/ladder";
import { moodFor } from "@/lib/mood";
import type { PassiveMetric } from "@/lib/passive";
import { NOT_CONNECTED, quietHoursOf, sourcesOf } from "@/lib/settings";
import { useData } from "@/lib/storage";
import { answerTo, pendingMessage } from "@/lib/contact";
import type { Answer } from "@/lib/events";
import { messagesClient, useTrusted } from "@/lib/trusted";

/** How long "Sent to Sara." stays on home after an answer has gone. */
const SENT_LINE_MS = 4000;

export default function HomePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const { reflection } = useReflection(data);
  const { evaluation, outcome } = useCompanionStatus(data);
  const { desktop, status } = useDesktopTyping();
  const messages = useTrusted();
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

  let line: string;
  if (answered && answerState) {
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

  const mood = answered ? "joy" : moodFor({ wantsToAsk: outcome.speakUp, quiet: outcome.quiet && !pausedAll });

  // The one-line summary of what is being noticed, truthfully for where this runs.
  const names = [sources.typing && "Typing rhythm", sources.dayRhythm && "day and night rhythm"].filter(Boolean) as string[];
  const what = names.length ? names.join(" and ").replace(/^./, (c) => c.toUpperCase()) : "";
  let summary: string;
  if (!what) summary = "Nothing: every source is off";
  else if (pausedAll || menuPaused) summary = `Paused: ${what.toLowerCase()}`;
  else if (running) summary = `${what}, on this computer`;
  else if (desktop && status?.listener === "permission-needed") summary = `${what}, once you allow it on this computer`;
  else summary = `${what}, in the desktop app`;

  /** What each passive measure is doing right now, in a few plain words. */
  const stateOf = (m: PassiveMetric): { state: string; on: boolean } => {
    const off = m.unit === "session" ? !sources.typing : !sources.dayRhythm;
    if (off) return { state: "Off", on: false };
    if (pausedAll || menuPaused) return { state: "Paused", on: false };
    const learning = m.status === "learning";
    if (running) return { state: learning ? "Still learning" : "Measuring", on: true };
    return { state: desktop ? "Needs permission" : "Desktop app only", on: false };
  };
  const SHORT: Partial<Record<PassiveMetric["key"], string>> = {
    pauses: "Longer typing pauses",
    quietNight: "Quiet night (estimate)",
  };
  const todayActivity = data.activityDays.find((d) => d.date === today && d.source === "user");

  return (
    <Screen
      lead={
        <div className="home-hero">
          <Companion state={mood} size={260} />
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
          </div>
        )
      }
    >
      <Disclosure
        title="What I'm noticing"
        triggerClassName="noticing"
        trigger={
          <>
            <span className="noticing-text">
              <span className="noticing-label">What I&apos;m noticing</span>
              <span className="noticing-value">{summary}</span>
            </span>
            <span className="noticing-more" aria-hidden="true">
              Details
            </span>
          </>
        }
      >
        <ul className="source-list">
          {evaluation.metrics.map((m) => {
            const { state, on } = stateOf(m);
            return (
              <li key={m.key}>
                <span className={on ? "source-dot on" : "source-dot"} aria-hidden="true" />
                <span className="source-name">{SHORT[m.key] ?? m.label}</span>
                <span className="source-state">{state}</span>
              </li>
            );
          })}
        </ul>
        <p className="small muted">Not connected yet: {NOT_CONNECTED.join(", ").toLowerCase()}.</p>
        <p>
          Only the timing of key presses is used, never which keys or what you type. First and last activity are the
          times of your first and last key press each day.{" "}
          {todayActivity ? `Today your first was at ${todayActivity.first}.` : ""} Quiet night is the time between them
          overnight: an estimate of rest, not measured sleep.
        </p>
        <p>
          Measurements, answers and summaries never leave this device. You choose what is measured in{" "}
          <Link href="/settings/#measure">Settings</Link>.
        </p>
      </Disclosure>
    </Screen>
  );
}
