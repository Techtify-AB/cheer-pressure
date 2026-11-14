"use client";

// "For the demo": everything that exists for showing the companion to a jury, in one
// clearly marked place under Settings. None of it is part of everyday use.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCompanionStatus, useRequireProfile, useToday } from "@/components/hooks";
import { Screen } from "@/components/Screen";
import { daysBetween } from "@/lib/dates";
import { makeDemoData } from "@/lib/demo";
import { isActive, shiftLadder, type Due } from "@/lib/ladder";
import { addDemo, clearDemo, hasDemo, readData, saveLadder, saveSettings, useData } from "@/lib/storage";

const NEXT_WORDS: Record<Due, string> = {
  none: "nothing is due yet",
  ask: "the companion would ask how you are doing",
  "small-thing": "one small thing",
  someone: "someone you trust",
  clinic: "a summary for your clinic",
};

export default function DemoPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const router = useRouter();
  const today = useToday();
  const { outcome } = useCompanionStatus(data);
  if (!data || !ready || !outcome) return null;

  const demoOn = hasDemo(data);
  const ladder = data.ladder;
  const active = isActive(ladder);

  const loadDemo = () => addDemo(makeDemoData(today, data.profile?.earlySigns ?? []));
  const simulate = () => {
    loadDemo();
    // A simulated ladder is cleared with the old demo data; start from the question.
    saveSettings({ simulatedChangeAt: new Date().toISOString() });
    router.push("/prompt/");
  };
  const skip = () => {
    const l = readData().ladder;
    if (!isActive(l)) return;
    saveLadder(shiftLadder(l, 2));
    router.push("/prompt/");
  };

  let ladderText: string;
  if (!active) ladderText = "Starts when you answer “Not my best”. Simulate a change first.";
  else {
    const days = daysBetween(ladder.startedOn, today);
    ladderText = `Started ${days === 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`}. Next: ${NEXT_WORDS[outcome.due]}.`;
  }

  return (
    <Screen
      lead={
        <>
          <span className="placeholder-tag">For the demo</span>
          <h1 className="item-title">For the demo</h1>
          <p className="muted">Made-up data and controls for showing how the companion works. Not part of everyday use.</p>
        </>
      }
      actions={
        <>
          <Link href="/demo/replay/" className="btn btn-primary">
            Six weeks in 20 seconds
          </Link>
          <div className="links">
            <Link href="/settings/" className="btn btn-quiet">
              Back to settings
            </Link>
          </div>
        </>
      }
    >
      <nav aria-label="Demo controls" className="card menu demo-menu">
        <button type="button" className="menu-row" onClick={simulate}>
          <span className="menu-label">Simulate a change</span>
          <span className="menu-value">Loads made-up data and the companion asks</span>
        </button>
        <button type="button" className="menu-row" onClick={skip} disabled={!active}>
          <span className="menu-label">Skip ahead two days</span>
          <span className="menu-value">{ladderText}</span>
        </button>
        <button type="button" className="menu-row" onClick={demoOn ? clearDemo : loadDemo}>
          <span className="menu-label">{demoOn ? "Clear demo data" : "Load demo data"}</span>
          <span className="menu-value">{demoOn ? "Your own data is kept" : "Six weeks of made-up days"}</span>
        </button>
        <Link href="/live/" className="menu-row">
          <span className="menu-label">Live view</span>
          <span className="menu-value">Typing numbers as you type</span>
        </Link>
        <Link href="/trends/" className="menu-row">
          <span className="menu-label">Your own level</span>
          <span className="menu-value">Each measure against your usual range</span>
        </Link>
      </nav>
    </Screen>
  );
}
