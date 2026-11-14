"use client";

// One measure as a strip of daily dots over the person's own usual band. Used by the replay
// and by "My values", so both draw a measure the same way.

import type { PassiveMetric } from "@/lib/passive";

const W = 300;
const PAD = 5;
/** Room on the left for the level names of a level strip ("Not so good"). */
const LEVEL_LABELS_W = 84;

/**
 * One measure: the person's usual range as a band and one dot per day. The last week (what the
 * rule compares) is drawn larger, in the change colour only when it counts as a change.
 */
export function Strip({
  m,
  points: STRIP_POINTS,
  state: stateText,
  head = true,
  levels,
}: {
  m: PassiveMetric;
  points: number;
  state?: string;
  /** False when the caller shows the label and state itself. */
  head?: boolean;
  /**
   * For a measure with a few named values (the daily answer: Good, Okay, Not so good): the name
   * of each value, index = value, drawn as rows with the first on top.
   */
  levels?: string[];
}) {
  const H = levels ? 58 : 44;
  const left = levels ? LEVEL_LABELS_W : 0;
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
  if (levels) {
    lo = -0.5;
    hi = levels.length - 0.5;
  } else if (m.usual) {
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
  const up = (v: number) => H - PAD - ((clampY(v) - lo) / (hi - lo)) * (H - PAD * 2);
  // A level strip has its first level on top.
  const y = (v: number) => (levels ? H - up(v) : up(v));
  const x = (i: number) => left + PAD + (i + (STRIP_POINTS - pts.length)) * ((W - left - PAD * 2) / (STRIP_POINTS - 1));
  // The last week is what the rule compares; it gets the change colour only when it counts as a change.
  const recentFrom = pts.length - (m.recentValues?.length ?? 0);
  const changed = m.status === "changed";

  let state: string;
  if (stateText) state = stateText;
  else if (m.status === "learning") state = "Still learning";
  else if (m.status === "changed" && m.phrase) state = `Changed: ${m.phrase}`;
  else state = "Usual";

  return (
    <div className="strip" data-changed={m.status === "changed" || undefined}>
      {head && (
      <div className="strip-head">
        <span className="strip-label">{m.label}</span>
        <span className="strip-state">{state}</span>
      </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
        {levels?.map((name, v) => (
          <g key={name}>
            <line x1={left} x2={W} y1={y(v)} y2={y(v)} className="strip-level" />
            <text x={0} y={y(v)} dy="0.35em" className="strip-level-name">
              {name}
            </text>
          </g>
        ))}
        {m.usual && (
          <rect
            x={left}
            y={Math.min(y(m.usual.high), y(m.usual.low)) - (levels ? 4 : 0)}
            width={W - left}
            height={Math.max(3, Math.abs(y(m.usual.low) - y(m.usual.high))) + (levels ? 8 : 0)}
            rx={3}
            className="strip-band"
          />
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
