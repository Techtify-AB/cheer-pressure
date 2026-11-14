// Movement in front of the computer, from three body points only: the nose and both
// shoulders. Pure code with no browser APIs, so it runs the same in the browser and in
// `scripts/test-camera.mts`.
//
// What it measures, and nothing more: whether someone is in frame, how much they move
// (per second), and how often they settle into a new position. It never looks at the face,
// expression, mood or how someone sits. The product's hypothesis (not a proven marker) is
// that movement compared with the person's own usual is one more source next to typing
// rhythm and day rhythm.
//
// Distances are measured in shoulder widths, so sitting closer to or further from the
// camera changes the numbers as little as possible.

/** A point in normalised image coordinates (0 to 1 across, 0 to 1 down), as MediaPipe gives them. */
export interface Point {
  x: number;
  y: number;
  /** MediaPipe's own estimate that the point is visible, 0 to 1. Missing means visible. */
  visibility?: number;
}

/** The three points this feature uses. Nothing else from the pose is kept. */
export interface PosePoints {
  nose: Point;
  leftShoulder: Point;
  rightShoulder: Point;
}

/** One analysed frame. `points` is null when no one was found in it. */
export interface PoseFrame {
  /** Milliseconds on any steady clock (performance.now() in the browser). */
  t: number;
  /** Width divided by height of the picture, so x and y can be compared in the same unit. */
  aspect: number;
  points: PosePoints | null;
}

/** What the screen shows right now. */
export interface LiveMovement {
  /** Someone is in frame (or was, less than PRESENCE_GRACE_MS ago). */
  present: boolean;
  /** Movement in the last full second, in shoulder widths per second. 0 when no one is in frame. */
  raw: number;
  /** The same, smoothed over a few seconds. */
  smoothed: number;
  /** The smoothed value on a 0 to 100 scale, for the meter. */
  display: number;
  /** Position changes counted in this session. */
  shifts: number;
  /** Minutes in frame in this session. */
  minutesInFrame: number;
}

/** One session, summarised. This is the only thing meant to be kept. */
export interface MovementSession {
  /** Local calendar day the session started, "YYYY-MM-DD". */
  date: string;
  /** Minutes someone was in frame. */
  minutes: number;
  /** Average movement while in frame, in shoulder widths per second (the raw value, not the 0 to 100 meter). */
  movementMean: number;
  /** Position changes per hour in frame. */
  shiftsPerHour: number;
  source: "computer" | "demo";
}

// ---------------------------------------------------------------------------------------
// Thresholds. First guesses, tuned on synthetic sequences only; they need checking in
// front of a real camera before anything is concluded from them.
// ---------------------------------------------------------------------------------------

/** A point counts as seen when MediaPipe rates its visibility at least this. */
export const MIN_VISIBILITY = 0.5;
/** Shoulders closer together than this (in picture widths) are treated as no one in frame. */
export const MIN_SHOULDER_WIDTH = 0.04;
/** Someone stays "in frame" this long after the last frame they were seen in. */
export const PRESENCE_GRACE_MS = 2000;
/** Frames are averaged in buckets of this length before anything is compared (calms jitter). */
export const SAMPLE_MS = 250;
/** Movement smaller than this between two samples (in shoulder widths) is treated as jitter. */
export const JITTER_DEADBAND = 0.012;
/** Smoothing of the per-second value: weight of the newest second (about a 2 second memory). */
export const SMOOTHING = 0.5;
/** The meter shows 63 of 100 at this many shoulder widths per second, and approaches 100 above it. */
export const DISPLAY_SCALE = 0.2;
/** A position is held when every sample in the last HOLD_MS lies within this (in shoulder widths) of their mean. */
export const STILL_RADIUS = 0.08;
/** How long a new position must be held before it counts. */
export const HOLD_MS = 3000;
/** A held position is new when it differs from the last held one by more than this (shoulder widths). */
export const SHIFT_THRESHOLD = 0.3;
/** Weight of moving closer or further away (the log of the shoulder width ratio) in that difference. */
export const DEPTH_WEIGHT = 1.5;
/** After this long without anyone in frame the session ends. */
export const SESSION_GAP_MS = 5 * 60 * 1000;
/** Sessions shorter than this in frame are not summarised (too short to say anything). */
export const MIN_SESSION_MINUTES = 2;

// ---------------------------------------------------------------------------------------

/** Points in one unit on both axes: x is stretched by the picture's aspect ratio. */
interface Flat {
  nx: number;
  ny: number;
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

/** A sample: frames averaged over SAMPLE_MS, plus the position it describes. */
interface Sample {
  t: number;
  p: Flat;
  pos: Position;
}

/** A sitting position: where the shoulders are, how far away, and where the head is relative to them. */
export interface Position {
  cx: number;
  cy: number;
  /** Shoulder width, in the same unit as cx and cy. */
  w: number;
  /** Nose relative to the shoulder midpoint, in shoulder widths. */
  hx: number;
  hy: number;
}

/** True when the frame has someone in it that this feature can use. */
export function isSeen(frame: PoseFrame): boolean {
  const p = frame.points;
  if (!p) return false;
  for (const q of [p.nose, p.leftShoulder, p.rightShoulder]) {
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return false;
    if ((q.visibility ?? 1) < MIN_VISIBILITY) return false;
  }
  return shoulderWidth(flatten(p, frame.aspect)) >= MIN_SHOULDER_WIDTH;
}

function flatten(p: PosePoints, aspect: number): Flat {
  const a = aspect > 0 ? aspect : 1;
  return {
    nx: p.nose.x * a,
    ny: p.nose.y,
    lx: p.leftShoulder.x * a,
    ly: p.leftShoulder.y,
    rx: p.rightShoulder.x * a,
    ry: p.rightShoulder.y,
  };
}

function shoulderWidth(f: Flat): number {
  return Math.hypot(f.lx - f.rx, f.ly - f.ry);
}

export function positionOf(f: Flat): Position {
  const w = shoulderWidth(f);
  const cx = (f.lx + f.rx) / 2;
  const cy = (f.ly + f.ry) / 2;
  return { cx, cy, w, hx: (f.nx - cx) / w, hy: (f.ny - cy) / w };
}

/** How different two positions are, in shoulder widths. */
export function positionDistance(a: Position, b: Position): number {
  const w = (a.w + b.w) / 2;
  const dx = (a.cx - b.cx) / w;
  const dy = (a.cy - b.cy) / w;
  const dd = DEPTH_WEIGHT * Math.log(a.w / b.w);
  const dh = Math.hypot(a.hx - b.hx, a.hy - b.hy);
  return Math.hypot(dx, dy, dd, dh);
}

function meanPosition(list: Position[]): Position {
  const n = list.length;
  const m = { cx: 0, cy: 0, w: 0, hx: 0, hy: 0 };
  for (const p of list) {
    m.cx += p.cx;
    m.cy += p.cy;
    m.w += p.w;
    m.hx += p.hx;
    m.hy += p.hy;
  }
  return { cx: m.cx / n, cy: m.cy / n, w: m.w / n, hx: m.hx / n, hy: m.hy / n };
}

/** How far the three points moved between two samples, on average, in shoulder widths. */
export function stepBetween(a: Flat, b: Flat): number {
  const w = (shoulderWidth(a) + shoulderWidth(b)) / 2;
  const d =
    Math.hypot(a.nx - b.nx, a.ny - b.ny) + Math.hypot(a.lx - b.lx, a.ly - b.ly) + Math.hypot(a.rx - b.rx, a.ry - b.ry);
  return d / 3 / w;
}

/** The 0 to 100 value for the meter. */
export function toDisplay(widthsPerSecond: number): number {
  if (!(widthsPerSecond > 0)) return 0;
  return Math.round(100 * (1 - Math.exp(-widthsPerSecond / DISPLAY_SCALE)));
}

/** Local calendar day, "YYYY-MM-DD". */
export function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** What happened while a frame was taken in. */
export type TrackerEvent =
  | { type: "second"; raw: number; smoothed: number; display: number }
  | { type: "shift"; shifts: number }
  | { type: "session"; session: MovementSession };

export interface TrackerOptions {
  source: "computer" | "demo";
  /** Wall-clock time in ms when the tracker started (only used for the session's date). */
  startedAt: number;
}

export interface Tracker {
  /** Take in one frame. Frames must come in time order. */
  push(frame: PoseFrame): TrackerEvent[];
  /** The values to show right now. */
  live(): LiveMovement;
  /** The positions held so far (for tests and the details). */
  held(): Position | null;
  /** End the session (the camera stopped). Returns its summary, or null if it was too short. */
  end(): MovementSession | null;
}

/** The summary of one session, or null when there was too little time in frame. */
export function summarise(
  presentMs: number,
  rawSum: number,
  rawN: number,
  shifts: number,
  date: string,
  source: "computer" | "demo",
): MovementSession | null {
  const minutes = presentMs / 60000;
  if (minutes < MIN_SESSION_MINUTES) return null;
  return {
    date,
    minutes: Math.round(minutes * 10) / 10,
    movementMean: rawN ? Math.round((rawSum / rawN) * 1000) / 1000 : 0,
    shiftsPerHour: Math.round(((shifts * 60) / minutes) * 10) / 10,
    source,
  };
}

export function createTracker(opts: TrackerOptions): Tracker {
  const source = opts.source;
  // The clock of the frames, and the wall clock it started at, for the session's date.
  let firstT: number | null = null;
  let lastT: number | null = null;
  let lastSeenT: number | null = null;
  let present = false;

  // Averaging frames into samples.
  let bucket: { slot: number; n: number; sum: Flat } | null = null;
  let prevSample: Sample | null = null;
  let window: Sample[] = [];

  // Per second.
  let secondStart: number | null = null;
  let secondPath = 0;
  let raw = 0;
  let smoothed: number | null = null;

  // Positions.
  let held: Position | null = null;
  /** The next held position is a new reference, not a change (after someone came back). */
  let freshReference = true;
  let shifts = 0;

  // The session.
  let sessionStartT: number | null = null;
  let presentMs = 0;
  let rawSum = 0;
  let rawN = 0;

  const sessionDate = (t: number) => localDay(new Date(opts.startedAt + (t - (firstT ?? t))));

  function resetMotion() {
    bucket = null;
    prevSample = null;
    window = [];
    secondPath = 0;
    raw = 0;
    smoothed = null;
  }

  function resetSession() {
    sessionStartT = null;
    presentMs = 0;
    rawSum = 0;
    rawN = 0;
    shifts = 0;
    held = null;
    freshReference = true;
  }

  function closeSession(): MovementSession | null {
    const s =
      sessionStartT === null ? null : summarise(presentMs, rawSum, rawN, shifts, sessionDate(sessionStartT), source);
    resetSession();
    return s;
  }

  function takeSample(s: Sample, events: TrackerEvent[]) {
    if (prevSample) secondPath += Math.max(0, stepBetween(prevSample.p, s.p) - JITTER_DEADBAND);
    prevSample = s;
    window.push(s);
    // Keep exactly the samples that make up the last HOLD_MS.
    while (window.length > 1 && s.t - window[1].t >= HOLD_MS - SAMPLE_MS) window.shift();
    const span = s.t - window[0].t + SAMPLE_MS;
    if (span < HOLD_MS) return;
    const mean = meanPosition(window.map((x) => x.pos));
    for (const x of window) if (positionDistance(x.pos, mean) > STILL_RADIUS) return;
    // Held for HOLD_MS.
    if (held === null || freshReference) {
      held = mean;
      freshReference = false;
      return;
    }
    if (positionDistance(mean, held) > SHIFT_THRESHOLD) {
      held = mean;
      shifts += 1;
      events.push({ type: "shift", shifts });
    }
  }

  function closeSeconds(t: number, events: TrackerEvent[]) {
    if (secondStart === null) {
      secondStart = t;
      return;
    }
    // After a long gap, start counting again from now instead of emitting empty seconds.
    if (t - secondStart > 5000) {
      secondStart = t;
      secondPath = 0;
      return;
    }
    while (t - secondStart >= 1000) {
      secondStart += 1000;
      if (present) {
        raw = secondPath;
        smoothed = smoothed === null ? raw : smoothed + SMOOTHING * (raw - smoothed);
        rawSum += raw;
        rawN += 1;
      } else {
        raw = 0;
        smoothed = null;
      }
      secondPath = 0;
      events.push({ type: "second", raw, smoothed: smoothed ?? 0, display: toDisplay(smoothed ?? 0) });
    }
  }

  return {
    push(frame) {
      const events: TrackerEvent[] = [];
      const t = frame.t;
      if (lastT !== null && t < lastT) return events; // out of order: ignore
      if (firstT === null) firstT = t;
      const dt = lastT === null ? 0 : t - lastT;
      lastT = t;

      const seen = isSeen(frame);
      if (seen) lastSeenT = t;
      const wasPresent = present;
      present = lastSeenT !== null && t - lastSeenT <= PRESENCE_GRACE_MS;

      if (present) {
        if (sessionStartT === null) sessionStartT = t;
        if (wasPresent) presentMs += dt;
      } else if (wasPresent) {
        // Left the frame: nothing that happened before counts as movement after they return,
        // and the first position held after returning is a new reference, not a change.
        resetMotion();
        freshReference = true;
      }

      if (!present && lastSeenT !== null && sessionStartT !== null && t - lastSeenT >= SESSION_GAP_MS) {
        const s = closeSession();
        if (s) events.push({ type: "session", session: s });
      }

      if (seen && frame.points) {
        // Frames are averaged per SAMPLE_MS slot of the clock; a slot is closed by the first
        // frame of a later one, so samples come at a steady pace whatever the frame rate.
        const f = flatten(frame.points, frame.aspect);
        const slot = Math.floor(t / SAMPLE_MS);
        if (bucket && bucket.slot !== slot) {
          const b = bucket;
          const p: Flat = {
            nx: b.sum.nx / b.n,
            ny: b.sum.ny / b.n,
            lx: b.sum.lx / b.n,
            ly: b.sum.ly / b.n,
            rx: b.sum.rx / b.n,
            ry: b.sum.ry / b.n,
          };
          bucket = null;
          takeSample({ t: (b.slot + 1) * SAMPLE_MS, p, pos: positionOf(p) }, events);
        }
        if (!bucket) bucket = { slot, n: 0, sum: { nx: 0, ny: 0, lx: 0, ly: 0, rx: 0, ry: 0 } };
        const b = bucket;
        b.n += 1;
        b.sum.nx += f.nx;
        b.sum.ny += f.ny;
        b.sum.lx += f.lx;
        b.sum.ly += f.ly;
        b.sum.rx += f.rx;
        b.sum.ry += f.ry;
      }

      closeSeconds(t, events);
      return events;
    },

    live() {
      const s = present ? (smoothed ?? 0) : 0;
      return {
        present,
        raw: present ? raw : 0,
        smoothed: s,
        display: toDisplay(s),
        shifts,
        minutesInFrame: presentMs / 60000,
      };
    },

    held() {
      return held;
    },

    end() {
      const s = closeSession();
      resetMotion();
      return s;
    },
  };
}
