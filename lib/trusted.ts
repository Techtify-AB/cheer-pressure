"use client";

// The app's connection to the people the person trusts. Each person is their own pair on the
// messages service with their own client (lib/messages.ts createPeople), followed once at app
// level (components/TrustedBridge.tsx), and React hooks every screen reads the same snapshots
// through.
//
// What goes to the messages service: only the short texts in lib/events.ts (a request to talk
// or meet up, greetings, questions and replies) between the person and each one they trust,
// which the service deletes after 48 hours. Never measurements, answers, summaries or anything
// about health: those stay in lib/storage.ts, on this device.
//
// The mascot window reads the same local copies without polling: the main window's clients
// write them to localStorage, and the storage event tells the other window.

import { useSyncExternalStore } from "react";
import { pendingMessage } from "./contact";
import type { MessageEvent } from "./events";
import { createPeople, DEFAULT_STORAGE_KEY, PEOPLE_KEY, type MessagesClient, type People, type PersonView, type Snapshot } from "./messages";
import { isDesktop } from "./platform";

let registry: People | null = null;

/** Everyone the person trusts on this device, created on first use. */
export function people(): People {
  return (registry ??= createPeople({
    // The desktop app's main window keeps listening while it is hidden to the menu bar.
    // In a browser, polling pauses while the tab is hidden, as usual.
    isVisible: () => isDesktop() || typeof document === "undefined" || document.visibilityState !== "hidden",
  }));
}

let views: PersonView[] = [];
let primary: PersonView | null = null;
let primarySnap: Snapshot | null = null;
const listeners = new Set<() => void>();
const arrivals = new Set<(events: MessageEvent[], personId: string) => void>();
const following = new Map<string, () => void>();
let followingOn = false;

const live = (v: PersonView) => !!v.snapshot.pairing && v.snapshot.connection !== "ended";

/**
 * The one person home and the mascot show: whoever has the newest unanswered greeting, else the
 * first one connected, else the first on the list.
 */
function pickPrimary(vs: PersonView[]): PersonView | null {
  const pending = vs
    .map((v) => ({ v, p: pendingMessage(v.snapshot) }))
    .filter((x) => x.p)
    .sort((a, b) => Date.parse(b.p!.at) - Date.parse(a.p!.at));
  return pending[0]?.v ?? vs.find((v) => live(v) && v.snapshot.trustedName) ?? vs.find(live) ?? vs[0] ?? null;
}

function compute(id?: string, next?: Snapshot) {
  const fresh = people().views();
  views = fresh.map((v) => (id && v.id === id && next ? { ...v, snapshot: next } : v));
  primary = pickPrimary(views);
  primarySnap = primary?.snapshot ?? people().defaultClient().snapshot();
}

function refresh(id?: string, next?: Snapshot) {
  compute(id, next);
  listeners.forEach((l) => l());
}

/** Starts following everyone on the list. Safe to call again; picks up people added since. Main window only. */
export function follow() {
  followingOn = true;
  const list = people().list();
  for (const [id, stop] of following) {
    if (!list.some((p) => p.id === id)) {
      stop();
      following.delete(id);
    }
  }
  for (const p of list) {
    if (following.has(p.id)) continue;
    const c = people().client(p.id);
    if (!c?.pairing()) continue;
    following.set(
      p.id,
      c.subscribe((s) => {
        refresh(p.id, s);
        if (s.newEvents.length) arrivals.forEach((a) => a(s.newEvents, p.id));
      }),
    );
  }
  refresh();
}

export function unfollow() {
  followingOn = false;
  for (const stop of following.values()) stop();
  following.clear();
}

/** Messages that arrive while following (not the cached ones on load), with whose they are. */
export function onArrival(callback: (events: MessageEvent[], personId: string) => void): () => void {
  arrivals.add(callback);
  return () => {
    arrivals.delete(callback);
  };
}

/** Adds one person: a new pair on the messages service at `baseUrl`. Returns their id. */
export async function addPerson(baseUrl: string, label?: string): Promise<string> {
  const { id } = await people().add(baseUrl, label);
  if (followingOn) follow();
  else refresh();
  return id;
}

/**
 * Removes one person: deletes their pair on the service, then everything about it here. If the
 * service cannot be reached nothing is removed and the error is thrown, unless `evenOffline`.
 */
export async function removePerson(id: string, opts: { evenOffline?: boolean } = {}) {
  following.get(id)?.();
  following.delete(id);
  try {
    await people().remove(id, opts);
  } finally {
    if (followingOn) follow();
    else refresh();
  }
}

/** Ends every pair (Delete everything): on the service when it answers, on this device always. */
export async function removeEveryone() {
  for (const p of people().list()) await removePerson(p.id, { evenOffline: true }).catch(() => {});
  people().forgetAll();
  refresh();
}

/** One person's client, or null. */
export function clientOf(id: string): MessagesClient | null {
  return people().client(id);
}

/**
 * The client of the person home shows (see pickPrimary). Kept for screens that talk to "the"
 * trusted person: the greeting on home and the mascot.
 */
export function messagesClient(): MessagesClient {
  if (!primarySnap) compute();
  return (primary && people().client(primary.id)) || people().defaultClient();
}

/** The id of the person home shows, or null. */
export function primaryId(): string | null {
  if (!primarySnap) compute();
  return primary?.id ?? null;
}

/** Earlier name: invites one more person (it no longer replaces anyone). */
export const invite = (baseUrl: string) => addPerson(baseUrl);

/** Earlier name: ends every connection. */
export const disconnect = (opts: { evenOffline?: boolean } = {}) => (opts.evenOffline ? removeEveryone() : Promise.all(people().list().map((p) => removePerson(p.id))).then(() => {}));

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PEOPLE_KEY || e.key.startsWith(DEFAULT_STORAGE_KEY)) refresh();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function current(): Snapshot {
  if (!primarySnap) compute();
  return primarySnap!;
}

function currentViews(): PersonView[] {
  if (!primarySnap) compute();
  return views;
}

const NO_VIEWS: PersonView[] = [];

/** Calls back with everyone's conversations on every change. Returns a function that stops. */
export function watchPeople(cb: (vs: PersonView[]) => void): () => void {
  const l = () => cb(views);
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The conversation with the person home shows, as stored on this device. Null during server render. */
export function useTrusted(): Snapshot | null {
  return useSyncExternalStore(subscribe, current, () => null);
}

/** Everyone the person trusts, each with their conversation. Empty during server render. */
export function usePeople(): PersonView[] {
  return useSyncExternalStore(subscribe, currentViews, () => NO_VIEWS);
}

/** For tests and for "Delete everything": forget the cached snapshots. */
export function resetTrustedCache() {
  refresh();
}

// --- What to show for one person ------------------------------------------------------------

export type PersonState = "connected" | "invited" | "expired" | "ended" | "offline";

/** One honest state per person. */
export function personState(v: PersonView, now = Date.now()): PersonState {
  const s = v.snapshot;
  if (!s.pairing || s.connection === "ended") return "ended";
  if (!s.trustedName) {
    const exp = s.pairing.expiresAt ? Date.parse(s.pairing.expiresAt) : NaN;
    return Number.isFinite(exp) && exp < now ? "expired" : "invited";
  }
  return s.connection === "offline" ? "offline" : "connected";
}

export const PERSON_STATE_WORDS: Record<PersonState, string> = {
  connected: "Connected",
  invited: "Invite sent, not opened yet",
  expired: "The invite ran out",
  ended: "The connection ended",
  offline: "Connected, can't reach the service right now",
};

/** The name to show: their own, once they opened the invite; else the label typed here. */
export function personName(v: PersonView): string {
  return v.snapshot.trustedName ?? v.label ?? "Someone you invited";
}

/** People a request can go to: connected (they opened the invite), or invited and not expired. */
export function reachable(vs: PersonView[]): PersonView[] {
  return vs.filter((v) => {
    const st = personState(v);
    return st === "connected" || st === "offline" || st === "invited";
  });
}
