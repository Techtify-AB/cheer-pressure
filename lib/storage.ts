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
  StoredToneSession,
  DailyEntry,
  LadderState,
  Profile,
  PromptedCheckIn,
  ReactionResult,
  Settings,
  TypingDay,
  TypingSession,
  WeeklyEntry,
  HelpItem,
  SuggestionRecord,
  ClinicSharedEntry,
  HelloReading,
  OnboardingState,
  PermissionKind,
  PermissionState,
} from "./types";

import type { HealthNight, StepsDay } from "./types";

const KEY = "companion.v1";

function empty(): AppData {
  return { version: 1, profile: null, daily: [], weekly: [], reaction: [], typingSessions: [],
    activityDays: [],
    typingDays: [],
    dailyAnswers: [],
    movementSessions: [],
    contactDays: [],
    toneSessions: [],
    postureUsual: null,
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
      outDays: Array.isArray(parsed.outDays) ? parsed.outDays : [],
      seenDays: Array.isArray(parsed.seenDays) ? parsed.seenDays : [],
      toneSessions: Array.isArray(parsed.toneSessions) ? parsed.toneSessions : [],
      postureUsual: parsed.postureUsual ?? null,
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
    toneSessions: sortByDate(next.toneSessions ?? []),
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

/**
 * Nights and steps read from the phone's health data (lib/phone.ts). The phone is the source of
 * truth: from `since` on, what is stored is replaced by what was read (so a night removed from
 * Health goes here too); older days are kept.
 */
export function savePhoneHealth(read: { since: string; nights: HealthNight[] | null; steps: StepsDay[] | null }) {
  const d = readData();
  const keep = <T extends { date: string }>(list: T[] | undefined) => (list ?? []).filter((e) => e.date < read.since);
  commit({
    ...d,
    healthNights: read.nights ? sortByDate([...keep(d.healthNights), ...read.nights]) : d.healthNights,
    stepDays: read.steps ? sortByDate([...keep(d.stepDays), ...read.steps]) : d.stepDays,
    phoneHealth: { askedAt: d.phoneHealth?.askedAt ?? new Date().toISOString(), syncedAt: new Date().toISOString() },
  });
}

/** The person was asked for sleep and steps on the phone (whatever they chose: Health never says). */
export function markPhoneHealthAsked() {
  const d = readData();
  commit({ ...d, phoneHealth: { ...d.phoneHealth, askedAt: d.phoneHealth?.askedAt ?? new Date().toISOString() } });
}

/** The phone app's own notification bookkeeping (lib/phone.ts). */
export function savePhoneNotices(notices: { wordOn?: string }) {
  const d = readData();
  commit({ ...d, phoneNotices: { ...d.phoneNotices, ...notices } });
}

/**
 * Stores one stretch with the camera on (numbers only), and keeps the usual posture across
 * sessions: the median head height of the last 28 days' sessions, so days can be compared
 * (the camera's own posture usual is only the first minutes of each session).
 */
export function saveMovementSession(entry: StoredMovementSession) {
  const d = readData();
  const sessions = [...(d.movementSessions ?? []), entry];
  const cutoff = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
  const heights = sessions
    .filter((s) => s.date >= cutoff && s.posture && Number.isFinite(s.posture.uprightMean))
    .map((s) => s.posture!.uprightMean)
    .sort((a, b) => a - b);
  const postureUsual = heights.length
    ? { uprightMedian: heights[Math.floor((heights.length - 1) / 2)], sessions: heights.length, updatedAt: new Date().toISOString() }
    : (d.postureUsual ?? null);
  commit({ ...d, movementSessions: sessions, postureUsual });
}

/** Stores one stretch with the microphone on (numbers only; no audio, no words). */
export function saveToneSession(entry: StoredToneSession) {
  const d = readData();
  commit({ ...d, toneSessions: [...(d.toneSessions ?? []), entry] });
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
  outDays?: import("./types").OutDay[];
  seenDays?: import("./types").SeenDay[];
  toneSessions?: StoredToneSession[];
  activitiesDone?: import("./types").ActivityDone[];
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
    toneSessions: [...(d.toneSessions ?? []), ...(demo.toneSessions ?? [])],
    contactDays: [...(d.contactDays ?? []), ...(demo.contactDays ?? []).filter((c) => !(d.contactDays ?? []).some((u) => u.date === c.date))],
    outDays: [...(d.outDays ?? []), ...(demo.outDays ?? []).filter((c) => !(d.outDays ?? []).some((u) => u.date === c.date))],
    seenDays: [...(d.seenDays ?? []), ...(demo.seenDays ?? []).filter((c) => !(d.seenDays ?? []).some((u) => u.date === c.date))],
    dailyAnswers: [
      ...(d.dailyAnswers ?? []),
      ...(demo.dailyAnswers ?? []).filter((a) => !(d.dailyAnswers ?? []).some((u) => u.date === a.date)),
    ],
    typingDays: [
      ...(d.typingDays ?? []),
      ...demo.typingDays.filter((t) => !(d.typingDays ?? []).some((u) => u.date === t.date && u.kind === t.kind)),
    ],
    activityDays: [...d.activityDays, ...demo.activityDays.filter((e) => !realActivity.has(e.date))],
    activitiesDone: [...(d.activitiesDone ?? []), ...(demo.activitiesDone ?? [])],
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
    outDays: (d.outDays ?? []).filter((e) => e.source !== "demo"),
    seenDays: (d.seenDays ?? []).filter((e) => e.source !== "demo"),
    toneSessions: (d.toneSessions ?? []).filter((e) => e.source !== "demo"),
    activityDays: d.activityDays.filter((e) => e.source !== "demo"),
    activitiesDone: (d.activitiesDone ?? []).filter((e) => e.source !== "demo"),
    // Made-up weeks in the phone's Health come back on the next read until removed there.
    healthNights: (d.healthNights ?? []).filter((e) => e.source !== "demo"),
    stepDays: (d.stepDays ?? []).filter((e) => e.source !== "demo"),
    settings: { ...d.settings, simulatedChangeAt: undefined },
    // A ladder that started from made-up data goes with it.
    ladder: d.ladder?.simulated ? null : (d.ladder ?? null),
    suggestions: (d.suggestions ?? []).filter((s) => !s.simulated),
    clinicShared: (d.clinicShared ?? []).filter((c) => !c.simulated),
  };
}

export function clearDemo() {
  commit(clearDemoFrom(readData()));
}

export function hasDemo(d: AppData): boolean {
  return [...d.daily, ...d.weekly, ...d.reaction, ...d.typingSessions, ...(d.typingDays ?? []), ...(d.dailyAnswers ?? []), ...(d.movementSessions ?? []), ...(d.contactDays ?? []), ...(d.toneSessions ?? []), ...d.activityDays].some(
    (e) => e.source === "demo",
  ) || [...(d.healthNights ?? []), ...(d.stepDays ?? []), ...(d.outDays ?? []), ...(d.seenDays ?? [])].some((e) => e.source === "demo");
}

/** Removes everything this app has stored in this browser. */
export function deleteEverything() {
  rawWrite(null);
  memoryFallback = null;
  cache = empty();
  listeners.forEach((l) => l());
}

// --- The phone flow (docs/MOBILE_SPEC.md) --------------------------------------------------

/** The person's own "What helps you?" list. */
export function saveHelps(helps: HelpItem[]) {
  commit({ ...readData(), helps });
}

/** Every step-one suggestion and what followed it (lib/helps.ts). */
export function saveSuggestions(suggestions: SuggestionRecord[]) {
  commit({ ...readData(), suggestions });
}

/** Adds one entry to "Shared with my clinic" (a demo recipient: nothing is sent). */
export function addClinicShared(entry: ClinicSharedEntry) {
  const d = readData();
  commit({ ...d, clinicShared: [...(d.clinicShared ?? []).filter((e) => e.id !== entry.id), entry] });
}

/** One short reading from the daily hello (numbers only). */
export function saveHelloReading(entry: HelloReading) {
  const d = readData();
  commit({ ...d, helloReadings: [...(d.helloReadings ?? []), entry] });
}

export function saveOnboarding(onboarding: OnboardingState) {
  commit({ ...readData(), onboarding });
}

export function savePermission(kind: PermissionKind, state: PermissionState) {
  const d = readData();
  commit({ ...d, permissions: { ...(d.permissions ?? {}), [kind]: state } });
}

// --- Activities: "something for you" (lib/activities, lib/plan.ts) --------------------------

/** The person's plan for the activities, or null to go back to the demo defaults. */
export function savePlan(plan: import("./types").SavedPlan | null) {
  commit({ ...readData(), plan: plan ?? undefined });
}

/** One activity the person said they did. */
export function saveActivityDone(entry: import("./types").ActivityDone) {
  const d = readData();
  commit({ ...d, activitiesDone: [...(d.activitiesDone ?? []).filter((e) => e.id !== entry.id), entry] });
}

/** The running activity timer, or null when it is stopped. */
export function saveActivityTimer(timer: import("./types").ActivityTimer | null) {
  commit({ ...readData(), activityTimer: timer });
}

/** One quick reaction check (experimental). */
export function saveReactionCheck(entry: import("./types").ReactionCheckResult) {
  const d = readData();
  commit({ ...d, reactionChecks: [...(d.reactionChecks ?? []).filter((e) => e.id !== entry.id), entry] });
}

/** Remembers that a reaction check was offered after an activity today. */
export function markReactionOffered(day: string) {
  commit({ ...readData(), reactionOfferedOn: day });
}
