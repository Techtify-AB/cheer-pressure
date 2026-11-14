"use client";

import type { PosePoints } from "@/lib/camera";
import s from "./camera.module.css";

/**
 * The nose, both shoulders and the line between the shoulders, drawn over the picture.
 * Mirrored like the video, so moving to the left moves the points to the left. The same
 * drawing is used for the live camera and the recorded example.
 */
export function PoseOverlay({
  points,
  aspect,
  present,
  figure = false,
}: {
  points: PosePoints | null;
  aspect: number;
  present: boolean;
  /** A soft outline of a head and shoulders behind the points, for the example (there is no picture). */
  figure?: boolean;
}) {
  const W = 100 * aspect;
  const H = 100;
  const at = (p: { x: number; y: number }) => ({ x: (1 - p.x) * W, y: p.y * H });
  const n = points ? at(points.nose) : null;
  const l = points ? at(points.leftShoulder) : null;
  const r = points ? at(points.rightShoulder) : null;
  return (
    <svg
      className={s.overlay}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      data-present={present || undefined}
    >
      {figure && n && l && r && <Figure n={n} l={l} r={r} />}
      {n && l && r && (
        <g className={present ? s.points : `${s.points} ${s.pointsFaint}`}>
          <line x1={l.x} y1={l.y} x2={r.x} y2={r.y} className={s.shoulderLine} />
          <circle cx={l.x} cy={l.y} r={2.4} className={s.point} />
          <circle cx={r.x} cy={r.y} r={2.4} className={s.point} />
          <circle cx={n.x} cy={n.y} r={2.8} className={s.point} />
        </g>
      )}
    </svg>
  );
}

type XY = { x: number; y: number };

/** Head and shoulders, drawn only from the three points. */
function Figure({ n, l, r }: { n: XY; l: XY; r: XY }) {
  const w = Math.hypot(l.x - r.x, l.y - r.y);
  const left = l.x < r.x ? l : r;
  const right = l.x < r.x ? r : l;
  const bottom = Math.max(l.y, r.y) + w * 1.2;
  const torso = [
    `M ${left.x - w * 0.12} ${bottom}`,
    `L ${left.x - w * 0.12} ${left.y + w * 0.12}`,
    `Q ${left.x - w * 0.1} ${left.y - w * 0.08} ${left.x + w * 0.12} ${left.y - w * 0.1}`,
    `L ${right.x - w * 0.12} ${right.y - w * 0.1}`,
    `Q ${right.x + w * 0.1} ${right.y - w * 0.08} ${right.x + w * 0.12} ${right.y + w * 0.12}`,
    `L ${right.x + w * 0.12} ${bottom}`,
    "Z",
  ].join(" ");
  return (
    <g className={s.figure}>
      <path d={torso} />
      <ellipse cx={n.x} cy={n.y - w * 0.05} rx={w * 0.3} ry={w * 0.37} />
    </g>
  );
}
