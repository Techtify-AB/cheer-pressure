"use client";

import { useRouter } from "next/navigation";
import { Companion } from "@/components/companion/Companion";
import { useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { Sparkline, type ChartMetric } from "@/components/Sparkline";
import { addDays, describeMinutes, formatShortDay } from "@/lib/dates";
import { makeDemoData } from "@/lib/demo";
import { CHART_DAYS, type MetricLevel } from "@/lib/levels";
import { MIN_USUAL_POINTS, RECENT_POINTS, type PassiveMetric } from "@/lib/passive";
import { addDemo, clearDemo, hasDemo, saveSettings, useData } from "@/lib/storage";

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

function unitWord(m: PassiveMetric, n: number): string {
  return m.unit === "session" ? (n === 1 ? "session" : "sessions") : n === 1 ? "day" : "days";
}

const NUMBER_WORDS = ["None", "One", "Two", "Three"];

/** "above" and "below" for most measures; "later" and "earlier" for times of day. */
function sideWords(m: PassiveMetric): { up: string; down: string } {
  return m.key === "firstActivity" || m.key === "lastActivity"
    ? { up: "later than", down: "earlier than" }
    : { up: "above", down: "below" };
}

/** The verdict, worded exactly as the rule in lib/passive.ts decides it. */
function passiveStatus(m: PassiveMetric): string {
  const need = MIN_USUAL_POINTS + RECENT_POINTS;
  if (m.status === "learning") {
    return `Your usual range shows up after ${need} ${unitWord(m, need)}. ${m.points.length} so far.`;
  }
  if (m.status === "no-recent" || !m.usual || !m.recentValues) return "Nothing in the last 7 days to compare.";
  const usual = m.usual;
  const n = m.recentValues.length;
  const above = m.recentValues.filter((v) => v > usual.high).length;
  const below = m.recentValues.filter((v) => v < usual.low).length;
  const words = sideWords(m);
  const last = `your last ${NUMBER_WORDS[n]?.toLowerCase() ?? n} ${unitWord(m, n)}`;
  if (m.status === "changed") {
    const side = m.direction === "up" ? words.up : words.down;
    const p = m.phrase ? ` ${m.phrase.charAt(0).toUpperCase()}${m.phrase.slice(1)}.` : "";
    return `All ${NUMBER_WORDS[n]?.toLowerCase() ?? n} of your last ${unitWord(m, n)} were ${side} your usual range.${p}`;
  }
  if (above === 0 && below === 0) return "Within your usual range.";
  if (above && below) {
    return `Of ${last}, ${NUMBER_WORDS[above].toLowerCase()} ${above === 1 ? "was" : "were"} ${words.up} and ${NUMBER_WORDS[below].toLowerCase()} ${below === 1 ? "was" : "were"} ${words.down} your usual range, so this does not count as a change.`;
  }
  const k = above || below;
  const side = above ? words.up : words.down;
  return `${NUMBER_WORDS[k]} of ${last} ${k === 1 ? "was" : "were"} ${side} your usual range, so this does not count as a change yet.`;
}

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

function PassiveCard({ m, today }: { m: PassiveMetric; today: string }) {
  return (
    <section className="card stack" aria-labelledby={`p-${m.key}`}>
      <div>
        <h3 id={`p-${m.key}`} style={{ fontSize: "var(--font-size-lg)", marginBottom: 2 }}>
          {m.label}
        </h3>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {m.meaning}.
        </p>
      </div>
      <dl className="numbers">
        <div>
          <dt>{m.recentValues ? `Last ${m.recentValues.length} ${unitWord(m, m.recentValues.length)}` : "Lately"}</dt>
          <dd>
            {m.recentValues
              ? m.recentValues.map(m.format).join(", ")
              : m.points.length
                ? m.format(m.points[m.points.length - 1].value)
                : "None yet"}
          </dd>
          <dd className="small muted">
            {m.recentValues
              ? "oldest first, each one compared with your usual range"
              : m.points.length
                ? `your latest ${m.unit}`
                : "nothing measured yet"}
          </dd>
        </div>
        <div>
          <dt>Your usual range</dt>
          <dd>{m.usual ? `${m.format(m.usual.low)} to ${m.format(m.usual.high)}` : "Not yet"}</dd>
          <dd className="small muted">
            {m.usual ? `from ${m.usual.n} earlier ${unitWord(m, m.usual.n)}` : "still learning"}
          </dd>
        </div>
      </dl>
      <p style={{ marginBottom: 0 }}>
        <strong>{passiveStatus(m)}</strong>
      </p>
      <Sparkline metric={chartFor(m, today)} />
    </section>
  );
}

export default function TrendsPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const voice = useCompanionVoice();
  const { levels, passive, reflection } = useReflection(data);
  const router = useRouter();

  if (!data || !ready || !levels || !passive || !reflection) return null;

  const demoOn = hasDemo(data);
  const anything = data.daily.length + data.weekly.length + data.reaction.length > 0;
  const weeklyList = data.weekly.slice(-6).reverse(); // newest first, so it is visible on a phone
  const insight = reflection.passive.insight;

  const loadDemo = () => addDemo(makeDemoData(today, data.profile?.earlySigns ?? []));
  const simulate = () => {
    loadDemo();
    saveSettings({ simulatedChangeAt: new Date().toISOString() });
    router.push("/prompt/");
  };

  return (
    <div className="stack-lg">
      <div>
        <h1>Your own level</h1>
        <p className="muted" style={{ marginBottom: 0 }}>
          What is measured by itself, compared with your own usual range: the middle half of your own earlier
          sessions and days. Never with other people. A measure counts as changed only when your last three sessions
          or days in a row are all outside that range on the same side, and I only ask how you are doing when at least
          two measures have changed.
        </p>
      </div>

      <div className="companion-row" style={{ flexDirection: "row", textAlign: "left", alignItems: "flex-start" }}>
        <div style={{ flex: "0 0 auto" }}>
          <Companion state={voice.state} size={84} />
        </div>
        <div className="bubble" style={{ flex: 1 }} aria-live="polite">
          <p>{insight}</p>
          <button
            type="button"
            className="btn btn-quiet small"
            style={{ paddingLeft: 0, minHeight: 36 }}
            onClick={() => voice.say(insight)}
          >
            Read this aloud
          </button>
        </div>
      </div>

      <section className="demo-box stack" aria-labelledby="demo-title">
        <div>
          <span className="placeholder-tag">Demo</span>
          <h2 id="demo-title" style={{ fontSize: "var(--font-size-lg)", marginBottom: 0 }}>
            {demoOn ? "Showing made-up demo data" : "Try it with made-up data"}
          </h2>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Six weeks of invented measurements where the last days change, so you can see how this works. Your own
            data is kept and not overwritten. &quot;Simulate a change&quot; also makes the companion ask right away.
          </p>
        </div>
        <div className="btn-row">
          <button type="button" className="btn btn-secondary" onClick={loadDemo}>
            {demoOn ? "Reload demo data" : "Load demo data"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={simulate}>
            Simulate a change
          </button>
          {demoOn && (
            <button type="button" className="btn btn-secondary" onClick={clearDemo}>
              Clear demo data
            </button>
          )}
        </div>
      </section>

      <p className="small muted" style={{ marginBottom: 0 }}>
        Each chart shows the last 14 days, one dot per day (for typing, the middle value of that day&apos;s sessions). The green
        band is your usual range and the dashed line your usual middle value. The shaded right part marks the last 7
        days, and dots there outside your usual range are coloured. The verdict above each chart uses only the last
        three sessions or days listed on the card.
      </p>

      <section className="stack" aria-labelledby="passive-title">
        <h2 id="passive-title" style={{ fontSize: "var(--font-size-xl)", marginBottom: 0 }}>
          Measured by itself
        </h2>
        {passive.metrics.map((m) => (
          <PassiveCard key={m.key} m={m} today={today} />
        ))}
      </section>

      {anything && reflection && (
        <section className="stack" aria-labelledby="own-title">
          <div>
            <h2 id="own-title" style={{ fontSize: "var(--font-size-xl)", marginBottom: 2 }}>
              Your own entries
            </h2>
            <p className="small muted" style={{ marginBottom: 0 }}>
              What you told me yourself, in check-ins and the reaction test. {reflection.say}
            </p>
          </div>
        </section>
      )}

      {anything && (
        <>

          {levels.metrics.map((m) => (
            <section key={m.key} className="card stack" aria-labelledby={`m-${m.key}`}>
              <div>
                <h3 id={`m-${m.key}`} style={{ fontSize: "var(--font-size-lg)", marginBottom: 2 }}>
                  {m.label} {m.experimental && <span className="badge badge-experiment">Experiment</span>}
                </h3>
                <p className="small muted" style={{ marginBottom: 0 }}>
                  {m.meaning}.
                </p>
              </div>
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
                    {m.usual ? `from ${m.usual.n} of your earlier entries` : "needs about a week of entries"}
                  </dd>
                </div>
              </dl>
              <p style={{ marginBottom: 0 }}>
                <strong>{changeText(m)}</strong>
              </p>
              <Sparkline metric={m} />
            </section>
          ))}

          <section className="card stack" aria-labelledby="weekly-title">
            <div>
              <h3 id="weekly-title" style={{ fontSize: "var(--font-size-lg)", marginBottom: 2 }}>
                Weekly answers
              </h3>
              <p className="small muted" style={{ marginBottom: 0 }}>
                0 means not at all, 1 several days, 2 more than half the days, 3 nearly every day. Newest answer first.
              </p>
            </div>
            {weeklyList.length === 0 ? (
              <p className="muted" style={{ marginBottom: 0 }}>
                No weekly answers yet.
              </p>
            ) : (
              <>
                <div className="weekly-table-wrap">
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
                      {levels.weekly.items.map((item) => (
                        <tr key={item.key}>
                          <th scope="row">{item.label}</th>
                          {weeklyList.map((w) => {
                            const v = item.key.startsWith("sign:")
                              ? w.signs.find((s) => `sign:${s.sign}` === item.key)?.value
                              : w[item.key as "down" | "interest" | "sleep" | "tense"];
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
                </div>
                <ul className="small" style={{ marginBottom: 0, paddingLeft: "1.2em" }}>
                  {levels.weekly.items
                    .filter((i) => i.direction === "up" || i.direction === "down")
                    .map((i) => (
                      <li key={i.key}>
                        {i.label}: {SCALE_WORDS[i.latest]} in the latest answer,{" "}
                        {i.direction === "up" ? "more" : "less"} than your usual.
                      </li>
                    ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
