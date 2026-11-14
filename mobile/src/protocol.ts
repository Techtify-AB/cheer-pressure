// The bridge's protocol, native side. The block between the markers is byte for byte the same
// as in lib/phone.ts (the web side); scripts/test-phone.mts checks it. Change both together and
// bump PHONE_BRIDGE_VERSION when a message changes shape.

// BEGIN PROTOCOL (byte for byte the same as lib/phone.ts; scripts/test-phone.mts checks)

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
