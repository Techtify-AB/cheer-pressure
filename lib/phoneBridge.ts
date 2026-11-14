"use client";

// A tiny adapter to the phone app's bridge, of this interface's own. The phone app (mobile/,
// built separately) shows this same interface in a WebView. Its web side, lib/phone.ts, may or
// may not be in this build, so nothing here imports it: the adapter feature-detects
// window.ReactNativeWebView and speaks the bridge's documented wire format itself.
//
//   web -> native  window.ReactNativeWebView.postMessage(JSON.stringify({ cheerPressure: 1, id, kind, args }))
//   native -> web  window.__cheerPressurePhone.receive({ cheerPressure, id, ok, result | error })
//                  window.__cheerPressurePhone.receive({ cheerPressure, event, data })
//
// Answers to this adapter's own requests (ids starting "ui-") are taken here; everything else is
// handed on to whichever receiver was there before (lib/phone.ts), so both can live side by side.
//
// Requests this interface sends:
//   requestPermission    { kind: "health" | "location" | "notifications" | "camera-microphone" }
//   scheduleNotifications { plan: { notices: [...] } }   the daily hello, sent whenever Settings change
//   listen.start / listen.stop   {}                      speech to text while the person holds to talk
//   converse             { text, context }               Cheri's reply to what they said
//   speak                { text }                        Cheri says it aloud
// Events it listens for:
//   transcript           { text, final }                 the person's words while they talk
//
// Outside the phone app every request rejects at once with "not-phone", and callers fall back to
// the browser or desktop equivalent.

export const BRIDGE_VERSION = 1;

interface PhoneWindow {
  ReactNativeWebView?: { postMessage(message: string): void };
  __cheerPressurePhone?: { queue?: unknown[]; receive(message: unknown): void };
}

const TIMEOUTS: Record<string, number> = {
  requestPermission: 180_000,
  scheduleNotifications: 10_000,
  "listen.start": 8_000,
  "listen.stop": 8_000,
  converse: 20_000,
  speak: 20_000,
};

export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function win(): PhoneWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as PhoneWindow);
}

/** True inside the phone app's WebView. */
export function isPhoneApp(): boolean {
  const w = win();
  return !!w?.ReactNativeWebView && typeof w.ReactNativeWebView.postMessage === "function";
}

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const handlers = new Map<string, Set<(data: unknown) => void>>();
let counter = 0;
let hooked: { receive(message: unknown): void } | null = null;

function parse(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Puts this adapter in front of the current receiver, once, and again if it was replaced. */
function hook() {
  const w = win();
  if (!w) return;
  if (hooked && w.__cheerPressurePhone === hooked) return;
  const before = w.__cheerPressurePhone;
  const mine = {
    queue: before?.queue,
    receive(raw: unknown) {
      const m = parse(raw);
      if (m && typeof m.id === "string" && m.id.startsWith("ui-")) {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.ok) p.resolve(m.result);
        else {
          const err = (m.error ?? {}) as { code?: string; message?: string };
          p.reject(new BridgeError(err.code ?? "failed", err.message ?? "The phone could not do that."));
        }
        return;
      }
      if (m && typeof m.event === "string") for (const h of handlers.get(m.event) ?? []) h(m.data);
      if (before && typeof before.receive === "function") before.receive(raw);
      else if (before) (before.queue ??= []).push(raw);
    },
  };
  w.__cheerPressurePhone = mine;
  hooked = mine;
}

/** One request to the phone app. Rejects with "not-phone" outside it, "timeout" without an answer. */
export function phoneRequest<T = unknown>(kind: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
  if (!isPhoneApp()) return Promise.reject(new BridgeError("not-phone", "Only in the phone app."));
  hook();
  const id = `ui-${Date.now().toString(36)}-${(counter++).toString(36)}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new BridgeError("timeout", `The phone did not answer ${kind} in time.`));
    }, timeoutMs ?? TIMEOUTS[kind] ?? 10_000);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    try {
      win()!.ReactNativeWebView!.postMessage(JSON.stringify({ cheerPressure: BRIDGE_VERSION, id, kind, args }));
    } catch {
      clearTimeout(timer);
      pending.delete(id);
      reject(new BridgeError("failed", "Could not reach the phone."));
    }
  });
}

/** Listens to an event from the phone app. Returns a function that stops listening. */
export function onPhone(event: string, handler: (data: unknown) => void): () => void {
  hook();
  const set = handlers.get(event) ?? new Set();
  set.add(handler);
  handlers.set(event, set);
  return () => set.delete(handler);
}

export type PermissionAnswer = "granted" | "denied" | "unknown" | "not-here";

/** Asks the phone for one permission. Outside the phone app: "not-here". */
export async function requestPermission(kind: "health" | "location" | "notifications" | "camera-microphone"): Promise<PermissionAnswer> {
  if (!isPhoneApp()) return "not-here";
  try {
    const r = await phoneRequest<{ state?: string }>("requestPermission", { kind });
    if (r?.state === "granted") return "granted";
    if (r?.state === "denied") return "denied";
    if (r?.state === "not-available") return "not-here";
    return "unknown"; // "asked": Health never says whether reading was allowed
  } catch (e) {
    return e instanceof BridgeError && e.code === "not-available" ? "not-here" : "unknown";
  }
}
