"use client";

import { Companion } from "@/components/companion/Companion";
import { useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { Sparkline } from "@/components/Sparkline";
import { describeMinutes, formatShortDay } from "@/lib/dates";
import { makeDemoData } from "@/lib/demo";
import type { MetricLevel } from "@/lib/levels";
import { addDemo, clearDemo, hasDemo, useData } from "@/lib/storage";

const SCALE_WORDS = ["not at all", "several days", "more than half the days", "nearly every day"];

function changeText(m: MetricLevel): string {
  if (!m.usual) return "Your usual level shows up after about a week of entries.";
  if (!m.recent) return "Not enough entries in the last 7 days to compare.";
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

export default function TrendsPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const voice = useCompanionVoice();
  const { levels, reflection } = useReflection(data);

  if (!data || !ready || !levels) return null;

  const demoOn = hasDemo(data);
  const anything = data.daily.length + data.weekly.length + data.reaction.length > 0;
  const weeklyList = data.weekly.slice(-6);

  return (
    <div className="stack-lg">
      <div>
        <h1>Your own level</h1>
        <p className="muted" style={{ margin: 0 }}>
          The last 14 days compared with your usual level. Your usual level comes only from your own earlier
          entries, never from other people.
        </p>
      </div>

      <section className="demo-box stack" aria-labelledby="demo-title">
        <div>
          <span className="placeholder-tag">Demo</span>
          <h2 id="demo-title" style={{ fontSize: "var(--font-size-lg)", margin: 0 }}>
            {demoOn ? "Showing made-up demo data" : "Try it with made-up data"}
          </h2>
          <p className="small muted" style={{ margin: 0 }}>
            Six weeks of invented entries where the last week changes, so you can see how this works. Your own
            entries are kept and not overwritten.
          </p>
        </div>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => addDemo(makeDemoData(today, data.profile?.earlySigns ?? []))}
          >
            {demoOn ? "Reload demo data" : "Load demo data"}
          </button>
          {demoOn && (
            <button type="button" className="btn btn-secondary" onClick={clearDemo}>
              Clear demo data
            </button>
          )}
        </div>
      </section>

      {anything && reflection && (
        <div className="companion-row" style={{ flexDirection: "row", textAlign: "left", alignItems: "flex-start" }}>
          <div style={{ flex: "0 0 auto" }}>
            <Companion state={voice.state} size={84} />
          </div>
          <div className="bubble" style={{ flex: 1 }} aria-live="polite">
            <p>{reflection.say}</p>
            {reflection.suggestion && (
              <p className="suggestion">
                <strong>One small thing to try:</strong> {reflection.suggestion.text}
              </p>
            )}
            <button
              type="button"
              className="btn btn-quiet small"
              style={{ paddingLeft: 0, minHeight: 36 }}
              onClick={() =>
                voice.say(reflection.suggestion ? `${reflection.say} ${reflection.suggestion.text}` : reflection.say)
              }
            >
              Read this aloud
            </button>
          </div>
        </div>
      )}

      {!anything && (
        <div className="card">
          <p style={{ margin: 0 }}>
            Nothing here yet. After your first check-ins you&apos;ll see them here, and your usual level appears after
            about a week.
          </p>
        </div>
      )}

      {anything && (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            In each chart, a dot is one day. The green band is your usual range and the dashed line your usual
            middle value. The shaded right part is the last 7 days.
          </p>

          {levels.metrics.map((m) => (
            <section key={m.key} className="card stack" aria-labelledby={`m-${m.key}`}>
              <div>
                <h2 id={`m-${m.key}`} style={{ fontSize: "var(--font-size-lg)", marginBottom: 2 }}>
                  {m.label} {m.experimental && <span className="badge badge-experiment">Experiment</span>}
                </h2>
                <p className="small muted" style={{ margin: 0 }}>
                  {m.meaning}.
                </p>
              </div>
              <dl className="numbers">
                <div>
                  <dt>Last 7 days</dt>
                  <dd>{m.recent ? m.format(m.recent.median) : "No entries"}</dd>
                  <dd className="small muted">the middle value of the last week</dd>
                </div>
                <div>
                  <dt>Your usual</dt>
                  <dd>{m.usual ? m.format(m.usual.median) : "Not yet"}</dd>
                  <dd className="small muted">
                    {m.usual ? `from ${m.usual.n} of your earlier entries` : "needs about a week of entries"}
                  </dd>
                </div>
              </dl>
              <p style={{ margin: 0 }}>
                <strong>{changeText(m)}</strong>
              </p>
              <Sparkline metric={m} />
            </section>
          ))}

          <section className="card stack" aria-labelledby="weekly-title">
            <div>
              <h2 id="weekly-title" style={{ fontSize: "var(--font-size-lg)", marginBottom: 2 }}>
                Weekly answers
              </h2>
              <p className="small muted" style={{ margin: 0 }}>
                0 means not at all, 1 several days, 2 more than half the days, 3 nearly every day.
              </p>
            </div>
            {weeklyList.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
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
                <ul className="small" style={{ margin: 0, paddingLeft: "1.2em" }}>
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
