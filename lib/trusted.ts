"use client";

// The app's one connection to someone the person trusts: one messages client (lib/messages.ts)
// for the whole app, followed once at app level while a pair exists (components/TrustedBridge.tsx),
// and a React hook every screen reads the same snapshot through.
//
// What goes to the messages service: only the short texts in lib/events.ts (a request to get
// in touch, greetings, questions and replies) between the person and the one they trust, which
// the service deletes after 48 hours. Never measurements, answers, summaries or anything about
// health: those stay in lib/storage.ts, on this device.
//
// The mascot window reads the same local copy without polling: the main window's client writes
// it to localStorage, and the storage event tells the other window.

import { useSyncExternalStore } from "react";
import type { MessageEvent } from "./events";
import { createMessagesClient, DEFAULT_STORAGE_KEY, type MessagesClient, type Snapshot } from "./messages";
import { isDesktop } from "./platform";

let client: MessagesClient | null = null;

/** The app's messages client, created on first use. */
export function messagesClient(): MessagesClient {
  return (client ??= createMessagesClient({
    // The desktop app's main window keeps listening while it is hidden to the menu bar.
    // In a browser, polling pauses while the tab is hidden, as usual.
    isVisible: () => isDesktop() || typeof document === "undefined" || document.visibilityState !== "hidden",
  }));
}

let snap: Snapshot | null = null;
let stopFollowing: (() => void) | null = null;
const listeners = new Set<() => void>();
const arrivals = new Set<(events: MessageEvent[]) => void>();

function refresh(next?: Snapshot) {
  snap = next ?? messagesClient().snapshot();
  listeners.forEach((l) => l());
}

/** Starts following the pair, if one exists. Safe to call again. Main window only. */
export function follow() {
  const c = messagesClient();
  if (stopFollowing) return;
  if (!c.pairing()) {
    refresh();
    return;
  }
  stopFollowing = c.subscribe((s) => {
    refresh(s);
    if (s.newEvents.length) arrivals.forEach((a) => a(s.newEvents));
  });
}

export function unfollow() {
  stopFollowing?.();
  stopFollowing = null;
}

/** Messages that arrive while following (not the cached ones on load). */
export function onArrival(callback: (events: MessageEvent[]) => void): () => void {
  arrivals.add(callback);
  return () => {
    arrivals.delete(callback);
  };
}

/** Creates the pair on the messages service at `baseUrl`, then follows it. */
export async function invite(baseUrl: string) {
  unfollow();
  await messagesClient().createPair(baseUrl);
  follow();
  refresh();
}

/**
 * Ends the pair: deletes it on the service, then everything about it on this device. If the
 * service cannot be reached, nothing is removed and the error is thrown, unless `evenOffline`:
 * then it is removed from this device anyway (the service deletes it by itself within 48 hours).
 */
export async function disconnect({ evenOffline = false }: { evenOffline?: boolean } = {}) {
  const c = messagesClient();
  try {
    await c.deletePair();
  } catch (e) {
    if (!evenOffline) throw e;
    c.forget();
  }
  unfollow();
  refresh();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === DEFAULT_STORAGE_KEY || e.key === null) refresh();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function current(): Snapshot {
  return (snap ??= messagesClient().snapshot());
}

/** The conversation with the trusted person as stored on this device. Null during server render. */
export function useTrusted(): Snapshot | null {
  return useSyncExternalStore(subscribe, current, () => null);
}

/** For tests and for "Delete everything": forget the cached snapshot. */
export function resetTrustedCache() {
  refresh();
}
