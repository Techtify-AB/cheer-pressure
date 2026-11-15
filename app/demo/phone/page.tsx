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

/**
 * What a phone measures, in place of what only a computer could: nights from the phone's sleep
 * data and steps, for the same eight made-up weeks. Sleep and steps drift in the last week;
 * the daily answers stay as usual. So two categories have changed: Sleep and Energy.
 */
function phoneData() {
  const d = JSON.parse(localStorage.getItem("companion.v1") ?? "{}");
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = (n: number) => {
    const x = new Date();
    x.setHours(12, 0, 0, 0);
    x.setDate(x.getDate() + n - 56); // day 56 is today
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  };
  let seed = 20261115;
  const r = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const j = (w: number) => (r() + r() + r() - 1.5) * w;
  const clock = (m: number) => {
    m = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  };
  const rough = new Set([19, 20, 21, 31, 32, 33]);
  const nights = [];
  const steps = [];
  // Social and Mood, as usual all along: the same week repeated, so nothing here stands out.
  const talks = [];
  const homeTalk = [];
  const faces = [];
  const tones = [];
  const TALKS = [3, 4, 2, 4, 3, 5, 4];
  const HOME = [34, 41, 28, 38, 45, 62, 55];
  const FACE = [0.42, 0.45, 0.4, 0.44, 0.43, 0.47, 0.46];
  const SMILE = [0.16, 0.18, 0.15, 0.17, 0.16, 0.2, 0.19];
  const PITCH = [2.6, 2.8, 2.5, 2.7, 2.6, 3.0, 2.9];
  for (let n = 1; n <= 56; n++) {
    const drift = n >= 50 ? (n - 49) / 7 : 0;
    const asleep = 455 + j(22) - (rough.has(n) ? 85 : 0) - drift * 100;
    const bed = 23 * 60 + 10 + j(18) + (rough.has(n) ? 70 : 0);
    const wake = bed + asleep + 20 + j(8);
    nights.push({ date: day(n), bedtime: clock(bed), wake: clock(wake), asleepMinutes: Math.round(asleep), inBedMinutes: Math.round(asleep + 20), awakenings: 1, source: "demo" });
    const w = n % 7;
    talks.push({ date: day(n), count: TALKS[w], source: "demo" });
    homeTalk.push({ date: day(n), minutes: HOME[w], source: "demo" });
    // What the expression model and the voice read during the daily hello, as numbers only.
    faces.push({
      date: day(n),
      minutes: 0,
      movementMean: 0,
      shiftsPerHour: 0,
      expression: { minutesWithFace: 12, smilingShare: SMILE[w], smilesPerHour: 20, animationMean: FACE[w], browLoweredShare: 0 },
      posture: null,
      source: "demo",
      savedAt: "",
    });
    tones.push({ date: day(n), minutes: 5, speakingMinutes: 4, segmentsPerMinute: 21 + (w % 3), pitchVariability: PITCH[w], loudnessMean: 0.2, source: "demo", savedAt: "" });
    if (n < 56) steps.push({ date: day(n), steps: Math.max(400, Math.round(7600 + j(1200) - (rough.has(n) ? 1800 : 0) - drift * 4200)), source: "demo" });
  }
  d.healthNights = nights;
  d.stepDays = steps;
  const iso = new Date().toISOString();
  d.phoneHealth = { askedAt: iso, syncedAt: iso };
  for (const k of ["typingDays", "typingSessions", "reactionChecks", "reaction"]) d[k] = [];
  d.phoneTalkDays = talks;
  d.homeTalkDays = homeTalk;
  d.movementSessions = faces;
  d.toneSessions = tones;
  d.settings = { ...d.settings, sources: { ...(d.settings?.sources ?? {}), typing: false, dayRhythm: false, camera: false, microphone: false, contact: true } };
  // Camera and microphone stay off here: the made-up readings are shown, and a visitor's own camera is never asked for.
  const byDate = new Map<string, { date: string; answer?: string }>((d.dailyAnswers ?? []).map((a: { date: string }) => [a.date, a]));
  for (let n = 50; n <= 55; n++) {
    const was = byDate.get(day(n - 14));
    const answer = was?.answer && was.answer !== "not-so-good" ? was.answer : n % 2 ? "good" : "okay";
    byDate.set(day(n), { date: day(n), answer, dismissed: false, at: "", source: "demo" } as { date: string; answer?: string });
  }
  d.dailyAnswers = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  localStorage.setItem("companion.v1", JSON.stringify(d));
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
    note: "The measured values stand out from this person's own usual, in two categories. Cheri starts a conversation to help them feel better themselves.",
    path: "/demo/asks/",
    prepare: () => {
      person();
      saveLadder(null);
      saveSettings({ simulatedChangeAt: new Date().toISOString() });
    },
  },
  {
    id: "hello",
    title: "Today's hello",
    note: "Once a day Cheri only asks how they are, to hear it in their own words. Recorded, so nobody has to talk to a phone.",
    path: "/demo/hello/",
    prepare: person,
  },
  {
    id: "values",
    title: "My values",
    note: "Each category against the person's own last four weeks. Mood includes what our own expression model reads from the face and the voice during the daily hello.",
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
    phoneData(); // last, so nothing saved before it writes the computer's measures back
    if (frame.current) frame.current.src = `${scene.path}?scene=${scene.id}-${turn}`;
  }, [scene, turn]);

  return (
    <div className="phone-demo">
      <div className="phone-demo-device">
        <iframe ref={frame} title="The Cheer Pressure phone app" className="phone-demo-screen" allow="autoplay" />
      </div>
      <div className="phone-demo-side">
        <span className="placeholder-tag">Demo, made-up data</span>
        <h1 className="phone-demo-title">Try Cheer Pressure</h1>
        <p className="phone-demo-sub">The phone app, right here. Nothing to install.</p>
        <p className="phone-demo-intro">
          After depression treatment ends, the hard part starts at home. Cheri notices when your sleep, energy, social
          life or mood drift from your own usual, and helps you help yourself.
        </p>
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
