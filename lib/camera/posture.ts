// Posture, from the same three pose points as movement: how high the head sits above the
// shoulder line, in shoulder widths, compared with how the person sat in their own first
// minutes. Pure code with no browser APIs.
//
// Only behaviour, never a verdict: "more upright" or "more slumped than your usual", and a
// number where 100 is the usual. Nothing is said about whether a posture is good or bad.
//
// Not used: MediaPipe's depth (z) of the points. From a single webcam it is too noisy to tell
// a head leaning forward from one leaning in, so head-forward lean is left out for now.
// Not used either: the ears, which hair, headphones and turning the head often hide; the nose
// is found far more reliably.

import { isSeen, type PoseFrame } from "./movement";

export type PostureState = "learning" | "usual" | "upright" | "slumped" | "absent";

export interface PostureLive {
  state: PostureState;
  /** The current reading where the usual is 100, or null while learning or with no one in frame. */
  relative: number | null;
  /** Head height above the shoulder line, in shoulder widths (median of the last POSTURE_WINDOW_MS). */
  upright: number | null;
  /** The usual from the first minutes, or null while still learning. */
  usual: number | null;
  /** Seconds of calibration left (0 when done). */
  learningLeftSec: number;
}

/** One session's posture measures. */
export interface PostureSession {
  minutes: number;
  /** Mean head height above the shoulder line, in shoulder widths. Comparable across sessions. */
  uprightMean: number;
  /** The usual measured in this session's first minutes. */
  usual: number | null;
  /** After the first minutes: share of the time more slumped than the usual, 0 to 1. */
  slumpedShare: number;
  /** After the first minutes: share of the time more upright than the usual, 0 to 1. */
  uprightShare: number;
}

// ---------------------------------------------------------------------------------------
// Thresholds: first guesses on made-up sequences; they need checking with real people.
// ---------------------------------------------------------------------------------------

/** The usual is learnt from this much time in frame at the start. */
export const CALIBRATION_MS = 2 * 60 * 1000;
/** The reading is the median of this much time, so a brief lean does not move it. */
export const POSTURE_WINDOW_MS = 10000;
/** At least this share of the window must have someone in it before there is a reading. */
export const POSTURE_MIN_FILL = 0.5;
/** Within this many points of 100, the posture is "about your usual". */
export const POSTURE_BAND = 6;
/** Less time in frame than this is not summarised. */
export const MIN_POSTURE_MINUTES = 1;

/** Head height above the shoulder line, in shoulder widths, or null if no one is in the frame. */
export function uprightOf(frame: PoseFrame): number | null {
  if (!isSeen(frame) || !frame.points) return null;
  const a = frame.aspect > 0 ? frame.aspect : 1;
  const { nose, leftShoulder: l, rightShoulder: r } = frame.points;
  const lx = l.x * a;
  const rx = r.x * a;
  const w = Math.hypot(lx - rx, l.y - r.y);
  // Distance from the nose to the shoulder line (positive when the nose is above it).
  const mx = (lx + rx) / 2;
  const my = (l.y + r.y) / 2;
  // The line's normal pointing up in the picture.
  let nx = -(l.y - r.y) / w;
  let ny = (lx - rx) / w;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return ((nose.x * a - mx) * nx + (nose.y - my) * ny) / w;
}

function median(v: number[]): number {
  const s = [...v].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function postureState(relative: number): PostureState {
  if (relative >= 100 + POSTURE_BAND) return "upright";
  if (relative <= 100 - POSTURE_BAND) return "slumped";
  return "usual";
}

export interface PostureTracker {
  push(frame: PoseFrame): void;
  live(): PostureLive;
  end(): PostureSession | null;
}

export function createPostureTracker(opts: { calibrationMs?: number } = {}): PostureTracker {
  const calibrationMs = opts.calibrationMs ?? CALIBRATION_MS;
  let lastT: number | null = null;
  let calib: number[] = [];
  let calibMs = 0;
  let usual: number | null = null;
  let window: { t: number; u: number }[] = [];
  let reading: number | null = null;
  let present = false;

  let presentMs = 0;
  let uSum = 0;
  let uN = 0;
  let afterMs = 0;
  let slumpedMs = 0;
  let uprightMs = 0;

  const relative = () => (usual !== null && reading !== null ? Math.round((reading / usual) * 100) : null);

  return {
    push(frame) {
      const t = frame.t;
      if (lastT !== null && t < lastT) return;
      const dt = lastT === null ? 0 : Math.min(t - lastT, 1000);
      lastT = t;
      const u = uprightOf(frame);
      present = u !== null;
      while (window.length && t - window[0].t > POSTURE_WINDOW_MS) window.shift();
      if (u === null) {
        if (!window.length) reading = null;
        return;
      }
      window.push({ t, u });
      presentMs += dt;
      uSum += u;
      uN += 1;
      if (usual === null) {
        calib.push(u);
        calibMs += dt;
        if (calibMs >= calibrationMs) {
          usual = median(calib);
          calib = [];
        }
      }
      // A reading needs the window to be at least half full of frames with someone in them.
      const span = window.length > 1 ? window[window.length - 1].t - window[0].t : 0;
      reading = span >= POSTURE_WINDOW_MS * POSTURE_MIN_FILL || usual === null ? median(window.map((x) => x.u)) : reading;
      const rel = relative();
      if (rel !== null) {
        afterMs += dt;
        const st = postureState(rel);
        if (st === "slumped") slumpedMs += dt;
        if (st === "upright") uprightMs += dt;
      }
    },

    live() {
      const rel = present ? relative() : null;
      let state: PostureState;
      if (!present) state = "absent";
      else if (usual === null) state = "learning";
      else state = rel === null ? "usual" : postureState(rel);
      return {
        state,
        relative: rel,
        upright: present ? reading : null,
        usual,
        learningLeftSec: usual === null ? Math.max(0, Math.ceil((calibrationMs - calibMs) / 1000)) : 0,
      };
    },

    end() {
      const minutes = presentMs / 60000;
      const r = (v: number, d = 1000) => Math.round(v * d) / d;
      const out =
        minutes < MIN_POSTURE_MINUTES
          ? null
          : {
              minutes: r(minutes, 10),
              uprightMean: r(uN ? uSum / uN : 0),
              usual: usual === null ? null : r(usual),
              slumpedShare: afterMs ? r(slumpedMs / afterMs) : 0,
              uprightShare: afterMs ? r(uprightMs / afterMs) : 0,
            };
      calib = [];
      calibMs = 0;
      usual = null;
      window = [];
      reading = null;
      presentMs = uSum = uN = afterMs = slumpedMs = uprightMs = 0;
      return out;
    },
  };
}
