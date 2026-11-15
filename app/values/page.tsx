"use client";

// "My values": everything Cheri measures, for the person, one category at a time (Sleep, Energy,
// Social, Mood). It opens on one sentence and how many categories stand out; then each category
// lists every one of its inputs in a fixed order, each in one honest state: its measures as
// strips over the last eight weeks against the person's own usual band (with the numbers, what
// they mean, and "since" where the rule says a measure has changed), "On, still learning", "Off"
// with a link to its switch, or "Not connected yet". A category that does not fit one view is
// paged with the same Previous and Next. The same numbers go into
// the clinic report (lib/report.ts), which the person can save or print from here.

import Link from "next/link";
import { useEffect, useState } from "react";
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
  SOURCES,
  thinkingContext,
  type PassiveMetric,
} from "@/lib/passive";
import { REPORT_DAYS, changedSince, measureNumbers, sourcesOfEvaluation, valuesSummary } from "@/lib/report";
import { categoryLine, categoryOpening, inputViews, type InputView } from "@/lib/categories";
import { useTrusted } from "@/lib/trusted";
import { useData } from "@/lib/storage";
import type { AppData, DayKey } from "@/lib/types";
import type { CategoryId, Evaluation } from "@/lib/passive";

const COUNT = ["None", "One", "Two", "Three"];
const SLEEP_ESTIMATE = "An estimate from your first and last key press each day. Connect a watch or phone for real sleep.";

/** Short plain meanings, next to every number. */
const SHORT: Record<string, string> = {
  spread: "timing between key presses while writing; higher is more uneven",
  hold: "how long a key is held down while writing",
  firstActivity: "your first key press of the day",
  lastActivity: "your last key press of the day",
  quietNight: "last key press to the next first; an estimate of rest, not measured sleep",
  movementLevel: "shoulder widths a second, in front of the computer; no picture is kept",
  positionChanges: "new positions held, per hour in front of the computer",
  voicePace: "voiced stretches a minute while you talk; no words are recognised",
  contact: "messages with the person you trust; never what they say",
  timeOut: "time out of your home a day; only at home or not, never where",
  phoneTalk: "calls and conversations on your phone a day; how many, never with whom",
  homeTalk: "minutes of talking heard at home by the desktop app; never the words",
  sawSomeone: "your own answer to \"Did you see or talk to anyone today?\"",
  ownAnswer: "your own answer to \"How are you today?\"",
  faceMovement: "how much your face moved in view; an observation, never a feeling",
  raisedMouth: "share of the time your mouth corners were raised; an observation, never a feeling",
  posture: "head height above the shoulders; lower is more slumped",
  pitchVariability: "how much the pitch of your voice moves; no words are recognised",
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

function Measure({ m, today, input }: { m: PassiveMetric; today: DayKey; input: string }) {
  const n = measureNumbers(m);
  const state = stripState(m, today);
  return (
    <div className="value-measure" data-input={input} data-state="values" data-status={m.status} data-changed={m.status === "changed" || undefined}>
      <p className="value-head">
        <span className="strip-label">{m.label}</span>
        <span className="value-num">
          {n.recent ? `${n.recent} last week` : "too few days"}
          {n.usualLow ? `, usual ${n.usualLow} to ${n.usualHigh}` : ""}
        </span>
      </p>
      <Strip m={m} points={REPORT_DAYS} state={state} head={false} />
      <p className="value-meaning">
        <span className="value-state">{state}.</span> {SHORT[m.key]}
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
      days in all before Cheri can ask.
    </p>
    <p>
      Cheri asks how you are only when at least two different categories stand out. No category asks alone, not even
      your own daily answers. Only your own answer ever says how you feel; the camera and the microphone only give
      observations against your usual, and never outweigh your answer.
    </p>
    <p>
      Sleep is an estimate from when this computer is used; a watch or phone would give real sleep. Movement, face
      movement and posture are worked out from the camera on this computer, pace and tone of voice from the microphone,
      and no picture, sound or words are kept. Typing counts only real writing, never which keys or what you write, and
      a day needs {MIN_DAY_PRESSES} counted key presses.
    </p>
    <p>
      These values stay on this device unless you choose to save or print a report for your clinic. You choose what is
      measured in Settings.
    </p>
  </>
);

/** How much room an input takes in a category view: one per strip, less for a one-line state. */
const LINE = 0.45;
const PAGE_ROOM = 4.9;

interface Page {
  id: CategoryId;
  views: InputView[];
  part: number;
  parts: number;
}

/** Each category's inputs, in order, split into views that fit without scrolling. */
function pagesOf(data: AppData, e: Evaluation, paired: boolean): Page[] {
  return SOURCES.flatMap((c) => {
    const all = inputViews(c.id, data, e, paired);
    // Not connected yet: one quiet line for all of them, at the end.
    const connected = all.filter((v) => v.kind !== "not-connected");
    const missing = all.filter((v) => v.kind === "not-connected");
    const chunks: InputView[][] = [[]];
    let room = PAGE_ROOM - (missing.length ? LINE : 0) - (c.id === "sleep" ? LINE : 0);
    for (const v of connected) {
      const need = v.kind === "values" ? v.metrics.length + (v.input.id === "typing" ? LINE : 0) : LINE;
      if (chunks[chunks.length - 1].length && need > room) {
        chunks.push([]);
        room = PAGE_ROOM;
      }
      chunks[chunks.length - 1].push(v);
      room -= need;
    }
    chunks[chunks.length - 1].push(...missing);
    return chunks.map((views, i) => ({ id: c.id, views, part: i + 1, parts: chunks.length }));
  });
}

function InputLine({ v }: { v: InputView }) {
  if (v.kind === "learning") {
    return (
      <p className="value-input" data-input={v.input.id} data-state="learning">
        <span className="value-input-name">{v.input.label}</span> On, still learning ({v.days} of {LEARNING_DAYS} days).
      </p>
    );
  }
  if (v.kind === "off") {
    return (
      <p className="value-input" data-input={v.input.id} data-state="off">
        <span className="value-input-name">{v.input.label}</span> Off.{" "}
        <Link href={v.href} className="value-input-link">
          {v.action}
        </Link>
        {v.rest}
      </p>
    );
  }
  return null;
}

export default function ValuesPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const voice = useCompanionVoice();
  const { passive } = useReflection(data);
  const paired = !!useTrusted()?.pairing;
  const [view, setView] = useState<number | null>(null);
  // Home opens a category directly (?c=sleep).
  const [opening, setOpening] = useState<string | null>(null);
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("c");
    if (!SOURCES.some((x) => x.id === c)) return;
    const t = window.setTimeout(() => setOpening(c), 0);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!opening || !data || !passive) return;
    const i = pagesOf(data, passive, paired).findIndex((p) => p.id === opening);
    const t = window.setTimeout(() => {
      setView(i < 0 ? null : i);
      setOpening(null);
    }, 0);
    return () => window.clearTimeout(t);
  }, [opening, data, passive, paired]);
  if (!data || !ready || !passive) return null;

  // The four categories, always: Sleep, Energy, Social, Mood.
  const sources = sourcesOfEvaluation(passive);
  const out = sources.filter((s) => s.standsOut).length;
  const summary = valuesSummary(passive, "your");
  const pages = pagesOf(data, passive, paired);

  if (view === null || !pages[view]) {
    return (
      <Screen
        lead={
          <Says state={voice.state} size={72}>
            <p>{summary}</p>
            <p className="small muted">
              {passive.learning
                ? "Still learning, so nothing can stand out yet."
                : `${COUNT[out] ?? out} of the ${sources.length} categories ${out === 1 ? "stands" : "stand"} out compared with your own usual.`}
            </p>
          </Says>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => setView(0)}>
              See each category
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
        <nav className="card menu category-menu" aria-label="Categories">
          {sources.map((s) => (
            <button key={s.id} type="button" className="menu-row" onClick={() => setView(pages.findIndex((p) => p.id === s.id))}>
              <span className="menu-label">{s.label}</span>
              <span className="menu-value" data-changed={(!passive.learning && passive.metrics.some((m) => m.source === s.id && m.status === "changed")) || undefined}>{categoryLine(s.id, data, passive, today, paired)}</span>
            </button>
          ))}
        </nav>
      </Screen>
    );
  }

  const page = pages[view];
  const cat = SOURCES.find((c) => c.id === page.id)!;
  const openingLine = categoryOpening(page.id, inputViews(page.id, data, passive, paired), passive);
  const thinking = page.views.some((v) => v.kind === "values" && v.input.id === "typing") ? thinkingContext(data, today) : null;
  const missing = page.views.filter((v) => v.kind === "not-connected");
  return (
    <Screen
      lead={
        <div className="item-lead">
          <p className="small muted">
            My values, the last eight weeks{page.parts > 1 ? `. Part ${page.part} of ${page.parts}` : ""}
          </p>
          <h1>{cat.label}</h1>
          <p className="value-opening" data-opening="">
            {openingLine}
          </p>
        </div>
      }
      actions={
        <>
          <Pager index={view} total={pages.length} onChange={setView} />
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={() => setView(null)}>
              Back to the summary
            </button>
            <Disclosure title="How this is worked out">{HOW_IT_WORKS}</Disclosure>
          </div>
        </>
      }
    >
      <section className="card values-card" aria-label={cat.label} data-category={page.id}>
        {page.views.map((v) =>
          v.kind === "values" ? (
            v.metrics.map((m) => <Measure key={m.key} m={m} today={today} input={v.input.id} />)
          ) : v.kind === "not-connected" ? null : (
            <InputLine key={v.input.id} v={v} />
          ),
        )}
        {thinking && (
          <p className="small muted value-numbers">
            Thinking pauses: {thinking.recent === null ? "not known yet" : `about ${Math.round(thinking.recent)} per 100 presses`}{" "}
            last week. Shown only; they never make Cheri ask.
          </p>
        )}
        {page.id === "sleep" && page.part === 1 && <p className="small muted value-numbers">{SLEEP_ESTIMATE}</p>}
        {missing.length > 0 && (
          <p className="value-input" data-state="not-connected" data-inputs={missing.map((v) => v.input.id).join(" ")}>
            <span className="value-input-name">Not connected yet</span> {missing.map((v) => v.input.label).join(", ")}.
          </p>
        )}
      </section>
    </Screen>
  );
}
