// Made-up landmark sequences: someone sitting in front of a computer, described as a few
// key moments and filled in at a steady frame rate with a little jitter. Used by the
// recorded example on the screen and by `scripts/test-camera.mts`. Pure, no browser APIs,
// and deterministic (a seeded random), so a sequence always gives the same numbers.

import type { PoseFrame, PosePoints } from "./movement";

/** A sitting position in picture terms: shoulder midpoint, shoulder width, and where the nose is relative to it. */
export interface Pose {
  /** Shoulder midpoint, 0 to 1 across and down the picture. */
  x: number;
  y: number;
  /** Shoulder width, as a share of the picture's width. */
  w: number;
  /** Nose relative to the shoulder midpoint, in shoulder widths (negative hy is above the shoulders). */
  hx: number;
  hy: number;
}

/** At time `t` (ms) the person is at `pose`; null means no one in frame from then on. */
export interface Key {
  t: number;
  pose: Pose | null;
}

export interface SynthOptions {
  fps?: number;
  aspect?: number;
  /** Jitter of each point, as a share of the picture's width (standard deviation). */
  jitter?: number;
  seed?: number;
}

export const SITTING: Pose = { x: 0.5, y: 0.72, w: 0.32, hx: 0, hy: -0.75 };

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const ease = (k: number) => k * k * (3 - 2 * k);

function poseAt(keys: Key[], t: number): Pose | null {
  if (t <= keys[0].t) return keys[0].pose;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (t >= b.t) continue;
    if (!a.pose || !b.pose) return a.pose;
    const k = ease((t - a.t) / (b.t - a.t));
    const mix = (p: number, q: number) => p + (q - p) * k;
    return {
      x: mix(a.pose.x, b.pose.x),
      y: mix(a.pose.y, b.pose.y),
      w: mix(a.pose.w, b.pose.w),
      hx: mix(a.pose.hx, b.pose.hx),
      hy: mix(a.pose.hy, b.pose.hy),
    };
  }
  return keys[keys.length - 1].pose;
}

/** The three points for a pose. x is in picture widths, y in picture heights. */
export function pointsFor(p: Pose, aspect: number, jitter = 0, rand: () => number = Math.random): PosePoints {
  const j = () => jitter * gauss(rand);
  const wy = p.w * aspect; // the shoulder width measured in picture heights
  return {
    nose: { x: p.x + p.hx * p.w + j(), y: p.y + p.hy * wy + j() * aspect, visibility: 0.99 },
    leftShoulder: { x: p.x + p.w / 2 + j(), y: p.y + j() * aspect, visibility: 0.98 },
    rightShoulder: { x: p.x - p.w / 2 + j(), y: p.y + j() * aspect, visibility: 0.98 },
  };
}

/** Frames from the first key to `endMs`. */
export function synthesise(keys: Key[], endMs: number, opts: SynthOptions = {}): PoseFrame[] {
  const fps = opts.fps ?? 12;
  const aspect = opts.aspect ?? 4 / 3;
  const jitter = opts.jitter ?? 0.002;
  const rand = mulberry32(opts.seed ?? 7);
  const frames: PoseFrame[] = [];
  const step = 1000 / fps;
  for (let t = keys[0].t; t <= endMs; t += step) {
    const p = poseAt(keys, t);
    frames.push({ t: Math.round(t), aspect, points: p ? pointsFor(p, aspect, jitter, rand) : null });
  }
  return frames;
}

/** A pose moved: by dx, dy (picture shares), leaning in by a factor on the width, the head by dhx, dhy. */
export function moved(p: Pose, m: { dx?: number; dy?: number; closer?: number; dhx?: number; dhy?: number }): Pose {
  return {
    x: p.x + (m.dx ?? 0),
    y: p.y + (m.dy ?? 0),
    w: p.w * (m.closer ?? 1),
    hx: p.hx + (m.dhx ?? 0),
    hy: p.hy + (m.dhy ?? 0),
  };
}

// ---------------------------------------------------------------------------------------
// The recorded example on the screen: about 40 seconds.
//   0 to 8 s     sitting still
//   8 to 9.6 s   a quick lean in towards the screen, and back (does not count)
//   9.6 to 16 s  still again
//   16 to 19 s   leans in and stays there (counts once it has been held for 3 s, near 22 s)
//   19 to 26 s   holds it
//   26 to 28 s   moves over to the side and sits back (counts once held for 3 s, near 31 s)
//   28 to 40 s   holds it
// ---------------------------------------------------------------------------------------

const LEANED = moved(SITTING, { dy: 0.04, closer: 1.25, dhy: 0.12 });
const SIDE = moved(SITTING, { dx: -0.14, dy: -0.01, closer: 0.95, dhx: 0.08 });

export const EXAMPLE_KEYS: Key[] = [
  { t: 0, pose: SITTING },
  { t: 8000, pose: SITTING },
  { t: 8800, pose: moved(SITTING, { dy: 0.03, closer: 1.25, dhy: 0.15 }) },
  { t: 9600, pose: SITTING },
  { t: 16000, pose: SITTING },
  { t: 19000, pose: LEANED },
  { t: 26000, pose: LEANED },
  { t: 28000, pose: SIDE },
  { t: 40000, pose: SIDE },
];
export const EXAMPLE_MS = 40000;
/** What the example should count: the brief lean does not, the two held positions do. */
export const EXAMPLE_SHIFTS = 2;
export const EXAMPLE_ASPECT = 4 / 3;

export function exampleFrames(): PoseFrame[] {
  return synthesise(EXAMPLE_KEYS, EXAMPLE_MS, { aspect: EXAMPLE_ASPECT, seed: 2026 });
}
