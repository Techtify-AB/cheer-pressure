"use client";

// For the demo only, clearly simulated: what a clinic could see about one made-up person who
// chose to share. Everything here is written by hand for the demo. Observations against the
// person's own usual, the steps they took themselves, and their own words. No score, no
// percentage, no diagnosis.

import Link from "next/link";
import { useRequireProfile } from "@/components/hooks";
import { Screen } from "@/components/Screen";
import { useData } from "@/lib/storage";

const DAYS = 35;
/** How many of the last days each category has been outside this person's own usual. */
const CATEGORIES: { label: string; changedDays: number; line: string }[] = [
  { label: "Sleep", changedDays: 9, line: "Nights have been shorter than their usual, and they have gone to bed later." },
  { label: "Energy", changedDays: 7, line: "Fewer steps than their usual, and less time out of the home." },
  { label: "Social", changedDays: 0, line: "As usual: they have been in touch with people about as often as before." },
  { label: "Mood", changedDays: 5, line: "Their own answer to the daily hello has been “Not so good” more often than their usual." },
];

const STEPS: { when: string; title: string; text: string }[] = [
  { when: "7 days ago", title: "Cheri asked", text: "Two categories had changed. They answered “Not so good”." },
  {
    when: "7 days ago",
    title: "Step 1: their own list",
    text: "They picked “A short walk before lunch” from what helps them. Did it help? “A little.”",
  },
  { when: "4 days ago", title: "Step 2: someone they trust", text: "They let Sara know. Sara answered the same evening." },
  {
    when: "Today",
    title: "Step 3: the clinic",
    text: "The change has lasted seven days. They said yes at the start to the clinic being told, so this was shared.",
  },
];

export default function ClinicPatientPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  if (!data || !ready) return null;
  return (
    <Screen
      lead={
        <>
          <span className="placeholder-tag">Simulated, made-up patient</span>
          <h1 className="item-title">Made-up patient E</h1>
          <p className="muted">
            Shares with the clinic: Always. Compared only with their own usual, the four weeks before this one.
          </p>
        </>
      }
      actions={
        <div className="links">
          <Link href="/demo/clinic/" className="btn btn-quiet">
            Back to the list
          </Link>
        </div>
      }
    >
      <div className="clinic-board">
        <section className="clinic-group" aria-label="What has changed">
          <h2 className="clinic-group-title">What has changed</h2>
          <p className="clinic-group-note">Each square is a day, the oldest first. Today is on the right.</p>
          <ul className="clinic-rows">
            {CATEGORIES.map((c) => (
              <li key={c.label} className="patient-cat">
                <span className="clinic-name">{c.label}</span>
                <span className="clinic-cat" data-changed={c.changedDays ? "yes" : "no"}>
                  {c.changedDays ? `Changed, ${c.changedDays} days` : "As usual"}
                </span>
                <span className="patient-strip" aria-hidden="true">
                  {Array.from({ length: DAYS }, (_, i) => (
                    <i key={i} data-changed={i >= DAYS - c.changedDays ? "yes" : "no"} />
                  ))}
                </span>
                <span className="patient-line">{c.line}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="clinic-group" aria-label="What they have done">
          <h2 className="clinic-group-title">What they have done</h2>
          <p className="clinic-group-note">The steps are theirs. The clinic is the last one, and only with their yes.</p>
          <ol className="clinic-rows">
            {STEPS.map((s) => (
              <li key={s.title} className="patient-step">
                <span className="patient-when">{s.when}</span>
                <span className="clinic-name">{s.title}</span>
                <span className="patient-line">{s.text}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="clinic-group" aria-label="In their own words">
          <h2 className="clinic-group-title">In their own words</h2>
          <p className="clinic-group-note">Written by them, and shared because they chose to.</p>
          <blockquote className="patient-words">
            Sleeping badly again, like before the treatment. The walks help a bit. I would like to talk to someone.
          </blockquote>
        </section>

        <p className="clinic-legend">
          <span>These are observations against this person&apos;s own usual. They are not a score and not a diagnosis.</span>
        </p>
      </div>
    </Screen>
  );
}
