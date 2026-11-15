"use client";

// For the demo only, clearly simulated: what a clinic could see if several people chose to
// share their values. Ordered by how long and how widely each person's own values have stood
// out; the order only says who to look at first and decides nothing.

import Link from "next/link";
import { useMemo } from "react";
import { useRequireProfile, useToday } from "@/components/hooks";
import { Screen } from "@/components/Screen";
import { demoPatients, type DemoPatient } from "@/lib/clinicDemo";
import { useData } from "@/lib/storage";

const GROUPS: { title: string; note: string; has: (p: DemoPatient) => boolean }[] = [
  {
    title: "Look at first",
    note: "Two or more categories have changed, and Cheri has asked them about it.",
    has: (p) => p.daysStandingOut > 0,
  },
  {
    title: "One thing has changed",
    note: "Not enough for Cheri to ask. Nothing is sent to the clinic about this.",
    has: (p) => p.daysStandingOut === 0 && p.sourcesOut > 0,
  },
  { title: "Within their own usual", note: "Nothing stands out.", has: (p) => p.sourcesOut === 0 },
];

export default function ClinicDemoPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const patients = useMemo(() => demoPatients(today), [today]);
  const first = patients[0]?.name;
  if (!data || !ready) return null;
  return (
    <Screen
      lead={
        <>
          <span className="placeholder-tag">Simulated, made-up patients</span>
          <h1 className="item-title">What a clinic could see</h1>
          <p className="muted">
            Made-up people who chose to share, each compared only with their own usual. The order only says who to look
            at first; it decides nothing.
          </p>
        </>
      }
      actions={
        <div className="links">
          <Link href="/demo/" className="btn btn-quiet">
            Back to the demo
          </Link>
        </div>
      }
    >
      <div className="clinic-board">
        {GROUPS.map((g) => {
          const rows = patients.filter(g.has);
          if (!rows.length) return null;
          return (
            <section key={g.title} className="clinic-group" aria-label={g.title}>
              <h2 className="clinic-group-title">
                {g.title} <span className="clinic-count">{rows.length}</span>
              </h2>
              <p className="clinic-group-note">{g.note}</p>
              <ul className="clinic-rows">
                {rows.map((p) => (
                  <li key={p.name} className="clinic-row">
                    {p.name === first ? (
                      <Link href="/demo/clinic/patient/" className="clinic-name clinic-open">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="clinic-name">{p.name}</span>
                    )}
                    <span className="clinic-cats">
                      {p.categories.map((c) => (
                        <span key={c.label} className="clinic-cat" data-changed={c.changed ? "yes" : "no"}>
                          {c.label}
                          <span className="sr-only">{c.changed ? ": changed" : ": as usual"}</span>
                        </span>
                      ))}
                    </span>
                    <span className="clinic-since">
                      {p.daysStandingOut
                        ? `${p.daysStandingOut} ${p.daysStandingOut === 1 ? "day" : "days"} in a row`
                        : p.sourcesOut
                          ? "One category only"
                          : "As usual"}
                    </span>
                    <span className="clinic-days">{p.measuredDays} measured days</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
        <p className="clinic-legend">
          <span className="clinic-cat" data-changed="yes">Changed</span>
          <span className="clinic-cat" data-changed="no">As usual</span>
          <span>against the person&apos;s own last four weeks. Cheri asks the person only when at least two categories have changed.</span>
        </p>
      </div>
    </Screen>
  );
}
