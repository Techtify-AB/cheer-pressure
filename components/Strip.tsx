"use client";

// One measure as a strip of daily dots over the person's own usual band. Used by the replay
// and by "My values", so both draw a measure the same way.

import type { PassiveMetric } from "@/lib/passive";

const W = 300;
const H = 44;
const PAD = 5;

/**
 * One measure: the person's usual range as a band and one dot per day. The last week (what the
 * rule compares) is drawn larger, in the change colour only when it counts as a change.
 */
export function Strip({ m, points: STRIP_POINTS, state: stateText }: { m: PassiveMetric; points: number; state?: string }) {
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
