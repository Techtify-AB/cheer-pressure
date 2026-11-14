"use client";

// The only place that touches browser storage. Everything is kept in localStorage
// under one key, on this device only. No account, no server, no sync.
//
// To move to IndexedDB later, keep this module's exported functions and swap the
// read/write helpers below.

import { useSyncExternalStore } from "react";
import type { AppData, DailyEntry, Profile, ReactionResult, Settings, TypingSession, WeeklyEntry } from "./types";

const KEY = "companion.v1";

function empty(): AppData {
  return { version: 1, profile: null, daily: [], weekly: [], reaction: [], typingSessions: [], settings: { muted: false } };
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
}) {
  const d = clearDemoFrom(readData());
  const realDaily = new Set(d.daily.map((e) => e.date));
  const realWeekly = new Set(d.weekly.map((e) => e.date));
  commit({
    ...d,
    daily: [...d.daily, ...demo.daily.filter((e) => !realDaily.has(e.date))],
    weekly: [...d.weekly, ...demo.weekly.filter((e) => !realWeekly.has(e.date))],
    reaction: [...d.reaction, ...demo.reaction],
    typingSessions: [...d.typingSessions, ...demo.typingSessions],
  });
}

function clearDemoFrom(d: AppData): AppData {
  return {
    ...d,
    daily: d.daily.filter((e) => e.source !== "demo"),
    weekly: d.weekly.filter((e) => e.source !== "demo"),
    reaction: d.reaction.filter((e) => e.source !== "demo"),
    typingSessions: d.typingSessions.filter((e) => e.source !== "demo"),
  };
}

export function clearDemo() {
  commit(clearDemoFrom(readData()));
}

export function hasDemo(d: AppData): boolean {
  return [...d.daily, ...d.weekly, ...d.reaction, ...d.typingSessions].some((e) => e.source === "demo");
}

/** Removes everything this app has stored in this browser. */
export function deleteEverything() {
  rawWrite(null);
  memoryFallback = null;
  cache = empty();
  listeners.forEach((l) => l());
}
