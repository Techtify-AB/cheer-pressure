"use client";

// For the demo only, clearly simulated: what a clinic could see if several people chose to
// share their values. Ordered by how long and how widely each person's own values have stood
// out; the order only says who to look at first and decides nothing.

import Link from "next/link";
import { useMemo } from "react";
import { useRequireProfile, useToday } from "@/components/hooks";
import { Screen } from "@/components/Screen";
import { demoPatients } from "@/lib/clinicDemo";
import { useData } from "@/lib/storage";

export default function ClinicDemoPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const patients = useMemo(() => demoPatients(today), [today]);
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
      <ol className="card clinic-list" aria-label="Made-up patients, who to look at first">
        {patients.map((p) => (
          <li key={p.name}>
            <span className="clinic-name">{p.name}</span>
            <span className="clinic-reason">{p.reason}</span>
            <span className="clinic-days">{p.measuredDays} measured days</span>
          </li>
        ))}
      </ol>
    </Screen>
  );
}
