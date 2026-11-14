"use client";

// "My values": everything Cheri measures, for the person, one source at a time. It opens on
// one sentence and how many sources stand out; then each source has its measures as strips
// over the last eight weeks against the person's own usual band, with the numbers and what
// they mean, and "since" where the rule says a measure has changed. The same numbers go into
// the clinic report (lib/report.ts), which the person can save or print from here.

import Link from "next/link";
import { useState } from "react";
import { useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { Disclosure, Pager, Says, Screen } from "@/components/Screen";
import { Strip } from "@/components/Strip";
import { formatDay } from "@/lib/dates";
import {
  LEARNING_DAYS,
  MIN_DAY_PRESSES,
  MIN_RECENT_DAYS,
  MIN_USUAL_DAYS,
  PASSIVE_DEFS,
  thinkingContext,
  type PassiveMetric,
} from "@/lib/passive";
import { REPORT_DAYS, changedSince, measureNumbers, sourcesOfEvaluation, valuesSummary } from "@/lib/report";
import { useData } from "@/lib/storage";
import type { DayKey } from "@/lib/types";

const COUNT = ["None", "One", "Both", "Three"];

/** Short plain meanings, next to every number. */
const SHORT: Record<string, string> = {
  spread: "timing between key presses while writing; higher is more uneven",
  hold: "how long a key is held down while writing",
  firstActivity: "your first key press of the day",
  lastActivity: "your last key press of the day",
  quietNight: "last key press to the next first; an estimate of rest, not measured sleep",
};

function stripState(m: PassiveMetric, today: DayKey): string {
  if (m.status === "learning") return "Still learning your usual";
  if (m.status === "no-recent") return "Too few days this week to compare";
  if (m.status === "changed" && m.direction) {
    const d = PASSIVE_DEFS.find((x) => x.key === m.key)!;
    const since = changedSince(m, today);
    return `Stands out${since ? ` since ${formatDay(since)}` : ""}: ${m.direction === "up" ? d.upWord : d.downWord}`;
  }
  return "Within your usual";
}

function Measure({ m, today }: { m: PassiveMetric; today: DayKey }) {
  const n = measureNumbers(m);
  return (
    <div className="value-measure">
      <Strip m={m} points={REPORT_DAYS} state={stripState(m, today)} />
      <p className="small value-numbers">
        {n.recent ? `${n.recent} last week` : "Not enough days this week"}
        {n.usualLow ? `, usual ${n.usualLow} to ${n.usualHigh}${m.split ? " (weekdays and weekends apart)" : ""}` : ""}
        <span className="muted">: {SHORT[m.key]}</span>
      </p>
    </div>
  );
}

const HOW_IT_WORKS = (
  <>
    <p>
      Your usual is the middle 80 percent of your own days in the four weeks before the last week, with weekdays and
      weekends compared apart when there are enough of both. A value stands out when the middle of your last week is
      clearly outside it. You are never compared with other people.
    </p>
    <p>
      It needs {MIN_USUAL_DAYS} days with a value before the last week and {MIN_RECENT_DAYS} in it, and {LEARNING_DAYS}{" "}
      days in all before Cheri can ask. Typing counts only real writing, and a day needs {MIN_DAY_PRESSES} counted key
      presses.
    </p>
    <p>
      Cheri asks how you are only when two different sources stand out, or two parts of your day and night rhythm.
      Typing alone never makes Cheri ask.
    </p>
    <p>
      Only the timing of key presses is used, never which keys or what you write, and the kind of app in front
      (writing, code, browser or game), never its name or what is in it. Not connected yet: camera, microphone,
      bedside sensor.
    </p>
    <p>
      These values stay on this device unless you choose to save or print a report for your clinic. You choose what is
      measured in Settings.
    </p>
  </>
);

export default function ValuesPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const voice = useCompanionVoice();
  const { passive } = useReflection(data);
  const [view, setView] = useState<number | null>(null);
  if (!data || !ready || !passive) return null;

  const sources = sourcesOfEvaluation(passive);
  const out = sources.filter((s) => s.standsOut).length;
  const summary = valuesSummary(passive, "your");

  if (view === null || !sources[view]) {
    return (
      <Screen
        lead={
          <Says state={voice.state} size={72}>
            <p>{summary}</p>
            <p className="small muted">
              {passive.learning
                ? "Still learning, so nothing can stand out yet."
                : `${COUNT[out] ?? out} of the ${sources.length} sources ${out === 1 ? "stands" : "stand"} out compared with your own usual.`}
            </p>
          </Says>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => setView(0)}>
              See each source
            </button>
            <div className="links">
              <Link href="/share/" className="btn btn-quiet">
                Share with my clinic
              </Link>
              <Link href="/" className="btn btn-quiet">
                Back to home
              </Link>
            </div>
          </>
        }
      >
        <nav className="card menu" aria-label="Sources">
          {sources.map((s, i) => {
            const changed = s.metrics.filter((m) => m.status === "changed");
            const since = changed.map((m) => changedSince(m, today)).filter((d): d is string => !!d).sort()[0];
            return (
              <button key={s.id} type="button" className="menu-row" onClick={() => setView(i)}>
                <span className="menu-label">{s.label}</span>
                <span className="menu-value">
                  {s.standsOut
                    ? `Stands out${since ? ` since ${formatDay(since)}` : ""}`
                    : passive.learning
                      ? "Still learning"
                      : "Within your usual"}
                </span>
              </button>
            );
          })}
        </nav>
      </Screen>
    );
  }

  const source = sources[view];
  const thinking = source.id === "typing" ? thinkingContext(data, today) : null;
  return (
    <Screen
      lead={
        <div className="item-lead">
          <p className="small muted">My values, the last eight weeks</p>
          <h1>{source.label}</h1>
        </div>
      }
      actions={
        <>
          <Pager index={view} total={sources.length} onChange={setView} />
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={() => setView(null)}>
              Back to the summary
            </button>
            <Disclosure title="How this is worked out">{HOW_IT_WORKS}</Disclosure>
          </div>
        </>
      }
    >
      <section className="card values-card" aria-label={source.label}>
        {source.metrics.map((m) => (
          <Measure key={m.key} m={m} today={today} />
        ))}
        {thinking && (
          <p className="small muted value-numbers">
            Thinking pauses: {thinking.recent === null ? "not known yet" : `about ${Math.round(thinking.recent)} per 100 presses`}{" "}
            last week. Shown only; they never make Cheri ask.
          </p>
        )}
      </section>
    </Screen>
  );
}
