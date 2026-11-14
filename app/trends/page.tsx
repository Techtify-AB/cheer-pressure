"use client";

import Link from "next/link";
import { useState } from "react";
import { useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { Disclosure, Pager, Says, Screen } from "@/components/Screen";
import { Sparkline, type ChartMetric } from "@/components/Sparkline";
import { addDays, describeMinutes, formatShortDay } from "@/lib/dates";
import { CHART_DAYS, type Levels, type MetricLevel } from "@/lib/levels";
import { MIN_RECENT_DAYS, MIN_USUAL_DAYS, thinkingContext, typingAloneChanged, type PassiveMetric } from "@/lib/passive";
import { useData } from "@/lib/storage";

const SCALE_WORDS = ["not at all", "several days", "more than half the days", "nearly every day"];

function soFar(n: number): string {
  return `${n} ${n === 1 ? "day" : "days"} so far. A comparison needs a few more days.`;
}

/** What to show as "Last 7 days": the middle value, or the few values there are. */
function recentText(m: MetricLevel): { value: string; note: string } {
  if (m.recent) return { value: m.format(m.recent.median), note: "the middle value of the last week" };
  if (m.recentValues.length) return { value: m.recentValues.map(m.format).join(", "), note: soFar(m.recentValues.length) };
  return { value: "None", note: "nothing in the last 7 days" };
}

function changeText(m: MetricLevel): string {
  if (!m.usual) return "Your usual level shows up after about a week of entries.";
  if (!m.recent) return m.recentValues.length ? soFar(m.recentValues.length) : "Nothing in the last 7 days to compare.";
  if (m.direction === "steady" || m.delta === null) return "Close to your usual.";
  const up = m.direction === "up";
  switch (m.key) {
    case "bedtime":
      return `About ${describeMinutes(m.delta)} ${up ? "later" : "earlier"} than your usual.`;
    case "wake":
      return `About ${describeMinutes(m.delta)} ${up ? "later" : "earlier"} than your usual.`;
    case "sleep":
      return `About ${Math.abs(m.delta).toFixed(1)} hours ${up ? "more" : "less"} than your usual.`;
    case "form":
      return up ? "Higher than your usual." : "Lower than your usual.";
    case "speech":
      return up ? "Quicker than your usual." : "Slower than your usual.";
    case "reaction":
      return up ? "Slower than your usual." : "Quicker than your usual.";
  }
}

const dayWord = (n: number) => (n === 1 ? "day" : "days");

/** "above" and "below" for most measures; "later" and "earlier" for times of day. */
function sideWords(m: PassiveMetric): { up: string; down: string } {
  return m.key === "firstActivity" || m.key === "lastActivity"
    ? { up: "later than", down: "earlier than" }
    : { up: "above", down: "below" };
}

/** The verdict, worded exactly as the rule in lib/passive.ts decides it. */
function passiveStatus(m: PassiveMetric): string {
  if (m.status === "learning") {
    return `Your usual range shows up after ${MIN_USUAL_DAYS} days with a value before the last week. ${m.points.length} so far.`;
  }
  if (m.status === "no-recent" || !m.usual || !m.recentValues) {
    return `This needs ${MIN_RECENT_DAYS} days with a value in the last week to compare.`;
  }
  const words = sideWords(m);
  if (m.status === "changed") {
    const side = m.direction === "up" ? words.up : words.down;
    const p = m.phrase ? ` ${m.phrase.charAt(0).toUpperCase()}${m.phrase.slice(1)}.` : "";
    return `Over the last week this was clearly ${side} your usual range.${p}`;
  }
  return "Over the last week this was within your usual range.";
}

const KIND_WORDS: Record<string, string> = { writing: "writing", code: "code", browser: "the browser", other: "other apps" };

/** The last 14 days for the chart: one value per day (the middle one for sessions). */
function chartFor(m: PassiveMetric, today: string): ChartMetric {
  const byDay = new Map<string, number[]>();
  for (const p of m.points) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p.value]);
  const series = Array.from({ length: CHART_DAYS }, (_, i) => {
    const date = addDays(today, i - (CHART_DAYS - 1));
    const list = byDay.get(date);
    if (!list) return { date, value: null };
    const sorted = [...list].sort((a, b) => a - b);
    return { date, value: sorted[Math.floor((sorted.length - 1) / 2)] };
  });
  return { label: m.label, format: m.format, series, usual: m.usual };
}

const COUNT_WORDS = ["None", "One", "Two", "Three", "Four", "Five", "Six"];

const HOW_IT_WORKS = (
  <>
    <p>
      Your usual range is the middle 80 percent of your own days in the four weeks before the last week. Weekdays are
      compared with weekdays and weekends with weekends when there are enough of both. You are never compared with
      other people.
    </p>
    <p>
      A measure counts as changed when the middle of your last week is clearly outside that range. I only ask how you
      are doing when two different kinds of measure have changed (typing and your day and night rhythm), or at least
      two parts of your day and night rhythm. Typing alone never makes me ask.
    </p>
    <p>
      Typing counts only real writing: stretches of at least 30 key presses, and only the gaps under a second, so
      time spent thinking does not count. A day needs 300 counted presses. Typing is compared with the same kind of
      app (for example mail with mail) when there are enough days of it.
    </p>
    <p>
      Each chart shows the last 14 days, one dot per day. The green band is your usual range, the dashed line your
      usual middle. The shaded right part is the last 7 days.
    </p>
    <p>For your own entries, the last 7 days are compared with your usual from the 8 weeks before.</p>
    <p>&quot;Load demo data&quot; (For the demo, in Settings) adds eight weeks of made-up measurements where the last days change. Your own data is kept.</p>
  </>
);

function PassiveItem({ m, today }: { m: PassiveMetric; today: string }) {
  return (
    <section className="card stack-sm" aria-labelledby={`p-${m.key}`}>
      <p className="small muted">{m.meaning}.</p>
      <dl className="numbers">
        <div>
          <dt>Last week</dt>
          <dd>
            {m.recent
              ? m.format(m.recent.median)
              : m.points.length
                ? m.format(m.points[m.points.length - 1].value)
                : "None yet"}
          </dd>
          <dd className="small muted">
            {m.recent
              ? `the middle of ${m.recent.n} ${dayWord(m.recent.n)}`
              : m.points.length
                ? "your latest day"
                : "nothing measured yet"}
          </dd>
        </div>
        <div>
          <dt>Your usual range</dt>
          <dd>{m.usual ? `${m.format(m.usual.low)} to ${m.format(m.usual.high)}` : "Not yet"}</dd>
          <dd className="small muted">
            {m.usual
              ? `the middle 80 percent of ${m.usual.n} days before${m.split ? ", weekdays and weekends apart" : ""}`
              : "still learning"}
          </dd>
        </div>
      </dl>
      {m.kind && m.kind !== "all" ? (
        <p className="small muted">Compared with your own days of typing in {KIND_WORDS[m.kind]}.</p>
      ) : null}
      <Sparkline metric={chartFor(m, today)} />
    </section>
  );
}

function OwnItem({ m }: { m: MetricLevel }) {
  return (
    <section className="card stack-sm">
      <p className="small muted">{m.meaning}.</p>
      <dl className="numbers">
        <div>
          <dt>Last 7 days</dt>
          <dd>{recentText(m).value}</dd>
          <dd className="small muted">{recentText(m).note}</dd>
        </div>
        <div>
          <dt>Your usual</dt>
          <dd>{m.usual ? m.format(m.usual.median) : "Not yet"}</dd>
          <dd className="small muted">
            {m.usual ? `the middle of ${m.usual.n} of your earlier entries` : "needs about a week of entries"}
          </dd>
        </div>
      </dl>
      <Sparkline metric={m} />
    </section>
  );
}

type Item =
  | { kind: "passive"; key: string; title: string; verdict: string; m: PassiveMetric }
  | { kind: "context"; key: string; title: string; verdict: string; note: string }
  | { kind: "own"; key: string; title: string; verdict: string; m: MetricLevel }
  | { kind: "weekly"; key: string; title: string; verdict: string };

export default function TrendsPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const voice = useCompanionVoice();
  const { levels, passive, reflection } = useReflection(data);
  const [view, setView] = useState<number | null>(null);

  if (!data || !ready || !levels || !passive || !reflection) return null;

  const weeklyList = data.weekly.slice(-4).reverse(); // newest first; four fit on a phone
  const insight = reflection.passive.insight;
  const changedCount = passive.changed.length;

  const thinking = thinkingContext(data, today);
  const per100 = (v: number | null) => (v === null ? "not known yet" : `about ${Math.round(v)} per 100 presses`);
  const items: Item[] = [
    ...passive.metrics.map(
      (m): Item => ({ kind: "passive", key: m.key, title: m.label, verdict: passiveStatus(m), m }),
    ),
    {
      kind: "context",
      key: "thinking",
      title: "Thinking pauses",
      verdict: `Last week ${per100(thinking.recent)}; in the four weeks before ${per100(thinking.usual)}.`,
      note: "Gaps of one to two seconds while writing, when you stop to think. Shown only as context: they are left out of the typing numbers and never make me ask, because some writing simply needs more thought.",
    },
    ...levels.metrics
      .filter((m) => m.usual || m.recentValues.length)
      .map((m): Item => ({ kind: "own", key: m.key, title: m.label, verdict: changeText(m), m })),
    ...(weeklyList.length
      ? [{ kind: "weekly", key: "weekly", title: "Weekly answers", verdict: weeklyVerdict(levels) } as Item]
      : []),
  ];

  if (view === null || !items[view]) {
    return (
      <Screen
        lead={
          <Says state={voice.state} size={72}>
            <p>{insight}</p>
            <p className="small muted">
              {passive.learning
                ? "Still learning, so no measure can count as changed yet."
                : `${COUNT_WORDS[changedCount] ?? changedCount} of the ${passive.metrics.length} measures ${changedCount === 1 ? "has" : "have"} changed compared with your own usual range.${typingAloneChanged(passive) ? " Typing alone does not make me ask." : ""}`}
            </p>
          </Says>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => setView(0)}>
              See each measure
            </button>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={() => voice.say(insight)}>
                Read this aloud
              </button>
              <Link href="/demo/" className="btn btn-quiet">
                Back to the demo
              </Link>
            </div>
          </>
        }
      >
        <section className="card stack-sm" aria-label="How a change is decided">
          <p>
            A measure counts as changed when the middle of your last week is clearly outside your usual range from the
            four weeks before. I only ask how you are doing when two different kinds of measure have changed (typing and your day and night rhythm), or at least two parts of your day and night rhythm. Typing alone never makes me ask.
          </p>
          <Disclosure title="How this is worked out">{HOW_IT_WORKS}</Disclosure>
        </section>
      </Screen>
    );
  }

  const item = items[view];
  const section = item.kind === "passive" || item.kind === "context" ? "Measured by itself" : "What you told me yourself";

  return (
    <Screen
      lead={
        <div className="item-lead">
          <p className="small muted">
            {section}: {item.title}
          </p>
          <h1>{item.verdict}</h1>
        </div>
      }
      actions={
        <>
          <Pager index={view} total={items.length} onChange={setView} />
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={() => setView(null)}>
              Back to the summary
            </button>
            <Disclosure title="How this is worked out">{HOW_IT_WORKS}</Disclosure>
          </div>
        </>
      }
    >
      {item.kind === "passive" && <PassiveItem m={item.m} today={today} />}
      {item.kind === "own" && <OwnItem m={item.m} />}
      {item.kind === "context" && (
        <section className="card stack-sm">
          <p className="small muted">{item.note}</p>
        </section>
      )}
      {item.kind === "weekly" && (
        <section className="card stack-sm">
          <p className="small muted">0 means not at all, 1 several days, 2 more than half the days, 3 nearly every day.</p>
          <table className="weekly-table">
            <thead>
              <tr>
                <th scope="col">Question</th>
                {weeklyList.map((w) => (
                  <th key={w.date} scope="col">
                    {formatShortDay(w.date)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {levels.weekly.items.map((it) => (
                <tr key={it.key}>
                  <th scope="row">{it.label}</th>
                  {weeklyList.map((w) => {
                    const v = it.key.startsWith("sign:")
                      ? w.signs.find((x) => `sign:${x.sign}` === it.key)?.value
                      : w[it.key as "down" | "interest" | "sleep" | "tense"];
                    return (
                      <td key={w.date} data-level={v ?? ""}>
                        {v ?? ""}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </Screen>
  );
}

/** One line about the weekly answers: what went up or down in the latest answer. */
function weeklyVerdict(levels: Levels): string {
  const moved = levels.weekly.items.filter((i) => i.direction === "up" || i.direction === "down");
  if (!moved.length) return "Your latest weekly answers are close to your usual ones.";
  return moved
    .slice(0, 2)
    .map(
      (i) =>
        `${i.label}: ${SCALE_WORDS[i.latest]} in the latest answer, ${i.direction === "up" ? "more" : "less"} than your usual.`,
    )
    .join(" ");
}
