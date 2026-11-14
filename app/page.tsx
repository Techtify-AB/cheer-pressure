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
  const firstDaily = data.daily[0]; // lists are kept oldest first
  // Offered by itself when 7 days have passed since the last weekly answer, or, for
  // someone who has never answered, 7 days since their first daily check-in.
  // The quiet "Weekly questions" link below is always there.
  const weeklyDue = lastWeekly
    ? daysBetween(lastWeekly.date, today) >= 7
    : !!firstDaily && daysBetween(firstDaily.date, today) >= 7;

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
        {doneToday ? (
          <p className="notice">
            <Link href="/check-in/" className="btn btn-quiet">
              Redo today&apos;s check-in
            </Link>
          </p>
        ) : (
          <Link href="/check-in/" className="btn btn-primary">
            Start today&apos;s check-in
          </Link>
        )}
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
            <Link href="/live/">Live view</Link>
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
