// One camera for the whole app: starts and stops it, runs every frame through the movement,
// expression and posture trackers, and keeps the values the screen shows. The recorded example
// goes through the very same trackers, so the screen and its tests do not need a camera.
//
// Nothing is stored here. A finished session is handed to whoever listens: onSession() gets
// the movement part alone (as before), onCameraSession() gets all three together.

import { createExpressionTracker, type ExpressionLive, type ExpressionSession, type FaceFrame, type ExpressionTracker } from "./expression";
import {
  createTracker,
  type LiveMovement,
  type MovementSession,
  type PoseFrame,
  type PosePoints,
  type Tracker,
} from "./movement";
import { CameraStartError, startPose, type Delegate, type PoseHandle, type StartFailure } from "./pose";
import { createPostureTracker, type PostureLive, type PostureSession, type PostureTracker } from "./posture";
import {
  EXAMPLE_ASPECT,
  EXAMPLE_CALIBRATION_MS,
  EXAMPLE_MS,
  exampleFaceFrames,
  exampleFrames,
} from "./synthetic";

export type CameraPhase = "off" | "starting" | "on" | "example" | StartFailure;

/** Everything one camera session measured. Behaviour only; never a feeling or a verdict. */
export interface CameraSession {
  /** Local calendar day the session started, "YYYY-MM-DD". */
  date: string;
  /** Minutes someone was in frame. */
  minutes: number;
  source: "computer" | "demo";
  /** Energy: movement and position changes (the same numbers as MovementSession). */
  movement: { movementMean: number; shiftsPerHour: number };
  /** Mood: how the face moved, or null with too little face time or no face model. */
  expression: ExpressionSession | null;
  /** Mood: posture against the first minutes, or null with too little time in frame. */
  posture: PostureSession | null;
}

export interface CameraView {
  phase: CameraPhase;
  /** How MediaPipe runs: on the graphics chip, or the processor when that is not available. */
  delegate: Delegate | null;
  /** Movement (kept under this name so earlier code keeps working). */
  live: LiveMovement;
  expression: ExpressionLive;
  posture: PostureLive;
  /** The face model is running (false if it could not load on this computer). */
  faceAvailable: boolean;
  /** The newest three points, only for drawing them. */
  points: PosePoints | null;
  aspect: number;
  /** The recorded example has played to its end (its last values stay on screen). */
  exampleDone: boolean;
  /** Minutes in frame the last time the camera was stopped, or null. */
  lastStopMinutes: number | null;
  /** Frames analysed since the camera or the example started (shows that the pipeline runs). */
  frames: number;
}

const IDLE_LIVE: LiveMovement = { present: false, raw: 0, smoothed: 0, display: 0, shifts: 0, minutesInFrame: 0 };
const IDLE_EXPRESSION: ExpressionLive = {
  present: false,
  smiling: false,
  smilingShare: 0,
  smiles: 0,
  animation: 0,
  animationDisplay: 0,
  browLoweredShare: 0,
  minutesWithFace: 0,
};
const IDLE_POSTURE: PostureLive = { state: "absent", relative: null, upright: null, usual: null, learningLeftSec: 0 };
const IDLE = { live: IDLE_LIVE, expression: IDLE_EXPRESSION, posture: IDLE_POSTURE, points: null };

const INITIAL: CameraView = {
  phase: "off",
  delegate: null,
  ...IDLE,
  faceAvailable: false,
  aspect: 4 / 3,
  exampleDone: false,
  lastStopMinutes: null,
  frames: 0,
};

let view: CameraView = INITIAL;
const viewListeners = new Set<() => void>();
const sessionListeners = new Set<(s: MovementSession) => void>();
const cameraSessionListeners = new Set<(s: CameraSession) => void>();

interface Trackers {
  movement: Tracker;
  expression: ExpressionTracker;
  posture: PostureTracker;
  source: "computer" | "demo";
}
let trackers: Trackers | null = null;
let pose: PoseHandle | null = null;
let startToken = 0;
let exampleTimer: ReturnType<typeof setInterval> | null = null;

function newTrackers(source: "computer" | "demo", calibrationMs?: number): Trackers {
  return {
    movement: createTracker({ source, startedAt: Date.now() }),
    expression: createExpressionTracker(),
    posture: createPostureTracker({ calibrationMs }),
    source,
  };
}

function set(next: Partial<CameraView>) {
  view = { ...view, ...next };
  viewListeners.forEach((l) => l());
}

/** Hands a finished session to the listeners. The expression and posture parts end with it. */
function emit(t: Trackers, movement: MovementSession | null) {
  const expression = t.expression.end();
  const posture = t.posture.end();
  if (!movement) return;
  sessionListeners.forEach((l) => l(movement));
  const combined: CameraSession = {
    date: movement.date,
    minutes: movement.minutes,
    source: movement.source,
    movement: { movementMean: movement.movementMean, shiftsPerHour: movement.shiftsPerHour },
    expression,
    posture,
  };
  cameraSessionListeners.forEach((l) => l(combined));
}

/** One frame through all three trackers. Returns false if there are no trackers. */
function push(frame: PoseFrame, face: FaceFrame | null): boolean {
  const t = trackers;
  if (!t) return false;
  for (const e of t.movement.push(frame)) if (e.type === "session") emit(t, e.session);
  if (face) t.expression.push(face);
  t.posture.push(frame);
  return true;
}

function liveValues(frame: PoseFrame) {
  const t = trackers!;
  return {
    live: t.movement.live(),
    expression: t.expression.live(),
    posture: t.posture.live(),
    points: frame.points,
    aspect: frame.aspect,
  };
}

function feed(frame: PoseFrame, face: FaceFrame | null) {
  if (!push(frame, face)) return;
  set({ ...liveValues(frame), frames: view.frames + 1 });
}

/** The values to show. Changes are announced through subscribe(). */
export function getView(): CameraView {
  return view;
}

/** What the server render shows: the camera is off. */
export function getServerView(): CameraView {
  return INITIAL;
}

export function subscribe(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

/**
 * Called with the movement part of each finished session: when the camera is stopped, or after
 * five minutes with no one in frame. Sessions under two minutes in frame are not reported.
 */
export function onSession(listener: (s: MovementSession) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/** Like onSession, with movement, expression and posture together. */
export function onCameraSession(listener: (s: CameraSession) => void): () => void {
  cameraSessionListeners.add(listener);
  return () => cameraSessionListeners.delete(listener);
}

/** Starts the camera into `video`. Never called by itself: only when the person asks. */
export async function startCamera(video: HTMLVideoElement): Promise<void> {
  if (view.phase === "starting" || view.phase === "on") return;
  stopExample();
  const token = ++startToken;
  set({ phase: "starting", delegate: null, ...IDLE, exampleDone: false, frames: 0 });
  trackers = newTrackers("computer");
  try {
    const handle = await startPose(video, {
      onFrame: feed,
      onEnded: () => {
        if (token === startToken && view.phase === "on") finishCamera();
      },
      isCancelled: () => token !== startToken,
    });
    if (token !== startToken) {
      handle.stop();
      return;
    }
    pose = handle;
    set({ phase: "on", delegate: handle.delegate, faceAvailable: handle.face });
  } catch (e) {
    if (token !== startToken) return;
    trackers = null;
    set({ phase: e instanceof CameraStartError ? e.reason : "failed", ...IDLE });
  }
}

function finishCamera() {
  pose?.stop();
  pose = null;
  const t = trackers;
  trackers = null;
  const minutes = t?.movement.live().minutesInFrame ?? null;
  set({ phase: "off", delegate: null, ...IDLE, lastStopMinutes: minutes });
  if (t) emit(t, t.movement.end());
}

/** Stops the camera, releases it, and reports the session if it was long enough. */
export function stopCamera(): void {
  startToken++; // abandons a start that is still under way
  if (view.phase === "starting") {
    trackers = null;
    set({ phase: "off", ...IDLE });
    return;
  }
  if (view.phase === "on") finishCamera();
}

/**
 * Plays the built-in made-up sequence through the same trackers. Marked "Example, not live"
 * on screen. Its posture usual is learnt from its first 8 seconds so it fits in 40 seconds.
 * The example is never reported as a session.
 */
export function playExample(): void {
  if (view.phase === "starting" || view.phase === "on") return;
  stopExample();
  const frames = exampleFrames();
  const faces = exampleFaceFrames();
  trackers = newTrackers("demo", EXAMPLE_CALIBRATION_MS);
  set({ phase: "example", ...IDLE, faceAvailable: true, aspect: EXAMPLE_ASPECT, exampleDone: false, frames: 0 });
  const t0 = Date.now();
  let i = 0;
  exampleTimer = setInterval(() => {
    const elapsed = Date.now() - t0;
    let last: PoseFrame | null = null;
    const from = i;
    while (i < frames.length && frames[i].t <= elapsed) {
      last = frames[i];
      push(frames[i], faces[i] ?? null);
      i++;
    }
    if (last && trackers) set({ ...liveValues(last), frames: view.frames + i - from });
    if (i >= frames.length || elapsed > EXAMPLE_MS + 1000) {
      clearInterval(exampleTimer!);
      exampleTimer = null;
      trackers = null;
      set({ exampleDone: true });
    }
  }, 1000 / 12);
}

/** Stops whatever runs and forgets a failed start, for when the screen is left. */
export function resetCamera(): void {
  stopCamera();
  stopExample();
  if (view.phase !== "off") set({ phase: "off", ...IDLE });
  set({ exampleDone: false, lastStopMinutes: null });
}

/** Stops the example and clears its values. */
export function stopExample(): void {
  if (exampleTimer) clearInterval(exampleTimer);
  exampleTimer = null;
  if (view.phase === "example") {
    trackers = null;
    set({ phase: "off", ...IDLE, exampleDone: false });
  }
}
