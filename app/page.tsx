"use client";

// Home is passive-first: the companion watches the person's rhythm and asks only when
// their measures stand out from their own usual range (lib/passive.ts). Nothing is
// needed from the person day to day.

import Link from "next/link";
import { useDesktopTyping } from "@/components/desktop";
import { Disclosure, Says, Screen } from "@/components/Screen";
import { useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import type { PassiveMetric } from "@/lib/passive";
import { useData } from "@/lib/storage";

export default function HomePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const voice = useCompanionVoice();
  const { passive, reflection } = useReflection(data);
  const { desktop, status } = useDesktopTyping();

  if (!data || !ready || !passive || !reflection) return null;

  const line = reflection.passive.calmLine;
  const todayActivity = data.activityDays.find((d) => d.date === today && d.source === "user");
  const measuring = desktop && status?.listener === "running";
  const paused = measuring && !!status?.paused;

  /** What each passive measure is doing right now, in a few plain words. */
  const stateOf = (m: PassiveMetric): { state: string; on: boolean } => {
    const learning = m.status === "learning";
    if (paused) return { state: "Paused", on: false };
    if (measuring) return { state: learning ? "Still learning" : "Measuring", on: true };
    if (m.unit === "session") return { state: learning ? "In the box, learning" : "Only in the box", on: false };
    return { state: desktop ? "Needs permission" : "Desktop app only", on: false };
  };

  // Short names so each measure and its state fit on one line on a phone.
  const SHORT: Partial<Record<PassiveMetric["key"], string>> = {
    pauses: "Longer typing pauses",
    quietNight: "Quiet night (estimate)",
  };
  const label = (m: PassiveMetric) => SHORT[m.key] ?? m.label;

  return (
    <Screen
      lead={
        <Says state={voice.state} size={72}>
          <p>{line}</p>
        </Says>
      }
      actions={
        <>
          {passive.askNow && (
            <Link href="/prompt/" className="btn btn-primary">
              Have a look
            </Link>
          )}
          <nav aria-label="More" className="links">
            <Link href="/check-in/" className="btn btn-quiet">
              Tell me how you&apos;re doing
            </Link>
            <Link href="/live/" className="btn btn-quiet">
              Live view
            </Link>
            <Link href="/trends/" className="btn btn-quiet">
              Your own level
            </Link>
            <Link href="/weekly/" className="btn btn-quiet">
              Weekly questions
            </Link>
            <Link href="/reaction/" className="btn btn-quiet">
              Reaction test (experiment)
            </Link>
            <Link href="/share/" className="btn btn-quiet">
              Share with my clinic
            </Link>
            <Link href="/settings/" className="btn btn-quiet">
              Your data and settings
            </Link>
            <button type="button" className="btn btn-quiet" onClick={() => voice.say(line)}>
              Read this aloud
            </button>
          </nav>
        </>
      }
    >
      <section className="card measures" aria-labelledby="sources-title">
        <h2 id="sources-title">What I&apos;m measuring by myself</h2>
        <ul className="source-list">
          {passive.metrics.map((m) => {
            const { state, on } = stateOf(m);
            return (
              <li key={m.key}>
                <span className={on ? "source-dot on" : "source-dot"} aria-hidden="true" />
                <span className="source-name">{label(m)}</span>
                <span className="source-state">{state}</span>
              </li>
            );
          })}
        </ul>
        <p className="small muted not-connected">Not connected yet: camera, background microphone, bedside sensor.</p>
        <Disclosure label="What is kept, and what is not" title="What is kept, and what is not">
          <p>
            Key timing is measured, never which keys you press or what you type in other apps. In a browser it is
            measured only in the box on Live view; in the desktop app, across the whole computer.
          </p>
          <p>
            First and last activity are the times of your first and last key press each day.{" "}
            {todayActivity ? `Today your first was at ${todayActivity.first}.` : ""} Quiet night is the time between
            them overnight: an estimate of rest, not measured sleep.
          </p>
          <p>Notes and early signs you write here are kept on this device only. Nothing is sent anywhere.</p>
          <p>
            Microphone: only if you choose to read a sentence aloud in a check-in, to time how fast you read. No sound
            is kept.
          </p>
        </Disclosure>
      </section>
    </Screen>
  );
}
