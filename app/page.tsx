"use client";

// Home is passive-first: the companion watches the person's rhythm and asks only when
// their measures stand out from their own usual range (lib/passive.ts). Nothing is
// needed from the person day to day.

import Link from "next/link";
import { Companion } from "@/components/companion/Companion";
import { useDesktopTyping } from "@/components/desktop";
import { useCompanionVoice, usePassive, useRequireProfile, useToday } from "@/components/hooks";
import { calmLine } from "@/lib/passive";
import { useData } from "@/lib/storage";

export default function HomePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const voice = useCompanionVoice();
  const passive = usePassive(data);
  const { desktop, status } = useDesktopTyping();

  if (!data || !ready || !passive) return null;

  const line = calmLine(passive);
  const todayActivity = data.activityDays.find((d) => d.date === today && d.source === "user");
  const measuring = desktop && status?.listener === "running";

  let typingState: string;
  if (measuring && status?.paused) typingState = "Paused";
  else if (measuring) typingState = "Whole computer";
  else typingState = "Only in the box on Live view";

  let dayState: string;
  if (measuring && status?.paused) dayState = "Paused";
  else if (measuring) dayState = todayActivity ? `On. First activity today ${todayActivity.first}` : "On";
  else dayState = desktop ? "Needs permission, see Live view" : "In the desktop app only";

  const sources: { name: string; state: string; on: boolean }[] = [
    { name: "Typing rhythm", state: typingState, on: measuring && !status?.paused },
    { name: "Day rhythm (first and last activity)", state: dayState, on: measuring && !status?.paused },
    { name: "Camera", state: "Not connected yet", on: false },
    { name: "Microphone", state: "Not connected yet", on: false },
    { name: "Bedside sensor", state: "Not connected yet", on: false },
  ];

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
          {sources.map((s) => (
            <li key={s.name}>
              <span className={s.on ? "source-dot on" : "source-dot"} aria-hidden="true" />
              <span className="source-name">{s.name}</span>
              <span className="source-state">{s.state}</span>
            </li>
          ))}
        </ul>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Only timings and times of day are kept, on this device. Never what you type.
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
