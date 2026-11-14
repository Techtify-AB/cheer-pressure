"use client";

// Home is the companion and one calm line. It measures by itself and speaks up only
// when the person's measures stand out from their own usual range (lib/passive.ts,
// lib/ladder.ts). Nothing is needed from the person day to day: "Talk to me" is there
// for when they want to, and one summary row opens what is being noticed.

import Link from "next/link";
import { Companion } from "@/components/companion/Companion";
import { useDesktopTyping } from "@/components/desktop";
import { Disclosure, Screen } from "@/components/Screen";
import { useCompanionStatus, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { isActive } from "@/lib/ladder";
import { moodFor } from "@/lib/mood";
import type { PassiveMetric } from "@/lib/passive";
import { NOT_CONNECTED, quietHoursOf, sourcesOf } from "@/lib/settings";
import { useData } from "@/lib/storage";

export default function HomePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const { reflection } = useReflection(data);
  const { evaluation, outcome } = useCompanionStatus(data);
  const { desktop, status } = useDesktopTyping();

  if (!data || !ready || !evaluation || !outcome || !reflection) return null;

  const settings = data.settings;
  const sources = sourcesOf(settings);
  const pausedAll = !!settings.pausedAll;
  const running = desktop && status?.listener === "running";
  const menuPaused = running && !!status?.paused;
  const quiet = quietHoursOf(settings);

  let line: string;
  if (pausedAll) line = "Measuring is paused. I'll stay quiet until you turn it back on in Settings.";
  else if (outcome.speakUp && outcome.due === "ask") line = reflection.passive.calmLine;
  else if (outcome.speakUp) line = "Some things still look different from your usual. When you have a moment, have a look.";
  else if (outcome.quiet) line = `It's quiet hours, so I'm resting until ${quiet.to}. Nothing is needed from you.`;
  else if (isActive(data.ladder)) line = "I'm keeping an eye on things and will look again in a few days. Nothing is needed from you.";
  else line = reflection.passive.calmLine;

  const mood = moodFor({ wantsToAsk: outcome.speakUp, quiet: outcome.quiet && !pausedAll });

  // The one-line summary of what is being noticed, truthfully for where this runs.
  const names = [sources.typing && "Typing rhythm", sources.dayRhythm && "day rhythm"].filter(Boolean) as string[];
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
          Everything stays on this device. You choose what is measured in{" "}
          <Link href="/settings/#measure">Settings</Link>.
        </p>
      </Disclosure>
    </Screen>
  );
}
