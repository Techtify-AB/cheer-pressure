// One camera for the whole app: starts and stops it, runs every frame through the movement
// tracker, and keeps the values the screen shows. The recorded example goes through the very
// same tracker, so the screen and its tests do not need a camera.
//
// Nothing is stored here. A finished session is handed to whoever listens with onSession().

import {
  createTracker,
  type LiveMovement,
  type MovementSession,
  type PoseFrame,
  type PosePoints,
  type Tracker,
} from "./movement";
import { CameraStartError, startPose, type Delegate, type PoseHandle, type StartFailure } from "./pose";
import { EXAMPLE_ASPECT, EXAMPLE_MS, exampleFrames } from "./synthetic";

export type CameraPhase = "off" | "starting" | "on" | "example" | StartFailure;

export interface CameraView {
  phase: CameraPhase;
  /** How MediaPipe runs: on the graphics chip, or the processor when that is not available. */
  delegate: Delegate | null;
  live: LiveMovement;
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

const INITIAL: CameraView = {
  phase: "off",
  delegate: null,
  live: IDLE_LIVE,
  points: null,
  aspect: 4 / 3,
  exampleDone: false,
  lastStopMinutes: null,
  frames: 0,
};

let view: CameraView = INITIAL;
const viewListeners = new Set<() => void>();
const sessionListeners = new Set<(s: MovementSession) => void>();

let tracker: Tracker | null = null;
let pose: PoseHandle | null = null;
let startToken = 0;
let exampleTimer: ReturnType<typeof setInterval> | null = null;

function set(next: Partial<CameraView>) {
  view = { ...view, ...next };
  viewListeners.forEach((l) => l());
}

function emitSession(s: MovementSession | null) {
  if (!s) return;
  sessionListeners.forEach((l) => l(s));
}

function feed(frame: PoseFrame) {
  if (!tracker) return;
  for (const e of tracker.push(frame)) if (e.type === "session") emitSession(e.session);
  set({ live: tracker.live(), points: frame.points, aspect: frame.aspect, frames: view.frames + 1 });
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
 * Called with each finished session: when the camera is stopped, or after five minutes with
 * no one in frame. Sessions under two minutes in frame are not reported.
 */
export function onSession(listener: (s: MovementSession) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/** Starts the camera into `video`. Never called by itself: only when the person asks. */
export async function startCamera(video: HTMLVideoElement): Promise<void> {
  if (view.phase === "starting" || view.phase === "on") return;
  stopExample();
  const token = ++startToken;
  set({ phase: "starting", delegate: null, live: IDLE_LIVE, points: null, exampleDone: false, frames: 0 });
  tracker = createTracker({ source: "computer", startedAt: Date.now() });
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
    set({ phase: "on", delegate: handle.delegate });
  } catch (e) {
    if (token !== startToken) return;
    tracker = null;
    set({ phase: e instanceof CameraStartError ? e.reason : "failed", live: IDLE_LIVE, points: null });
  }
}

function finishCamera() {
  pose?.stop();
  pose = null;
  const minutes = tracker?.live().minutesInFrame ?? null;
  const s = tracker?.end() ?? null;
  tracker = null;
  set({ phase: "off", delegate: null, live: IDLE_LIVE, points: null, lastStopMinutes: minutes });
  emitSession(s);
}

/** Stops the camera, releases it, and reports the session if it was long enough. */
export function stopCamera(): void {
  startToken++; // abandons a start that is still under way
  if (view.phase === "starting") {
    tracker = null;
    set({ phase: "off", live: IDLE_LIVE, points: null });
    return;
  }
  if (view.phase === "on") finishCamera();
}

/** Plays the built-in made-up sequence through the same tracker. Marked "Example, not live" on screen. */
export function playExample(): void {
  if (view.phase === "starting" || view.phase === "on") return;
  stopExample();
  const frames = exampleFrames();
  tracker = createTracker({ source: "demo", startedAt: Date.now() });
  set({ phase: "example", live: IDLE_LIVE, points: null, aspect: EXAMPLE_ASPECT, exampleDone: false, frames: 0 });
  const t0 = Date.now();
  let i = 0;
  exampleTimer = setInterval(() => {
    const elapsed = Date.now() - t0;
    let last: PoseFrame | null = null;
    const from = i;
    while (i < frames.length && frames[i].t <= elapsed) {
      last = frames[i++];
      for (const e of tracker!.push(last)) if (e.type === "session") emitSession(e.session);
    }
    if (last) set({ live: tracker!.live(), points: last.points, aspect: last.aspect, frames: view.frames + i - from });
    if (i >= frames.length || elapsed > EXAMPLE_MS + 1000) {
      clearInterval(exampleTimer!);
      exampleTimer = null;
      tracker = null; // the example is never a session
      set({ exampleDone: true });
    }
  }, 1000 / 12);
}

/** Stops whatever runs and forgets a failed start, for when the screen is left. */
export function resetCamera(): void {
  stopCamera();
  stopExample();
  if (view.phase !== "off") set({ phase: "off", live: IDLE_LIVE, points: null });
  set({ exampleDone: false, lastStopMinutes: null });
}

/** Stops the example and clears its values. */
export function stopExample(): void {
  if (exampleTimer) clearInterval(exampleTimer);
  exampleTimer = null;
  if (view.phase === "example") {
    tracker = null;
    set({ phase: "off", live: IDLE_LIVE, points: null, exampleDone: false });
  }
}
