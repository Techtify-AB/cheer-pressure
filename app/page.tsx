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
import { Screen } from "@/components/Screen";
import { useCompanionStatus, useReflection, useRequireProfile } from "@/components/hooks";
import { isActive } from "@/lib/ladder";
import { moodFor } from "@/lib/mood";
import { quietHoursOf, sourcesOf } from "@/lib/settings";
import { useData } from "@/lib/storage";
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
      <Link href="/values/" className="noticing">
        <span className="noticing-text">
          <span className="noticing-label">What I&apos;m noticing</span>
          <span className="noticing-value">{summary}</span>
        </span>
        <span className="noticing-more" aria-hidden="true">
          My values
        </span>
      </Link>
    </Screen>
  );
}
