"use client";

// "Eight weeks in 20 seconds": made-up days, replayed one day at a time. For each day the
// REAL rule (evaluatePassive in lib/passive.ts) runs on the data up to that day, and
// this screen shows only what it concludes. When it would ask, the replay stops and
// the explanation is the one the real conversation shows.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Companion } from "@/components/companion/Companion";
import { useRequireProfile, useToday } from "@/components/hooks";
import { Screen } from "@/components/Screen";
import { Strip } from "@/components/Strip";
import { brain, passiveInput } from "@/lib/brain";
import { computeLevels } from "@/lib/levels";
import { LEARNING_DAYS, type PassiveMetric } from "@/lib/passive";
import {
  firstAsk,
  makeReplayData,
  REPLAY_DAYS,
  REPLAY_MS_PER_DAY,
  replayEndingOn,
  replayFrames,
  upTo,
  type ReplayFrame,
} from "@/lib/replay";
import type { PassiveKey } from "@/lib/types";
import { addDemo, saveSettings, useData } from "@/lib/storage";

/** The four strips shown by default. A changed measure outside these takes the last unchanged place. */
const SHOWN: PassiveKey[] = ["spread", "hold", "firstActivity", "lastActivity"];
const MAX_STRIPS = 4;
/** The four weeks of the usual and the last week. */
const STRIP_POINTS = 35;

function shownMetrics(metrics: PassiveMetric[]): PassiveMetric[] {
  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const list = SHOWN.map((k) => byKey.get(k)!).filter(Boolean);
  for (const m of metrics) {
    if (m.status !== "changed" || list.includes(m)) continue;
    const i = list.map((x) => x.status !== "changed").lastIndexOf(true);
    if (i >= 0) list[i] = m;
  }
  return list.slice(0, MAX_STRIPS);
}

function subscribeMotion(cb: () => void) {
  const q = window.matchMedia("(prefers-reduced-motion: reduce)");
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function subscribeNarrow(cb: () => void) {
  const q = window.matchMedia("(max-width: 479px)");
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}
const narrowScreen = () => window.matchMedia("(max-width: 479px)").matches;

export default function ReplayPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  if (!data || !ready) return null;
  return <Replay />;
}

function Replay() {
  const router = useRouter();
  const today = useToday();
  const reduced = useSyncExternalStore(subscribeMotion, reducedMotion, () => false);
  const narrow = useSyncExternalStore(subscribeNarrow, narrowScreen, () => false);
  // Placed so that the day it asks is today: "See what it asks" then opens the conversation on
  // exactly these days (the rule compares weekdays with weekdays, so days are not moved).
  const placed = useMemo(() => replayEndingOn(today) ?? { data: makeReplayData(today), lastDay: today }, [today]);
  const replay = placed.data;
  const frames = useMemo(() => replayFrames(replay, placed.lastDay), [replay, placed.lastDay]);
  const stopAt = useMemo(() => firstAsk(frames), [frames]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);

  const frame: ReplayFrame = frames[index];
  const fired = !!stopAt && frame.day === stopAt.day;

  // Paced by the clock, so a slow frame does not stretch the run: about 20 seconds in all.
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || fired) {
      startedAt.current = null;
      return;
    }
    if (startedAt.current === null) startedAt.current = performance.now() - index * REPLAY_MS_PER_DAY;
    const last = (stopAt ? stopAt.day : REPLAY_DAYS) - 1;
    const id = window.setInterval(() => {
      const due = Math.min(last, Math.floor((performance.now() - startedAt.current!) / REPLAY_MS_PER_DAY));
      setIndex((cur) => (due > cur ? cur + 1 : cur));
      if (due >= frames.length - 1 && !stopAt) setPlaying(false);
    }, 50);
    return () => window.clearInterval(id);
  }, [playing, fired, index, frames.length, stopAt]);

  // Worded by the same brain as the real conversation, from the same rule result.
  useEffect(() => {
    if (!fired) return;
    let current = true;
    brain
      .reflect({
        today: frame.date,
        profile: frame.data.profile,
        recentDaily: [],
        recentWeekly: [],
        levels: computeLevels(frame.data, frame.date),
        passive: passiveInput(frame.evaluation),
      })
      .then((out) => {
        if (current) setExplanation(out.passive.explanation);
      });
    return () => {
      current = false;
    };
  }, [fired, frame]);

  const restart = () => {
    startedAt.current = performance.now();
    setIndex(0);
    setExplanation(null);
    setPlaying(true);
  };

  /** Opens the real conversation on the same days, up to the day it stopped, which is today. */
  const seeWhatItAsks = () => {
    if (!stopAt) return;
    addDemo({ daily: [], weekly: [], reaction: [], typingSessions: [], ...upTo(replay, stopAt.date) });
    saveSettings({ simulatedChangeAt: new Date().toISOString() });
    router.push("/prompt/");
  };

  const e = frame.evaluation;
  const mood = fired ? "attention" : playing ? "thinking" : "idle";
  let line: string;
  if (fired) line = explanation ?? "";
  else if (e.learning) line = `Still learning your usual rhythm: ${e.daysOfData} of ${LEARNING_DAYS} days so far.`;
  else if (e.changed.length === 1) line = "One thing looks different. That alone is not enough for me to ask.";
  else if (e.reason === "typing-only") line = "Typing looks different. Typing alone never makes me ask.";
  else if (index === 0 && !playing) line = "Eight made-up weeks. I look at each day the way I look at yours.";
  else line = "Nothing stands out compared with the usual.";

  const atEnd = index + 1 >= frames.length;

  return (
    <Screen
      lead={
        <div className="replay-lead">
          <Companion state={mood} size={narrow ? (fired ? 96 : 120) : fired ? 200 : 240} />
          <div className="replay-status">
            <span className="placeholder-tag">Simulated, made-up days</span>
            <p className="replay-day" aria-live="off">
              Day {frame.day} <span className="muted">of {REPLAY_DAYS}</span>
            </p>
            <p className={line.length > 160 ? "replay-line long" : "replay-line"} aria-live="polite">
              {line}
            </p>
          </div>
        </div>
      }
      actions={
        <>
          {fired ? (
            <button type="button" className="btn btn-primary" onClick={seeWhatItAsks} disabled={!explanation}>
              See what it asks
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => (atEnd ? restart() : setPlaying(!playing))}
            >
              {playing ? "Pause" : atEnd ? "Play again" : index === 0 ? "Play" : "Resume"}
            </button>
          )}
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={restart} disabled={index === 0 && !playing}>
              Restart
            </button>
            <Link href="/demo/" className="btn btn-quiet">
              Back to the demo
            </Link>
          </div>
        </>
      }
    >
      <section className={reduced ? "card strips no-motion" : "card strips"} aria-label="Four of the measures">
        {shownMetrics(e.metrics).map((m) => (
          <Strip key={m.key} m={m} points={STRIP_POINTS} />
        ))}
        <p className="small muted strips-note">
          Band: the usual range, from the four weeks before. Dots: one per day, the last week larger. About 20
          seconds in all.
        </p>
      </section>
    </Screen>
  );
}
