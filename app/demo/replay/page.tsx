"use client";

// "Six weeks in 20 seconds": made-up days, replayed one day at a time. For each day the
// REAL rule (evaluatePassive in lib/passive.ts) runs on the data up to that day, and
// this screen shows only what it concludes. When it would ask, the replay stops and
// the explanation is the one the real conversation shows.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Companion } from "@/components/companion/Companion";
import { useRequireProfile, useToday } from "@/components/hooks";
import { Screen } from "@/components/Screen";
import { brain, passiveInput } from "@/lib/brain";
import { daysBetween } from "@/lib/dates";
import { computeLevels } from "@/lib/levels";
import { LEARNING_DAYS, type PassiveMetric } from "@/lib/passive";
import {
  firstAsk,
  makeReplayData,
  REPLAY_DAYS,
  REPLAY_MS_PER_DAY,
  replayFrames,
  shiftReplay,
  upTo,
  type ReplayFrame,
} from "@/lib/replay";
import type { PassiveKey } from "@/lib/types";
import { addDemo, saveSettings, useData } from "@/lib/storage";

/** The four strips shown by default. A changed measure outside these takes the last unchanged place. */
const SHOWN: PassiveKey[] = ["spread", "pauses", "firstActivity", "lastActivity"];
const MAX_STRIPS = 4;
const STRIP_POINTS = 14;

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
  // The six weeks end today; only the gaps between days matter to the rule.
  const replay = useMemo(() => makeReplayData(today), [today]);
  const frames = useMemo(() => replayFrames(replay, today), [replay, today]);
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

  /** Opens the real conversation on the same days, moved so the day it stopped is today. */
  const seeWhatItAsks = () => {
    if (!stopAt) return;
    const moved = shiftReplay(upTo(replay, stopAt.date), daysBetween(stopAt.date, today));
    addDemo({ daily: [], weekly: [], reaction: [], ...moved });
    saveSettings({ simulatedChangeAt: new Date().toISOString() });
    router.push("/prompt/");
  };

  const e = frame.evaluation;
  const mood = fired ? "attention" : playing ? "thinking" : "idle";
  let line: string;
  if (fired) line = explanation ?? "";
  else if (e.learning) line = `Still learning your usual rhythm: ${e.daysOfData} of ${LEARNING_DAYS} days so far.`;
  else if (e.changed.length === 1) line = "One thing looks different. That alone is not enough for me to ask.";
  else if (index === 0 && !playing) line = "Six made-up weeks. I look at each day the way I look at yours.";
  else line = "Nothing stands out compared with the usual.";

  const atEnd = index + 1 >= frames.length;

  return (
    <Screen
      lead={
        <div className="replay-lead">
          <Companion state={mood} size={narrow ? 120 : 240} />
          <div className="replay-status">
            <span className="placeholder-tag">Simulated, made-up days</span>
            <p className="replay-day" aria-live="off">
              Day {frame.day} <span className="muted">of {REPLAY_DAYS}</span>
            </p>
            <p className="replay-line" aria-live="polite">
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
      <section className={reduced ? "card strips no-motion" : "card strips"} aria-label="Four of the six measures">
        {shownMetrics(e.metrics).map((m) => (
          <Strip key={m.key} m={m} />
        ))}
        <p className="small muted strips-note">
          Band: the usual range, from the earlier days. Dots: the latest values, the last three larger. About 20
          seconds in all.
        </p>
      </section>
    </Screen>
  );
}

const W = 300;
const H = 44;
const PAD = 5;

/** One measure: its usual range as a band and the latest values as dots. */
function Strip({ m }: { m: PassiveMetric }) {
  const pts = m.points.slice(-STRIP_POINTS);
  // Keys per point so dots slide left as days go by.
  const seen = new Map<string, number>();
  const keyed = pts.map((p) => {
    const n = seen.get(p.date) ?? 0;
    seen.set(p.date, n + 1);
    return { ...p, id: `${p.date}-${n}` };
  });
  // The scale is set around the usual band (twice its width on each side), so the band
  // stays readable; a value beyond that sits at the edge.
  let lo: number;
  let hi: number;
  if (m.usual) {
    const w = Math.max(m.usual.high - m.usual.low, 1e-6);
    lo = m.usual.low - 2 * w;
    hi = m.usual.high + 2 * w;
  } else {
    const v = pts.map((p) => p.value);
    lo = v.length ? Math.min(...v) : 0;
    hi = v.length ? Math.max(...v) : 1;
    if (hi - lo < 1e-6) {
      lo -= 1;
      hi += 1;
    }
  }
  const clampY = (v: number) => Math.min(hi, Math.max(lo, v));
  const y = (v: number) => H - PAD - ((clampY(v) - lo) / (hi - lo)) * (H - PAD * 2);
  const x = (i: number) => PAD + (i + (STRIP_POINTS - pts.length)) * ((W - PAD * 2) / (STRIP_POINTS - 1));
  // The last three are what the rule compares; they get the change colour only when it counts as a change.
  const recentFrom = pts.length - 3;
  const changed = m.status === "changed";

  let state: string;
  if (m.status === "learning") state = "Still learning";
  else if (m.status === "changed" && m.phrase) state = `Changed: ${m.phrase}`;
  else state = "Usual";

  return (
    <div className="strip" data-changed={m.status === "changed" || undefined}>
      <div className="strip-head">
        <span className="strip-label">{m.label}</span>
        <span className="strip-state">{state}</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
        {m.usual && (
          <rect x={0} y={y(m.usual.high)} width={W} height={Math.max(3, y(m.usual.low) - y(m.usual.high))} rx={3} className="strip-band" />
        )}
        {keyed.map((p, i) => {
          const recent = i >= recentFrom;
          const outside = m.usual ? p.value > m.usual.high || p.value < m.usual.low : false;
          const cls = recent && changed ? "strip-dot changed" : outside ? "strip-dot out" : "strip-dot";
          return (
            <circle
              key={p.id}
              r={recent ? 3.8 : 2.6}
              cx={0}
              cy={0}
              className={cls}
              style={{ transform: `translate(${x(i)}px, ${y(p.value)}px)` }}
            />
          );
        })}
      </svg>
    </div>
  );
}
