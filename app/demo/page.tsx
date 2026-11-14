"use client";

// "For the demo": everything that exists for showing the companion to a jury, in one
// clearly marked place under Settings. None of it is part of everyday use.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCompanionStatus, useRequireProfile, useToday } from "@/components/hooks";
import { Screen } from "@/components/Screen";
import { daysBetween } from "@/lib/dates";
import { makeDemoData } from "@/lib/demo";
import { isActive, shiftLadder, type Due } from "@/lib/ladder";
import { defaultBaseUrl } from "@/lib/messages";
import { messagesUrlOf, parseMessagesUrl } from "@/lib/settings";
import { addDemo, clearDemo, hasDemo, readData, saveLadder, saveSettings, useData } from "@/lib/storage";
import { useTrusted } from "@/lib/trusted";
import type { AppData } from "@/lib/types";

const NEXT_WORDS: Record<Due, string> = {
  none: "nothing is due yet",
  ask: "Cheri would ask how you are doing",
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
  const [editing, setEditing] = useState(false);
  if (!data || !ready || !outcome) return null;
  if (editing) return <ServiceAddress data={data} onDone={() => setEditing(false)} />;

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
          <p className="muted">Made-up data and controls for showing how Cheri works. Not part of everyday use.</p>
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
          <span className="menu-value">Loads made-up data and Cheri asks</span>
        </button>
        <button type="button" className="menu-row" onClick={skip} disabled={!active}>
          <span className="menu-label">Skip ahead two days</span>
          <span className="menu-value">{ladderText}</span>
        </button>
        <button type="button" className="menu-row" onClick={demoOn ? clearDemo : loadDemo}>
          <span className="menu-label">{demoOn ? "Clear demo data" : "Load demo data"}</span>
          <span className="menu-value">{demoOn ? "Your own data is kept" : "Six weeks of made-up days"}</span>
        </button>
        <button type="button" className="menu-row" onClick={() => setEditing(true)}>
          <span className="menu-label">Messages service</span>
          <span className="menu-value">{messagesUrlOf(data.settings)}</span>
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

/**
 * Where the messages service lives. For a table demo on a phone hotspot, this computer's
 * network address (for example http://192.168.1.20:3480), so the links in the QR codes open
 * on a phone. Kept on this device with the other settings.
 */
function ServiceAddress({ data, onDone }: { data: AppData; onDone: () => void }) {
  const snap = useTrusted();
  const current = messagesUrlOf(data.settings);
  const [value, setValue] = useState(current);
  const [problem, setProblem] = useState<string | null>(null);
  const inUse = snap?.pairing && snap.connection !== "ended" ? snap.pairing.baseUrl : null;
  const save = () => {
    const r = parseMessagesUrl(value);
    if (!r.ok) {
      setProblem(r.error);
      return;
    }
    saveSettings({ messagesUrl: r.url === defaultBaseUrl() ? undefined : r.url });
    onDone();
  };
  return (
    <Screen
      lead={
        <>
          <span className="placeholder-tag">For the demo</span>
          <h1 className="item-title">Messages service</h1>
          <p className="muted">
            Where the service for messages with someone you trust runs. On a phone hotspot, type this computer&apos;s
            address so a phone can open the links.
          </p>
        </>
      }
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={save}>
            Save
          </button>
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={() => { setValue(defaultBaseUrl()); setProblem(null); }}>
              Use the default
            </button>
            <button type="button" className="btn btn-quiet" onClick={onDone}>
              Back
            </button>
          </div>
        </>
      }
    >
      <form
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label htmlFor="service-url">Address</label>
        <input
          id="service-url"
          type="text"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="http://192.168.1.20:3480"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setProblem(null);
          }}
        />
        <p className={problem ? "small problem-text field-note" : "small muted field-note"} role={problem ? "alert" : undefined}>
          {problem ??
            (inUse && inUse !== current
              ? `Your current connection keeps using ${inUse}. A new invite uses the address saved here.`
              : `Default: ${defaultBaseUrl()}`)}
        </p>
      </form>
    </Screen>
  );
}
