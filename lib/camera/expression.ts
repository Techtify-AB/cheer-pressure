// How the face moves, from MediaPipe Face Landmarker's blendshapes (52 numbers from 0 to 1
// per frame, each describing one part of the face moving: "mouthSmileLeft", "jawOpen" and so
// on). Pure code with no browser APIs.
//
// Only observable behaviour, never a feeling: the share of time the mouth corners are raised
// (smiling), how much the face moves (animation), and the share of time the brows are lowered.
// The product compares these with the person's own usual and words them as behaviour ("your
// face has moved less than your usual"). There is no emotion classifier and no emotion label.

/** Blendshape scores by MediaPipe's category name, or null when no face was found. */
export interface FaceFrame {
  t: number;
  shapes: Record<string, number> | null;
}

export interface ExpressionLive {
  /** A face is in view (or was, less than FACE_GRACE_MS ago). */
  present: boolean;
  /** The mouth corners are raised right now. */
  smiling: boolean;
  /** Share of the time with a face in view that the mouth corners were raised, 0 to 1. */
  smilingShare: number;
  /** Smiles counted (raised for at least SMILE_MIN_MS). */
  smiles: number;
  /** How much the face moved in the last second: the spread of each blendshape within it, jitter left out, summed. */
  animation: number;
  /** The same, smoothed, on a 0 to 100 scale for the bar. */
  animationDisplay: number;
  /** Share of the time with a face in view that the brows were lowered, 0 to 1. */
  browLoweredShare: number;
  /** Minutes with a face in view. */
  minutesWithFace: number;
}

/** One session's expression measures. Behaviour only. */
export interface ExpressionSession {
  minutesWithFace: number;
  smilingShare: number;
  smilesPerHour: number;
  /** Mean animation per second while a face was in view. */
  animationMean: number;
  /**
   * Share of time with lowered brows. Stable on made-up sequences with jitter; not yet checked
   * on real faces, so it is kept in the data but not shown on screen.
   */
  browLoweredShare: number;
}

// ---------------------------------------------------------------------------------------
// Thresholds: first guesses, tuned on made-up sequences only. They need checking in front
// of real faces (and different faces) before anything is concluded from them.
// ---------------------------------------------------------------------------------------

/** A face stays "in view" this long after the last frame it was found in. */
export const FACE_GRACE_MS = 1000;
/** Mouth corners count as raised from this score (mean of left and right)... */
export const SMILE_ON = 0.5;
/** ...and stop counting below this one (the gap keeps jitter from flickering). */
export const SMILE_OFF = 0.3;
/** A smile is counted when the corners stay raised at least this long. */
export const SMILE_MIN_MS = 400;
/** Brows count as lowered from this score (mean of left and right), and stop below BROW_OFF. */
export const BROW_ON = 0.45;
export const BROW_OFF = 0.3;
/** Spread (standard deviation within one second) of one blendshape below this is jitter. */
export const SHAPE_DEADBAND = 0.05;
/** A second needs at least this many frames with a face for an animation value. */
export const MIN_FRAMES_PER_SECOND = 4;
/** Weight of the newest second in the smoothed animation. */
export const ANIMATION_SMOOTHING = 0.5;
/** The bar shows 63 of 100 at this much animation per second. */
export const ANIMATION_SCALE = 0.15;
/** Less time than this with a face in view is not summarised. */
export const MIN_FACE_MINUTES = 1;

/**
 * The blendshapes that make up "animation": brows, cheeks, jaw, mouth and nose. Blinks and
 * gaze are left out, since they move all the time whatever the face does.
 */
export const ANIMATION_SHAPES = [
  "browDownLeft",
  "browDownRight",
  "browInnerUp",
  "browOuterUpLeft",
  "browOuterUpRight",
  "cheekPuff",
  "cheekSquintLeft",
  "cheekSquintRight",
  "jawForward",
  "jawLeft",
  "jawOpen",
  "jawRight",
  "mouthClose",
  "mouthDimpleLeft",
  "mouthDimpleRight",
  "mouthFrownLeft",
  "mouthFrownRight",
  "mouthFunnel",
  "mouthLeft",
  "mouthLowerDownLeft",
  "mouthLowerDownRight",
  "mouthPressLeft",
  "mouthPressRight",
  "mouthPucker",
  "mouthRight",
  "mouthRollLower",
  "mouthRollUpper",
  "mouthShrugLower",
  "mouthShrugUpper",
  "mouthSmileLeft",
  "mouthSmileRight",
  "mouthStretchLeft",
  "mouthStretchRight",
  "mouthUpperUpLeft",
  "mouthUpperUpRight",
  "noseSneerLeft",
  "noseSneerRight",
] as const;

const val = (s: Record<string, number>, k: string) => {
  const v = s[k];
  return Number.isFinite(v) ? v : 0;
};

export function smileScore(s: Record<string, number>): number {
  return (val(s, "mouthSmileLeft") + val(s, "mouthSmileRight")) / 2;
}

export function browDownScore(s: Record<string, number>): number {
  return (val(s, "browDownLeft") + val(s, "browDownRight")) / 2;
}

/**
 * How much the face varied over a run of frames (one second): for each blendshape its
 * standard deviation, less SHAPE_DEADBAND for jitter, summed over ANIMATION_SHAPES.
 */
export function shapeSpread(frames: number[][]): number {
  const n = frames.length;
  if (n < 2) return 0;
  let sum = 0;
  for (let k = 0; k < frames[0].length; k++) {
    let m = 0;
    for (const f of frames) m += f[k];
    m /= n;
    let v = 0;
    for (const f of frames) v += (f[k] - m) ** 2;
    sum += Math.max(0, Math.sqrt(v / (n - 1)) - SHAPE_DEADBAND);
  }
  return sum;
}

export function toAnimationDisplay(v: number): number {
  if (!(v > 0)) return 0;
  return Math.round(100 * (1 - Math.exp(-v / ANIMATION_SCALE)));
}

export interface ExpressionTracker {
  push(frame: FaceFrame): void;
  live(): ExpressionLive;
  /** Ends the session: its summary, or null with less than MIN_FACE_MINUTES of face. */
  end(): ExpressionSession | null;
}

export function summariseExpression(
  faceMs: number,
  smilingMs: number,
  smiles: number,
  animSum: number,
  animN: number,
  browMs: number,
): ExpressionSession | null {
  const minutes = faceMs / 60000;
  if (minutes < MIN_FACE_MINUTES) return null;
  const r = (v: number, d = 1000) => Math.round(v * d) / d;
  return {
    minutesWithFace: r(minutes, 10),
    smilingShare: r(smilingMs / faceMs),
    smilesPerHour: r((smiles * 60) / minutes, 10),
    animationMean: r(animN ? animSum / animN : 0),
    browLoweredShare: r(browMs / faceMs),
  };
}

export function createExpressionTracker(): ExpressionTracker {
  let lastT: number | null = null;
  let lastSeenT: number | null = null;
  let present = false;

  let smiling = false;
  let smileStart = 0;
  let smileCounted = false;
  let browLowered = false;

  let second: number[][] = [];
  let secondStart: number | null = null;
  let animation = 0;
  let smoothed: number | null = null;

  let faceMs = 0;
  let smilingMs = 0;
  let browMs = 0;
  let smiles = 0;
  let animSum = 0;
  let animN = 0;

  function reset() {
    lastSeenT = null;
    present = false;
    smiling = false;
    smileCounted = false;
    browLowered = false;
    second = [];
    animation = 0;
    smoothed = null;
    faceMs = smilingMs = browMs = smiles = animSum = animN = 0;
  }

  return {
    push(frame) {
      const t = frame.t;
      if (lastT !== null && t < lastT) return;
      const dt = lastT === null ? 0 : t - lastT;
      lastT = t;
      const s = frame.shapes;
      if (s) lastSeenT = t;
      const wasPresent = present;
      present = lastSeenT !== null && t - lastSeenT <= FACE_GRACE_MS;

      if (present && wasPresent) {
        faceMs += dt;
        if (smiling) smilingMs += dt;
        if (browLowered) browMs += dt;
      }
      if (!present && wasPresent) {
        smiling = false;
        browLowered = false;
        second = [];
        smoothed = null;
        animation = 0;
      }

      if (s) {
        const sm = smileScore(s);
        if (!smiling && sm >= SMILE_ON) {
          smiling = true;
          smileStart = t;
          smileCounted = false;
        } else if (smiling && sm < SMILE_OFF) {
          smiling = false;
        }
        if (smiling && !smileCounted && t - smileStart >= SMILE_MIN_MS) {
          smiles += 1;
          smileCounted = true;
        }
        const bd = browDownScore(s);
        if (!browLowered && bd >= BROW_ON) browLowered = true;
        else if (browLowered && bd < BROW_OFF) browLowered = false;

        second.push(ANIMATION_SHAPES.map((k) => val(s, k)));
      }

      if (secondStart === null || t - secondStart > 5000) {
        secondStart = t;
        second = [];
      }
      while (t - secondStart >= 1000) {
        secondStart += 1000;
        if (present && second.length >= MIN_FRAMES_PER_SECOND) {
          animation = shapeSpread(second);
          smoothed = smoothed === null ? animation : smoothed + ANIMATION_SMOOTHING * (animation - smoothed);
          animSum += animation;
          animN += 1;
        } else if (!present) {
          animation = 0;
          smoothed = null;
        }
        second = [];
      }
    },

    live() {
      return {
        present,
        smiling: present && smiling,
        smilingShare: faceMs ? smilingMs / faceMs : 0,
        smiles,
        animation: present ? animation : 0,
        animationDisplay: present ? toAnimationDisplay(smoothed ?? 0) : 0,
        browLoweredShare: faceMs ? browMs / faceMs : 0,
        minutesWithFace: faceMs / 60000,
      };
    },

    end() {
      const out = summariseExpression(faceMs, smilingMs, smiles, animSum, animN, browMs);
      reset();
      return out;
    },
  };
}
