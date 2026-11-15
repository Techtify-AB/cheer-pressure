"use client";

// A thin adapter between this interface's screens and the phone app's bridge (lib/phone.ts, which
// owns the wire format and is the only place that talks to the phone). It adds only what the
// screens need on top: one permission answer per "What may I look at?" step, and the voice
// features of the daily hello, which the phone app may not have yet.
//
// Voice features (feature-detected; the hello falls back to one tap without them):
//   listen.start / listen.stop   {}               speech to text while the person holds to talk
//   converse                     { text, context } Cheri's reply to what they said
//   speak                        { text }          Cheri says it aloud
//   event "transcript"           { text, final }   the person's words while they talk
// They count as present only when the phone's getCapabilities answer says so
// ({ listen: true, converse: true, speak: true }). Outside the phone app nothing here does
// anything, and every call answers "not here".
//
// One exception, for the computer: when NEXT_PUBLIC_VOICE_URL is set (for example
// http://127.0.0.1:8766), the same four requests go to a voice service running on this
// computer instead (ml/talk in Filip's folder: microphone, speech to text, a local language
// model, speech out). It answers GET /capabilities and POST /listen/start, /listen/stop,
// /converse and /speak with the same arguments and answers. Without the setting nothing changes.

import { isPhoneApp } from "./platform";
import type { PermissionKind, PermissionState } from "./types";

export { isPhoneApp };

type Phone = typeof import("./phone");
const phone = (): Promise<Phone> => import("./phone");

/**
 * Asks the phone for one permission, the way lib/phone.ts asks. Sleep and steps also read them
 * at once. Outside the phone app: "not-here". The phone saying nothing clear: null.
 */
export async function askPhonePermission(kind: PermissionKind): Promise<PermissionState | null> {
  if (!isPhoneApp()) return "not-here";
  try {
    const p = await phone();
    const state = kind === "health" ? await p.connectPhoneHealth() : (await p.requestPermission(kind)).state;
    if (kind === "notifications" && state === "granted") void p.refreshNotificationPlan();
    if (state === "granted") return "granted";
    if (state === "denied") return "denied";
    if (state === "not-available") return "not-here";
    // "asked": Health never tells an app whether reading was allowed, only that it asked.
    return state === "asked" ? "yes" : null;
  } catch (e) {
    return (e as { code?: string })?.code === "not-available" ? "not-here" : null;
  }
}

/** Plans the daily hello's notifications again (after the time, how often or an answer changed). */
export async function replanHello(): Promise<void> {
  if (!isPhoneApp()) return;
  try {
    await (await phone()).refreshNotificationPlan();
  } catch {
    // Without permission for notifications the phone plans nothing; the hello is on Home.
  }
}

export interface VoiceFeatures {
  listen: boolean;
  converse: boolean;
  speak: boolean;
}

const NONE: VoiceFeatures = { listen: false, converse: false, speak: false };

/** The voice service on this computer, when one is set and this is not the phone app. */
const LOCAL_VOICE = (process.env.NEXT_PUBLIC_VOICE_URL ?? "").replace(/\/$/, "");
const localVoice = () => LOCAL_VOICE !== "" && !isPhoneApp();
/** How long the service gets to say what it can do; a service that is not running answers at once. */
const LOCAL_CAPABILITIES_MS = 1500;

async function local<T>(path: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  const res = await fetch(`${LOCAL_VOICE}${path}`, {
    method: args ? "POST" : "GET",
    headers: args ? { "Content-Type": "application/json" } : undefined,
    body: args ? JSON.stringify(args) : undefined,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  if (!res.ok) throw new Error(`voice service: ${res.status}`);
  return (await res.json()) as T;
}

const asFeatures = (c: unknown): VoiceFeatures => {
  const x = (c ?? {}) as Partial<Record<keyof VoiceFeatures, unknown>>;
  return { listen: x.listen === true, converse: x.converse === true, speak: x.speak === true };
};
let features: Promise<VoiceFeatures> | null = null;

/** Which voice features there are: the phone app's, or the voice service on this computer when one is set. Asked once. Otherwise none. */
export function voiceFeatures(): Promise<VoiceFeatures> {
  if (localVoice()) {
    return (features ??= local<unknown>("/capabilities", undefined, LOCAL_CAPABILITIES_MS)
      .then(asFeatures)
      .catch(() => NONE));
  }
  if (!isPhoneApp()) return Promise.resolve(NONE);
  return (features ??= phone()
    .then((p) => p.getCapabilities())
    .then(asFeatures)
    .catch(() => NONE));
}

/** Sends a request lib/phone.ts does not list yet. Only after voiceFeatures() said it exists. */
async function extra<T>(kind: string, args: Record<string, unknown>): Promise<T> {
  if (localVoice()) return local<T>(`/${kind.replace(".", "/")}`, args);
  const p = await phone();
  return p.request(kind as Parameters<Phone["request"]>[0], args as never) as Promise<T>;
}

export const listenStart = () => extra<unknown>("listen.start", {});
export const listenStop = () => extra<{ text?: string } | null>("listen.stop", {});
export const converse = (text: string, context: Record<string, unknown>) => extra<{ text?: string } | null>("converse", { text, context });
export const speakOnPhone = (text: string) => extra<unknown>("speak", { text });

/** The person's words while they talk, when the phone sends them. Returns a function that stops listening. */
export function onTranscript(handler: (t: { text: string; final: boolean }) => void): () => void {
  if (!isPhoneApp()) return () => {};
  let stop: (() => void) | null = null;
  let stopped = false;
  void phone().then((p) => {
    if (stopped) return;
    stop = p.onPhoneEvent("transcript" as Parameters<Phone["onPhoneEvent"]>[0], (d: unknown) => {
      const t = d as { text?: unknown; final?: unknown };
      if (typeof t?.text === "string") handler({ text: t.text, final: t.final === true });
    });
  });
  return () => {
    stopped = true;
    stop?.();
  };
}
