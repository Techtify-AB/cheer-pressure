"use client";

// The phone app, shown in a browser for a jury: the same interface as on the phone, inside a
// phone-sized frame, with every moment set up from made-up data. Nothing is measured here and
// nobody has to wait for weeks or hold a conversation: each button puts the made-up person at
// one moment and shows what the phone would show.

import { useEffect, useRef, useState } from "react";
import { makeDemoData } from "@/lib/demo";
import { todayKey } from "@/lib/dates";
import { answerSmallThing, answerSomeone, shiftLadder, SOMEONE_AFTER_DAYS, startWithHelp } from "@/lib/ladder";
import { addDemo, readData, saveLadder, saveOnboarding, saveProfile, saveSettings } from "@/lib/storage";

const WALK = { item: "outdoors", label: "A short walk", learned: false };

/** The made-up person exists, with eight made-up weeks behind them. */
function person() {
  const d = readData();
  if (!d.profile) saveProfile({ createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString(), earlySigns: [] });
  if ((d.onboarding?.version ?? 0) < 2) saveOnboarding({ version: 2, doneAt: new Date().toISOString() });
  addDemo(makeDemoData(todayKey(), readData().profile?.earlySigns ?? []));
}

function daysIn(days: number) {
  const today = todayKey();
  saveSettings({ simulatedChangeAt: new Date().toISOString() });
  let l = shiftLadder(answerSmallThing(startWithHelp(today, WALK, true), "try", today), Math.min(days, SOMEONE_AFTER_DAYS));
  // Past step 2: they let someone know on day two, and the change is still there on day seven.
  if (days > SOMEONE_AFTER_DAYS) l = shiftLadder(answerSomeone(l, "yes", today), days - SOMEONE_AFTER_DAYS);
  saveLadder(l);
}

const SCENES: { id: string; title: string; note: string; path: string; prepare: () => void }[] = [
  {
    id: "asks",
    title: "Cheri asks",
    note: "Two categories have changed against this person's own usual, so Cheri asks. One category alone never asks.",
    path: "/prompt/",
    prepare: () => {
      person();
      saveLadder(null);
      saveSettings({ simulatedChangeAt: new Date().toISOString() });
    },
  },
  {
    id: "hello",
    title: "Today's hello, recorded",
    note: "A spoken hello of about half a minute. Recorded for this demo, so nobody has to talk to a phone.",
    path: "/demo/hello/",
    prepare: person,
  },
  {
    id: "values",
    title: "My values",
    note: "Sleep, Energy, Social and Mood, each against the person's own last four weeks. No scores.",
    path: "/values/",
    prepare: person,
  },
  {
    id: "someone",
    title: "Two days later",
    note: "The change is still there. Step 2: someone they trust.",
    path: "/prompt/",
    prepare: () => {
      person();
      daysIn(2);
    },
  },
  {
    id: "clinic",
    title: "Seven days later",
    note: "Step 3: the clinic, and only because the person said yes to that at the start.",
    path: "/prompt/",
    prepare: () => {
      person();
      daysIn(7);
    },
  },
  {
    id: "clinic-view",
    title: "What the clinic sees",
    note: "The other side: one made-up person who chose to share.",
    path: "/demo/clinic/patient/",
    prepare: person,
  },
];

export default function PhoneDemoPage() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [current, setCurrent] = useState(SCENES[0].id);
  const [turn, setTurn] = useState(0);
  const scene = SCENES.find((s) => s.id === current) ?? SCENES[0];

  useEffect(() => {
    scene.prepare();
    if (frame.current) frame.current.src = `${scene.path}?scene=${scene.id}-${turn}`;
  }, [scene, turn]);

  return (
    <div className="phone-demo">
      <div className="phone-demo-device">
        <iframe ref={frame} title="The Cheer Pressure phone app" className="phone-demo-screen" allow="autoplay" />
      </div>
      <div className="phone-demo-side">
        <span className="placeholder-tag">Demo, made-up data</span>
        <h1 className="phone-demo-title">The phone app, in your browser</h1>
        <p className="muted">
          This is the same interface as on the phone. Pick a moment, then tap inside the phone as the person would.
        </p>
        <ol className="phone-demo-scenes">
          {SCENES.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="phone-demo-scene"
                aria-current={s.id === current ? "step" : undefined}
                onClick={() => {
                  setCurrent(s.id);
                  setTurn((t) => t + 1);
                }}
              >
                <span className="phone-demo-scene-title">{s.title}</span>
                <span className="phone-demo-scene-note">{s.note}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
