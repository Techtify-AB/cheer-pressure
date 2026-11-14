import type { MetricLevel } from "@/lib/levels";

const W = 300;
const H = 84;
const PAD_X = 8;
const PAD_Y = 10;

/** Last 14 days as dots, with the person's own usual range as a shaded band. */
export function Sparkline({ metric }: { metric: MetricLevel }) {
  const values = metric.series.map((p) => p.value).filter((v): v is number => v !== null);
  const usual = metric.usual;
  const all = [...values, ...(usual ? [usual.low, usual.high] : [])];
  if (!all.length) return null;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  lo -= span * 0.12;
  hi += span * 0.12;
  const x = (i: number) => PAD_X + (i * (W - PAD_X * 2)) / (metric.series.length - 1);
  const y = (v: number) => H - PAD_Y - ((v - lo) / (hi - lo)) * (H - PAD_Y * 2);
  const recentStart = metric.series.length - 7;

  let bandTop = 0;
  let bandHeight = 0;
  if (usual) {
    bandTop = y(usual.high);
    bandHeight = Math.max(4, y(usual.low) - y(usual.high));
    if (bandHeight === 4) bandTop -= 2;
  }

  const points = metric.series
    .map((p, i) => (p.value === null ? null : `${x(i)},${y(p.value)}`))
    .filter(Boolean)
    .join(" ");

  const label = `${metric.label}, last 14 days. ${values.length} days with an entry.${
    usual ? ` Shaded band shows your usual range, ${metric.format(usual.low)} to ${metric.format(usual.high)}.` : ""
  }`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={label} style={{ display: "block" }}>
      <rect
        x={x(recentStart) - 6}
        y={0}
        width={W - x(recentStart) + 6}
        height={H}
        fill="var(--color-surface-muted)"
        rx="6"
      />
      {usual && <rect x={0} y={bandTop} width={W} height={bandHeight} fill="var(--color-band)" rx="4" />}
      {usual && (
        <line
          x1={0}
          x2={W}
          y1={y(usual.median)}
          y2={y(usual.median)}
          stroke="var(--color-primary)"
          strokeOpacity="0.45"
          strokeDasharray="4 4"
        />
      )}
      <polyline points={points} fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.5" strokeOpacity="0.6" />
      {metric.series.map((p, i) => {
        if (p.value === null) return null;
        const outside = usual ? p.value > usual.high || p.value < usual.low : false;
        return (
          <circle
            key={p.date}
            cx={x(i)}
            cy={y(p.value)}
            r={4}
            fill={outside && i >= recentStart ? "var(--color-change)" : "var(--color-ink)"}
          />
        );
      })}
    </svg>
  );
}
