"use client";

// The phone app's bridge, web side. The phone app (mobile/, React Native) shows this same web
// interface in a full-screen WebView and does for it what a web page cannot: read sleep and steps
// from the phone's health data, schedule notifications, ask for permissions. This file is the
// only place the web code talks to it. It has no React Native imports and does nothing outside
// the phone app, so the static export and the desktop app are unchanged (every call rejects with
// code "not-phone" there; isPhoneApp() in lib/platform.ts says which).
//
// The wire: JSON messages over postMessage, each request with an id and a timeout.
//   web -> native  window.ReactNativeWebView.postMessage(JSON.stringify({ cheerPressure, id, kind, args }))
//   native -> web  window.__cheerPressurePhone.receive({ cheerPressure, id, ok, result | error })
//                  window.__cheerPressurePhone.receive({ cheerPressure, event, data })
// The native side (mobile/src/bridge.ts) injects a small receiver before the page loads that
// queues messages until this file takes over, so nothing sent at start is lost.
//
// What it starts by itself (startPhone, called once from lib/platform.ts in the phone app):
// - reads sleep and steps for the last 56 days, when the person has been asked for them, on
//   start and whenever the app comes back to the front (at most once a minute);
// - plans the daily hello's notifications from Settings and hands them to the phone;
// - shows "Cheri would like a word" when a read from Health makes the rule ask (lib/passive.ts),
//   at most once a day and never in quiet hours.
// Nothing about health ever leaves the phone: the values go from the phone's Health store to
// this page's own storage (lib/storage.ts) and nowhere else.

import { addDays, clockToMinutes, dayKey, daysBetween } from "./dates";
import { dailyQuestionOf, FREQUENCIES, questionTime } from "./daily";
import { evaluatePassive } from "./passive";
import { isPhoneApp } from "./platform";
import { forRule, inQuietHours, quietHoursOf } from "./settings";
import { markPhoneHealthAsked, readData, savePhoneHealth, savePhoneNotices } from "./storage";
import type { AppData, DayKey } from "./types";

// BEGIN PROTOCOL (byte for byte the same in mobile/src/protocol.ts; scripts/test-phone.mts checks)

/** Bumped when a message changes shape. Both sides say which version they speak. */
export const PHONE_BRIDGE_VERSION = 1;

export const PHONE_REQUESTS = [
  "getCapabilities",
  "requestPermission",
  "getSleep",
  "getSteps",
  "scheduleNotifications",
  "cancelNotifications",
  "notifyNow",
  "openSettings",
  "demoHealth",
] as const;
export type PhoneRequestKind = (typeof PHONE_REQUESTS)[number];

export const PHONE_EVENTS = ["opened-from-notification", "app-state"] as const;
export type PhoneEventKind = (typeof PHONE_EVENTS)[number];

/** "camera-microphone" asks for both, one after the other. "location" is not built: not-available. */
export type PhonePermissionKind = "health" | "notifications" | "camera" | "microphone" | "camera-microphone" | "location";

/**
 * granted / denied: the phone's answer. asked: Health never tells an app whether reading was
 * allowed, only that the question was shown. not-asked: not yet. not-available: not on this phone
 * or not built yet (Health Connect on Android).
 */
export type PhonePermissionState = "granted" | "denied" | "asked" | "not-asked" | "not-available";

/** One night, reduced on the phone (mobile/src/health/nights.ts). Same shape as HealthNight in lib/types.ts. */
export interface PhoneNight {
  /** The morning it ended, "YYYY-MM-DD". */
  date: string;
  /** "HH:MM", local. */
  bedtime: string;
  wake: string;
  asleepMinutes: number | null;
  inBedMinutes: number | null;
  awakenings: number | null;
  /** "demo" for the made-up weeks of the development build. */
  source: "user" | "demo";
}

/** Steps on one full day. Same shape as StepsDay in lib/types.ts. */
export interface PhoneStepsDay {
  date: string;
  steps: number;
  source: "user" | "demo";
}

export interface PhoneCapabilities {
  version: number;
  platform: "ios" | "android";
  build: "development" | "release";
  health: { available: boolean; why: "not-available-yet" | "not-on-this-device" | null; state: PhonePermissionState };
  notifications: PhonePermissionState;
  camera: PhonePermissionState;
  microphone: PhonePermissionState;
  /** Only in development builds: "Add eight made-up weeks to Health". */
  demoHealth: boolean;
}

/** One local notification. `at` is an ISO time, or null for now. `path` is the screen a tap opens. */
export interface PhoneNotice {
  id: string;
  kind: "hello" | "word";
  at: string | null;
  title: string;
  body: string;
  path: string;
}

/** Everything the phone should have scheduled: it replaces what was scheduled before. */
export interface NotificationPlan {
  notices: PhoneNotice[];
}

export interface PhoneRequests {
  getCapabilities: { args: Record<string, never>; result: PhoneCapabilities };
  requestPermission: { args: { kind: PhonePermissionKind }; result: { kind: PhonePermissionKind; state: PhonePermissionState } };
  getSleep: { args: { since: string }; result: { since: string; nights: PhoneNight[] } };
  getSteps: { args: { since: string }; result: { since: string; days: PhoneStepsDay[] } };
  scheduleNotifications: { args: { plan: NotificationPlan }; result: { scheduled: number } };
  cancelNotifications: { args: Record<string, never>; result: { cancelled: number } };
  notifyNow: { args: { notice: PhoneNotice }; result: { shown: boolean } };
  openSettings: { args: Record<string, never>; result: { opened: boolean } };
  demoHealth: { args: { action: "add" | "remove" }; result: { nights: number; days: number } };
}

export interface PhoneEvents {
  "opened-from-notification": { id: string; kind: PhoneNotice["kind"]; path: string };
  "app-state": { state: "active" | "background" };
}

export type PhoneErrorCode = "not-phone" | "timeout" | "not-available" | "denied" | "bad-request" | "failed";

export type WebToNative = { cheerPressure: number; id: string; kind: PhoneRequestKind; args: unknown };
export type NativeToWeb =
  | { cheerPressure: number; id: string; ok: true; result: unknown }
  | { cheerPressure: number; id: string; ok: false; error: { code: PhoneErrorCode; message: string } }
  | { cheerPressure: number; event: PhoneEventKind; data: unknown };

// END PROTOCOL

/** How long each request may take before it fails with "timeout". Permission prompts wait for the person. */
const TIMEOUT_MS: Record<PhoneRequestKind, number> = {
  getCapabilities: 5_000,
  requestPermission: 180_000,
  getSleep: 30_000,
  getSteps: 30_000,
  scheduleNotifications: 10_000,
  cancelNotifications: 10_000,
  notifyNow: 10_000,
  openSettings: 5_000,
  demoHealth: 120_000,
};

export class PhoneBridgeError extends Error {
  constructor(
    public code: PhoneErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PhoneBridgeError";
  }
}

interface PhoneWindow {
  ReactNativeWebView?: { postMessage(message: string): void };
  __cheerPressurePhone?: { queue?: unknown[]; receive(message: unknown): void };
}

const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
const eventHandlers = new Map<PhoneEventKind, Set<(data: never) => void>>();
let counter = 0;

function receive(raw: unknown) {
  const msg = (typeof raw === "string" ? safeParse(raw) : raw) as NativeToWeb | null;
  if (!msg || typeof msg !== "object" || !("cheerPressure" in msg)) return;
  if ("event" in msg) {
    for (const h of eventHandlers.get(msg.event) ?? []) h(msg.data as never);
    return;
  }
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  clearTimeout(p.timer);
  if (msg.ok) p.resolve(msg.result);
  else p.reject(new PhoneBridgeError(msg.error?.code ?? "failed", msg.error?.message ?? "The phone could not do that."));
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Sends one request to the phone and waits for its answer, or rejects after the kind's timeout. */
export function request<K extends PhoneRequestKind>(kind: K, args: PhoneRequests[K]["args"]): Promise<PhoneRequests[K]["result"]> {
  if (!isPhoneApp()) return Promise.reject(new PhoneBridgeError("not-phone", "Only in the phone app."));
  installReceiver();
  const id = `${Date.now().toString(36)}-${(counter++).toString(36)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new PhoneBridgeError("timeout", `The phone did not answer ${kind} in time.`));
    }, TIMEOUT_MS[kind]);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    const msg: WebToNative = { cheerPressure: PHONE_BRIDGE_VERSION, id, kind, args };
    (window as unknown as PhoneWindow).ReactNativeWebView!.postMessage(JSON.stringify(msg));
  });
}

/** Listens to an event from the phone. Returns a function that stops listening. */
export function onPhoneEvent<E extends PhoneEventKind>(event: E, handler: (data: PhoneEvents[E]) => void): () => void {
  const set = eventHandlers.get(event) ?? new Set();
  set.add(handler as (data: never) => void);
  eventHandlers.set(event, set);
  return () => set.delete(handler as (data: never) => void);
}

let installed = false;
function installReceiver() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const w = window as unknown as PhoneWindow;
  const queued = w.__cheerPressurePhone?.queue ?? [];
  w.__cheerPressurePhone = { receive };
  for (const m of queued) receive(m);
}

// The calls, one per request.

export const getCapabilities = () => request("getCapabilities", {});
export const requestPermission = (kind: PhonePermissionKind) => request("requestPermission", { kind });
export const getSleep = (since: DayKey) => request("getSleep", { since });
export const getSteps = (since: DayKey) => request("getSteps", { since });
export const scheduleNotifications = (plan: NotificationPlan) => request("scheduleNotifications", { plan });
export const cancelNotifications = () => request("cancelNotifications", {});
export const notifyNow = (notice: PhoneNotice) => request("notifyNow", { notice });
/** Opens this app's page in the phone's Settings (to change a permission refused earlier). */
export const openSettings = () => request("openSettings", {});

/** Development builds only: adds eight made-up weeks of sleep and steps to the phone's Health, or removes them. */
export async function demoHealth(action: "add" | "remove") {
  const r = await request("demoHealth", { action });
  await syncPhoneHealth({ force: true });
  return r;
}

// Sleep and steps

/** Days read from Health each time: eight weeks, what the rule and My values look at. */
export const HEALTH_DAYS = 56;

let lastSync = 0;

/**
 * Reads the last 56 days of sleep and steps from the phone's Health and stores them (lib/storage.ts).
 * Only after the person has been asked for them, never while everything is paused, and at most
 * once a minute unless forced. Returns false when nothing was read.
 */
export async function syncPhoneHealth(opts: { force?: boolean; today?: DayKey } = {}): Promise<boolean> {
  if (!isPhoneApp()) return false;
  const data = readData();
  if (!data.phoneHealth?.askedAt || data.settings.pausedAll) return false;
  if (!opts.force && Date.now() - lastSync < 60_000) return false;
  lastSync = Date.now();
  const since = addDays(opts.today ?? dayKey(new Date()), -HEALTH_DAYS);
  const [sleep, steps] = await Promise.allSettled([getSleep(since), getSteps(since)]);
  const nights = sleep.status === "fulfilled" ? sleep.value.nights : null;
  const days = steps.status === "fulfilled" ? steps.value.days : null;
  if (!nights && !days) return false;
  savePhoneHealth({ since, nights, steps: days });
  return true;
}

/**
 * Asks for sleep and steps (the phone's own sheet), remembers that it was asked and reads them.
 * For onboarding's "What may I look at?" and Settings. On Android today: "not-available".
 */
export async function connectPhoneHealth(): Promise<PhonePermissionState> {
  const { state } = await requestPermission("health");
  if (state === "not-available") return state;
  markPhoneHealthAsked();
  await syncPhoneHealth({ force: true });
  return state;
}

// Notifications

export const HELLO_TITLE = "A hello from Cheri";
export const HELLO_BODY = "How are you today? A few seconds is enough.";
export const WORD_TITLE = "Cheri would like a word";
export const WORD_BODY = "A few things look different from your usual. Have a look when you have a moment.";
/** The daily hello's screen. Until it exists, the phone opens home instead (mobile/src/navigation.ts). */
export const HELLO_PATH = "/hello/";
export const WORD_PATH = "/prompt/";
/** How far ahead the daily hello is scheduled. The plan is made again every time the app is opened or left. */
export const PLAN_DAYS = 14;
/** The daily hello comes every day for this many days from the start (the learning period). */
const LEARNING_HELLO_DAYS = 14;

/** Days between two hellos on `day`: every day in the first two weeks when the person chose that, then as set. */
function helloGapDays(data: AppData, day: DayKey): number | null {
  const d = dailyQuestionOf(data.settings) as ReturnType<typeof dailyQuestionOf> & { firstTwoWeeksDaily?: boolean };
  const started = data.profile?.createdAt ? dayKey(new Date(data.profile.createdAt)) : null;
  if (d.firstTwoWeeksDaily && started && daysBetween(started, day) < LEARNING_HELLO_DAYS) return 1;
  return FREQUENCIES.find((f) => f.value === d.every)?.gapDays ?? null;
}

function atClock(day: DayKey, hhmm: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  const mins = clockToMinutes(hhmm);
  return new Date(y, m - 1, d, Math.floor(mins / 60), mins % 60, 0, 0);
}

/**
 * The daily hello's notifications for the next two weeks, from Settings: at the chosen time (moved
 * out of quiet hours, lib/daily.ts), on the days the chosen frequency gives, never twice on one day,
 * never on a day already answered, and nothing while everything is paused or the hello is off.
 * Missed days are never made up for: the plan only looks forward.
 */
export function planNotifications(data: AppData, now: Date): NotificationPlan {
  if (!data.profile || data.settings.pausedAll) return { notices: [] };
  const today = dayKey(now);
  const time = questionTime(data.settings);
  const q = quietHoursOf(data.settings);
  if (inQuietHours(clockToMinutes(time), q)) return { notices: [] };
  const answered = new Set((data.dailyAnswers ?? []).map((a) => a.date));
  let last = [...answered].filter((d) => d <= today).sort().pop() ?? null;
  const notices: PhoneNotice[] = [];
  for (let i = 0; i < PLAN_DAYS; i++) {
    const day = addDays(today, i);
    const gap = helloGapDays(data, day);
    if (!gap) continue;
    if (answered.has(day)) {
      last = day;
      continue;
    }
    const at = atClock(day, time);
    if (at.getTime() <= now.getTime()) continue;
    if (last && daysBetween(last, day) < gap) continue;
    notices.push({ id: `hello-${day}`, kind: "hello", at: at.toISOString(), title: HELLO_TITLE, body: HELLO_BODY, path: HELLO_PATH });
    last = day;
  }
  return { notices };
}

/**
 * Whether to show "Cheri would like a word" now: the rule asks (two different categories, lib/passive.ts),
 * nothing is paused, it is not quiet hours, and it has not been shown today.
 */
export function wordDue(data: AppData, now: Date): boolean {
  if (data.settings.pausedAll) return false;
  const today = dayKey(now);
  if (data.phoneNotices?.wordOn === today) return false;
  if (inQuietHours(now.getHours() * 60 + now.getMinutes(), quietHoursOf(data.settings))) return false;
  return evaluatePassive(forRule(data), today).askNow;
}

/** Hands the plan to the phone. Without permission for notifications the phone schedules nothing and says so. */
export async function refreshNotificationPlan(now = new Date()) {
  if (!isPhoneApp()) return null;
  return scheduleNotifications(planNotifications(readData(), now)).catch(() => null);
}

async function sayAWordIfDue(askedBefore: boolean) {
  const now = new Date();
  const data = readData();
  if (askedBefore || !wordDue(data, now)) return;
  const shown = await notifyNow({ id: `word-${dayKey(now)}`, kind: "word", at: null, title: WORD_TITLE, body: WORD_BODY, path: WORD_PATH }).catch(() => null);
  if (shown?.shown) savePhoneNotices({ wordOn: dayKey(now) });
}

// Start

let started = false;

/** Starts the bridge once in the phone app: the receiver, the first read and plan, and the app's comings and goings. */
export function startPhone() {
  if (started || typeof window === "undefined" || !isPhoneApp()) return;
  started = true;
  installReceiver();
  const refresh = async () => {
    // Health may have been asked from elsewhere (onboarding asks through lib/phoneBridge.ts, which
    // does not mark it): the phone knows whether its sheet was shown.
    if (!readData().phoneHealth?.askedAt) {
      const caps = await getCapabilities().catch(() => null);
      if (caps?.health.state === "asked" || caps?.health.state === "granted") markPhoneHealthAsked();
    }
    const before = readData();
    const askedBefore = !before.settings.pausedAll && evaluatePassive(forRule(before), dayKey(new Date())).askNow;
    const read = await syncPhoneHealth().catch(() => false);
    if (read) await sayAWordIfDue(askedBefore);
    await refreshNotificationPlan();
  };
  void refresh();
  onPhoneEvent("app-state", ({ state }) => {
    if (state === "active") void refresh();
    else void refreshNotificationPlan();
  });
  onPhoneEvent("opened-from-notification", (detail) => {
    // The phone has already opened the right screen; screens may listen for this to know why.
    window.dispatchEvent(new CustomEvent("cheerpressure:notification", { detail }));
  });
}
