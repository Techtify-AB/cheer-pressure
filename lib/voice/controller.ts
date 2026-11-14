// One microphone for the whole app: starts and stops listening, runs every frame through the
// tone tracker, and keeps the values the screen shows. The recorded example goes through the
// same tracker without any microphone and without playing anything.
//
// Nothing is stored here. A finished session (numbers only) goes to onToneSession() listeners.

import { MicStartError, startMic, type MicFailure, type MicHandle } from "./mic";
import { VOICE_EXAMPLE_MS, voiceExampleFrames } from "./synthetic";
import { createToneTracker, type AudioFrame, type ToneLive, type ToneSession, type ToneTracker } from "./tone";

export type VoicePhase = "off" | "starting" | "on" | "example" | MicFailure;

export interface VoiceView {
  phase: VoicePhase;
  live: ToneLive;
  /** The recorded example has played to its end (its last values stay on screen). */
  exampleDone: boolean;
  /** Minutes listened the last time listening was stopped, or null. */
  lastStopMinutes: number | null;
  /** Frames analysed since listening or the example started (shows that the pipeline runs). */
  frames: number;
}

const IDLE_LIVE: ToneLive = {
  voiceNow: false,
  level: 0,
  listeningMinutes: 0,
  speakingMinutes: 0,
  segmentsPerMinute: null,
  pitchVariability: null,
  loudnessDb: null,
};

const INITIAL: VoiceView = { phase: "off", live: IDLE_LIVE, exampleDone: false, lastStopMinutes: null, frames: 0 };

let view: VoiceView = INITIAL;
const viewListeners = new Set<() => void>();
const sessionListeners = new Set<(s: ToneSession) => void>();
let tracker: ToneTracker | null = null;
let mic: MicHandle | null = null;
let startToken = 0;
let exampleTimer: ReturnType<typeof setInterval> | null = null;
// The screen does not need every frame: values are published at most this often.
const PUBLISH_MS = 100;
let lastPublish = 0;

function set(next: Partial<VoiceView>) {
  view = { ...view, ...next };
  viewListeners.forEach((l) => l());
}

function feed(frame: AudioFrame) {
  if (!tracker) return;
  tracker.push(frame);
  const now = Date.now();
  if (now - lastPublish >= PUBLISH_MS) {
    lastPublish = now;
    set({ live: tracker.live(), frames: view.frames + 1 });
  } else {
    view = { ...view, frames: view.frames + 1 };
  }
}

export function getVoiceView(): VoiceView {
  return view;
}

export function getServerVoiceView(): VoiceView {
  return INITIAL;
}

export function subscribeVoice(listener: () => void): () => void {
  viewListeners.add(listener);
  return () => viewListeners.delete(listener);
}

/** Called with each finished listening session (with at least half a minute of talking). */
export function onToneSession(listener: (s: ToneSession) => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/** Starts listening. Never called by itself: only when the person presses the button. */
export async function startListening(): Promise<void> {
  if (view.phase === "starting" || view.phase === "on") return;
  stopVoiceExample();
  const token = ++startToken;
  tracker = createToneTracker({ source: "computer", startedAt: Date.now() });
  set({ phase: "starting", live: IDLE_LIVE, exampleDone: false, frames: 0 });
  try {
    const handle = await startMic({
      onFrame: feed,
      onEnded: () => {
        if (token === startToken && view.phase === "on") finishListening();
      },
      isCancelled: () => token !== startToken,
    });
    if (token !== startToken) {
      handle.stop();
      return;
    }
    mic = handle;
    set({ phase: "on" });
  } catch (e) {
    if (token !== startToken) return;
    tracker = null;
    set({ phase: e instanceof MicStartError ? e.reason : "failed", live: IDLE_LIVE });
  }
}

function finishListening() {
  mic?.stop();
  mic = null;
  const t = tracker;
  tracker = null;
  const minutes = t?.live().listeningMinutes ?? null;
  set({ phase: "off", live: IDLE_LIVE, lastStopMinutes: minutes });
  const s = t?.end() ?? null;
  if (s) sessionListeners.forEach((l) => l(s));
}

/** Stops listening, releases the microphone, and reports the session if there was enough talking. */
export function stopListening(): void {
  startToken++;
  if (view.phase === "starting") {
    tracker = null;
    set({ phase: "off", live: IDLE_LIVE });
    return;
  }
  if (view.phase === "on") finishListening();
}

/** Plays the made-up recording through the same tracker. Nothing is played out loud. */
export function playVoiceExample(): void {
  if (view.phase === "starting" || view.phase === "on") return;
  stopVoiceExample();
  const frames = voiceExampleFrames();
  tracker = createToneTracker({ source: "demo", startedAt: Date.now() });
  set({ phase: "example", live: IDLE_LIVE, exampleDone: false, frames: 0 });
  const t0 = Date.now();
  let i = 0;
  exampleTimer = setInterval(() => {
    const elapsed = Date.now() - t0;
    while (i < frames.length && frames[i].t <= elapsed) feed(frames[i++]);
    if (tracker) set({ live: tracker.live() });
    if (i >= frames.length || elapsed > VOICE_EXAMPLE_MS + 1000) {
      clearInterval(exampleTimer!);
      exampleTimer = null;
      tracker = null; // the example is never a session
      set({ exampleDone: true });
    }
  }, 50);
}

export function stopVoiceExample(): void {
  if (exampleTimer) clearInterval(exampleTimer);
  exampleTimer = null;
  if (view.phase === "example") {
    tracker = null;
    set({ phase: "off", live: IDLE_LIVE, exampleDone: false });
  }
}

/** Stops whatever runs and forgets a failed start, for when the screen is left. */
export function resetVoice(): void {
  stopListening();
  stopVoiceExample();
  if (view.phase !== "off") set({ phase: "off", live: IDLE_LIVE });
  set({ exampleDone: false, lastStopMinutes: null });
}
