"use client";

// Home is passive-first: the companion watches the person's rhythm and asks only when
// their measures stand out from their own usual range (lib/passive.ts). Nothing is
// needed from the person day to day.

import Link from "next/link";
import { Companion } from "@/components/companion/Companion";
import { useDesktopTyping } from "@/components/desktop";
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

  /** What each passive measure is doing right now, in plain words. */
  const stateOf = (m: PassiveMetric): { state: string; on: boolean } => {
    const learning = m.status === "learning" ? ", still learning" : "";
    if (paused) return { state: "Paused", on: false };
    if (m.unit === "session") {
      if (measuring) return { state: `Measuring${learning}`, on: true };
      return { state: `Only in the Live view box${learning}`, on: false };
    }
    if (measuring) {
      const first = m.key === "firstActivity" && todayActivity ? `, today ${todayActivity.first}` : "";
      return { state: `Measuring${first}${learning}`, on: true };
    }
    return { state: desktop ? "Needs permission, see Live view" : "Desktop app only", on: false };
  };

  const label = (m: PassiveMetric) => (m.key === "quietNight" ? "Quiet night, an estimate of rest" : m.label);

  return (
    <div className="stack-lg">
      <div className="companion-row">
        <Companion state={voice.state} size={170} />
        <div className="bubble" aria-live="polite">
          <p>{line}</p>
        </div>
        {passive.askNow ? (
          <Link href="/prompt/" className="btn btn-secondary">
            Have a look
          </Link>
        ) : (
          <button type="button" className="btn btn-quiet small" onClick={() => voice.say(line)}>
            Read this aloud
          </button>
        )}
      </div>

      <section className="card stack" aria-labelledby="sources-title">
        <h2 id="sources-title" style={{ fontSize: "var(--font-size-lg)", marginBottom: 0 }}>
          What I&apos;m noticing right now
        </h2>
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
        <p className="small muted" style={{ marginBottom: 0 }}>
          Key timing is measured, never which keys you press or what you type in other apps. Notes and early signs you
          write here are kept on this device only. Microphone: only if you choose to read a sentence aloud in a
          check-in, and no sound is kept.
        </p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Not connected yet: camera, microphone in the background, bedside sensor.
        </p>
      </section>

      <nav aria-label="More">
        <ul className="quiet-links">
          <li>
            <Link href="/check-in/">Tell me how you&apos;re doing</Link>
          </li>
          <li>
            <Link href="/live/">Live view</Link>
          </li>
          <li>
            <Link href="/trends/">Your own level</Link>
          </li>
          <li>
            <Link href="/weekly/">Weekly questions</Link>
          </li>
          <li>
            <Link href="/reaction/">
              Reaction test <span className="badge badge-experiment">Experiment</span>
            </Link>
          </li>
          <li>
            <Link href="/share/">Share with my clinic</Link>
          </li>
          <li>
            <Link href="/settings/">Your data and settings</Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
