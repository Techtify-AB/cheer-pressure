"use client";

// The only place that touches browser storage. Everything is kept in localStorage
// under one key, on this device only. No account, no server, no sync. (Messages with someone
// the person trusts are kept apart by lib/messages.ts and pass through the messages service.)
//
// To move to IndexedDB later, keep this module's exported functions and swap the
// read/write helpers below.

import { useSyncExternalStore } from "react";
import type {
  ActivityDay,
  AppData,
  DailyAnswer,
  StoredMovementSession,
  ContactDay,
  DailyEntry,
  LadderState,
  Profile,
  PromptedCheckIn,
  ReactionResult,
  Settings,
  TypingDay,
  TypingSession,
  WeeklyEntry,
} from "./types";

const KEY = "companion.v1";

function empty(): AppData {
  return { version: 1, profile: null, daily: [], weekly: [], reaction: [], typingSessions: [],
    activityDays: [],
    typingDays: [],
    dailyAnswers: [],
    movementSessions: [],
    contactDays: [],
    checkIns: [],
    settings: { muted: false },
    ladder: null,
  };
}

let cache: AppData | null = null;
let memoryFallback: string | null = null; // used if localStorage is blocked
const listeners = new Set<() => void>();

function rawRead(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return memoryFallback;
  }
}

function rawWrite(value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, value);
  } catch {
    memoryFallback = value;
  }
}

function load(): AppData {
  const raw = rawRead();
  if (!raw) return empty();
  try {
    const parsed = JSON.parse(raw) as Partial<AppData>;
    const base = empty();
    return {
      ...base,
      ...parsed,
      settings: { ...base.settings, ...(parsed.settings ?? {}) },
      daily: parsed.daily ?? [],
      weekly: parsed.weekly ?? [],
      reaction: parsed.reaction ?? [],
      typingSessions: parsed.typingSessions ?? [],
      activityDays: parsed.activityDays ?? [],
      typingDays: Array.isArray(parsed.typingDays) ? parsed.typingDays : [],
      dailyAnswers: Array.isArray(parsed.dailyAnswers) ? parsed.dailyAnswers : [],
      movementSessions: Array.isArray(parsed.movementSessions) ? parsed.movementSessions : [],
      contactDays: Array.isArray(parsed.contactDays) ? parsed.contactDays : [],
      checkIns: parsed.checkIns ?? [],
      ladder: parsed.ladder ?? null,
    };
  } catch {
    return empty();
  }
}

function sortByDate<T extends { date: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => a.date.localeCompare(b.date));
}

function commit(next: AppData) {
  const tidy: AppData = {
    ...next,
    daily: sortByDate(next.daily),
    weekly: sortByDate(next.weekly),
    reaction: sortByDate(next.reaction),
    typingSessions: sortByDate(next.typingSessions),
    activityDays: sortByDate(next.activityDays),
    typingDays: sortByDate(next.typingDays ?? []),
    dailyAnswers: sortByDate(next.dailyAnswers ?? []),
    movementSessions: sortByDate(next.movementSessions ?? []),
    contactDays: sortByDate(next.contactDays ?? []),
    checkIns: sortByDate(next.checkIns),
  };
  cache = tidy;
  rawWrite(JSON.stringify(tidy));
  listeners.forEach((l) => l());
}

export function readData(): AppData {
  if (!cache) cache = load();
  return cache;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = load();
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** Returns the stored data, or null during server render and the first hydration pass. */
export function useData(): AppData | null {
  return useSyncExternalStore(subscribe, readData, () => null);
}

// Writes

export function saveProfile(profile: Profile) {
  commit({ ...readData(), profile });
}

/** One daily entry per day: saving again the same day replaces it. */
export function saveDaily(entry: DailyEntry) {
  const d = readData();
  commit({ ...d, daily: [...d.daily.filter((e) => e.date !== entry.date), entry] });
}

export function saveWeekly(entry: WeeklyEntry) {
  const d = readData();
  commit({ ...d, weekly: [...d.weekly.filter((e) => e.date !== entry.date), entry] });
}

export function saveReaction(result: ReactionResult) {
  const d = readData();
  commit({ ...d, reaction: [...d.reaction, result] });
}

/** Saves typing sessions; one with an id that is already stored is skipped. */
export function saveTypingSessions(sessions: TypingSession[]) {
  if (!sessions.length) return;
  const d = readData();
  const known = new Set(d.typingSessions.map((s) => s.id));
  const fresh = sessions.filter((s) => !known.has(s.id));
  if (!fresh.length) return;
  commit({ ...d, typingSessions: [...d.typingSessions, ...fresh] });
}

/**
 * Typing per day and kind of app. A row for the same day, kind and place replaces the stored
 * one (today's values grow as the day goes on); a real day replaces a made-up one.
 */
export function saveTypingDays(days: TypingDay[]) {
  if (!days.length) return;
  const d = readData();
  const key = (t: TypingDay) => `${t.date}|${t.kind}|${t.measuredIn}`;
  const byKey = new Map((d.typingDays ?? []).map((t) => [key(t), t]));
  let changed = false;
  for (const t of days) {
    const cur = byKey.get(key(t));
    if (cur?.source === "user" && t.source === "demo") continue;
    if (!cur || cur.presses !== t.presses || cur.spreadMs !== t.spreadMs || cur.holdMs !== t.holdMs || cur.source !== t.source) {
      byKey.set(key(t), t);
      changed = true;
    }
  }
  if (changed) commit({ ...d, typingDays: [...byKey.values()] });
}

/** First and last activity per day from the desktop app. A day with real data replaces demo data. */
export function saveActivityDays(days: ActivityDay[]) {
  if (!days.length) return;
  const d = readData();
  const byDate = new Map(d.activityDays.map((a) => [a.date, a]));
  let changed = false;
  for (const a of days) {
    const cur = byDate.get(a.date);
    if (!cur || cur.first !== a.first || cur.last !== a.last || cur.source !== a.source) {
      byDate.set(a.date, a);
      changed = true;
    }
  }
  if (changed) commit({ ...d, activityDays: [...byDate.values()] });
}

/** How many messages passed with the person they trust on these days (never what they say). */
export function saveContactDays(days: ContactDay[]) {
  if (!days.length) return;
  const d = readData();
  const byDate = new Map((d.contactDays ?? []).map((c) => [c.date, c]));
  let changed = false;
  for (const c of days) {
    const cur = byDate.get(c.date);
    if (!cur || cur.exchanged !== c.exchanged) {
      byDate.set(c.date, c);
      changed = true;
    }
  }
  if (changed) commit({ ...d, contactDays: [...byDate.values()] });
}

/** Stores one stretch with the camera on (numbers only). */
export function saveMovementSession(entry: StoredMovementSession) {
  const d = readData();
  commit({ ...d, movementSessions: [...(d.movementSessions ?? []), entry] });
}

/** Stores today's answer to the daily question, or that it was dismissed. One per day. */
export function saveDailyAnswer(entry: DailyAnswer) {
  const d = readData();
  commit({ ...d, dailyAnswers: [...(d.dailyAnswers ?? []).filter((a) => a.date !== entry.date), entry] });
}

/** Stores the answer to a proposed check-in, and ends a simulated change. */
export function saveCheckIn(entry: PromptedCheckIn) {
  const d = readData();
  commit({
    ...d,
    checkIns: [...d.checkIns, entry],
    settings: { ...d.settings, simulatedChangeAt: undefined },
  });
}

/** Stores the ladder after "Not my best" (lib/ladder.ts), or clears it with null. */
export function saveLadder(ladder: LadderState | null) {
  commit({ ...readData(), ladder });
}

export function saveSettings(settings: Partial<Settings>) {
  const d = readData();
  commit({ ...d, settings: { ...d.settings, ...settings } });
}

/** Adds demo entries on days that have no real entry. */
export function addDemo(demo: {
  daily: DailyEntry[];
  weekly: WeeklyEntry[];
  reaction: ReactionResult[];
  typingSessions: TypingSession[];
  typingDays: TypingDay[];
  activityDays: ActivityDay[];
  dailyAnswers?: DailyAnswer[];
  movementSessions?: StoredMovementSession[];
  contactDays?: ContactDay[];
}) {
  const d = clearDemoFrom(readData());
  const realDaily = new Set(d.daily.map((e) => e.date));
  const realWeekly = new Set(d.weekly.map((e) => e.date));
  const realActivity = new Set(d.activityDays.map((e) => e.date));
  commit({
    ...d,
    daily: [...d.daily, ...demo.daily.filter((e) => !realDaily.has(e.date))],
    weekly: [...d.weekly, ...demo.weekly.filter((e) => !realWeekly.has(e.date))],
    reaction: [...d.reaction, ...demo.reaction],
    typingSessions: [...d.typingSessions, ...demo.typingSessions],
    movementSessions: [...(d.movementSessions ?? []), ...(demo.movementSessions ?? [])],
    contactDays: [...(d.contactDays ?? []), ...(demo.contactDays ?? []).filter((c) => !(d.contactDays ?? []).some((u) => u.date === c.date))],
    dailyAnswers: [
      ...(d.dailyAnswers ?? []),
      ...(demo.dailyAnswers ?? []).filter((a) => !(d.dailyAnswers ?? []).some((u) => u.date === a.date)),
    ],
    typingDays: [
      ...(d.typingDays ?? []),
      ...demo.typingDays.filter((t) => !(d.typingDays ?? []).some((u) => u.date === t.date && u.kind === t.kind)),
    ],
    activityDays: [...d.activityDays, ...demo.activityDays.filter((e) => !realActivity.has(e.date))],
  });
}

function clearDemoFrom(d: AppData): AppData {
  return {
    ...d,
    daily: d.daily.filter((e) => e.source !== "demo"),
    weekly: d.weekly.filter((e) => e.source !== "demo"),
    reaction: d.reaction.filter((e) => e.source !== "demo"),
    typingSessions: d.typingSessions.filter((e) => e.source !== "demo"),
    typingDays: (d.typingDays ?? []).filter((e) => e.source !== "demo"),
    dailyAnswers: (d.dailyAnswers ?? []).filter((e) => e.source !== "demo"),
    movementSessions: (d.movementSessions ?? []).filter((e) => e.source !== "demo"),
    contactDays: (d.contactDays ?? []).filter((e) => e.source !== "demo"),
    activityDays: d.activityDays.filter((e) => e.source !== "demo"),
    settings: { ...d.settings, simulatedChangeAt: undefined },
    // A ladder that started from made-up data goes with it.
    ladder: d.ladder?.simulated ? null : (d.ladder ?? null),
  };
}

export function clearDemo() {
  commit(clearDemoFrom(readData()));
}

export function hasDemo(d: AppData): boolean {
  return [...d.daily, ...d.weekly, ...d.reaction, ...d.typingSessions, ...(d.typingDays ?? []), ...(d.dailyAnswers ?? []), ...(d.movementSessions ?? []), ...(d.contactDays ?? []), ...d.activityDays].some(
    (e) => e.source === "demo",
  );
}

/** Removes everything this app has stored in this browser. */
export function deleteEverything() {
  rawWrite(null);
  memoryFallback = null;
  cache = empty();
  listeners.forEach((l) => l());
}
