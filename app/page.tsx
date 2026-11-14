"use client";

import Link from "next/link";
import { Companion } from "@/components/companion/Companion";
import { useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { daysBetween } from "@/lib/dates";
import { useData } from "@/lib/storage";

export default function HomePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const voice = useCompanionVoice();
  const { reflection } = useReflection(data);

  if (!data || !ready) return null;

  const doneToday = data.daily.some((e) => e.date === today);
  const lastWeekly = data.weekly[data.weekly.length - 1];
  // Offered when 7 days have passed since the last weekly answer. Someone new is
  // offered their first one after their first daily check-in.
  const weeklyDue = lastWeekly ? daysBetween(lastWeekly.date, today) >= 7 : data.daily.length > 0;

  const greeting = doneToday
    ? "Today's check-in is done. Nothing more is needed today."
    : "Hi. Today's check-in takes about 30 seconds.";
  const message = reflection?.noticedChange ? reflection.say : greeting;
  const suggestion = reflection?.noticedChange ? reflection.suggestion : null;
  const spoken = suggestion ? `${message} ${suggestion.text}` : message;

  return (
    <div className="stack-lg">
      <div style={{ display: "flex", justifyContent: "center" }}>
        <span className={doneToday ? "status status-done" : "status"} role="status">
          <span className="status-dot" aria-hidden="true" />
          {doneToday ? "Today's check-in: done" : "Today's check-in: not done yet"}
        </span>
      </div>

      <div className="companion-row">
        <Companion state={voice.state} size={170} />
        <div className="bubble" aria-live="polite">
          <p>{message}</p>
          {suggestion && (
            <p className="suggestion">
              <strong>One small thing to try:</strong> {suggestion.text}
            </p>
          )}
        </div>
        <button type="button" className="btn btn-quiet small" onClick={() => voice.say(spoken)}>
          Read this aloud
        </button>
      </div>

      <div className="stack">
        <Link href="/check-in/" className="btn btn-primary">
          {doneToday ? "Redo today's check-in" : "Start today's check-in"}
        </Link>
        {weeklyDue && (
          <p className="notice">
            <span>Your weekly questions are ready, whenever suits you.</span>
            <Link href="/weekly/">Answer them</Link>
          </p>
        )}
      </div>

      <nav aria-label="More">
        <ul className="quiet-links">
          <li>
            <Link href="/weekly/">Weekly questions</Link>
          </li>
          <li>
            <Link href="/reaction/">
              Reaction test <span className="badge badge-experiment">Experiment</span>
            </Link>
          </li>
          <li>
            <Link href="/trends/">Your own level</Link>
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
