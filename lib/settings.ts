// The few things the person can choose: which sources are measured, which small things
// the companion may suggest, and quiet hours. Pure code with the defaults in one place,
// so older stored data (without these fields) reads as "everything on, 22:00 to 08:00".

import { clockToMinutes } from "./dates";
import { defaultBaseUrl } from "./messages";
import type { AppData, ClinicSettings, RoutineId, Settings, Sources } from "./types";

export const ROUTINES: { id: RoutineId; label: string }[] = [
  { id: "walk", label: "A walk in daylight" },
  { id: "morning-light", label: "Morning light" },
  { id: "regular-bedtime", label: "A regular bedtime" },
  { id: "music", label: "Music" },
  { id: "call-someone", label: "Calling someone" },
];


export const DEFAULT_QUIET_HOURS = { from: "22:00", to: "08:00" };

export function sourcesOf(s: Settings): Sources {
  return { typing: s.sources?.typing ?? true, dayRhythm: s.sources?.dayRhythm ?? true, camera: s.sources?.camera ?? false, microphone: s.sources?.microphone ?? false, contact: s.sources?.contact ?? true };
}

export function routinesOf(s: Settings): Record<RoutineId, boolean> {
  return Object.fromEntries(ROUTINES.map((r) => [r.id, s.routines?.[r.id] ?? true])) as Record<RoutineId, boolean>;
}

export function quietHoursOf(s: Settings): { from: string; to: string } {
  return s.quietHours ?? DEFAULT_QUIET_HOURS;
}

/** True when `minutes` (after midnight) falls in quiet hours. 22:00 to 08:00 wraps past midnight. */
export function inQuietHours(minutes: number, q: { from: string; to: string }): boolean {
  const from = clockToMinutes(q.from);
  const to = clockToMinutes(q.to);
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * The one small thing to offer: the preferred one if the person has it switched on,
 * otherwise the first switched-on routine. Never one that is switched off; null if all are.
 */
export function pickSmallThing(preferred: RoutineId, on: Record<RoutineId, boolean>): RoutineId | null {
  if (on[preferred]) return preferred;
  return ROUTINES.find((r) => on[r.id])?.id ?? null;
}

/** The data the rule may use: sources the person switched off are left out. */
export function forRule(data: AppData): AppData {
  const src = sourcesOf(data.settings);
  if (src.typing && src.dayRhythm && src.camera && src.microphone && src.contact) return data;
  return {
    ...data,
    typingSessions: src.typing ? data.typingSessions : [],
    typingDays: src.typing ? data.typingDays : [],
    activityDays: src.dayRhythm ? data.activityDays : [],
    // Made-up movement days stay, so the demo tells its story with the camera off.
    movementSessions: src.camera ? data.movementSessions : (data.movementSessions ?? []).filter((m) => m.source === "demo"),
    contactDays: src.contact ? data.contactDays : [],
    toneSessions: src.microphone ? data.toneSessions : (data.toneSessions ?? []).filter((t) => t.source === "demo"),
  };
}

/** The default port of the messages service, added when only an address is typed. */
export const MESSAGES_PORT = 3480;

/** Where the messages service lives: the stored setting, else NEXT_PUBLIC_MESSAGES_URL, else http://localhost:3480. */
export function messagesUrlOf(s: Settings): string {
  return s.messagesUrl || defaultBaseUrl();
}

/**
 * Reads a typed service address. "192.168.1.20" becomes "http://192.168.1.20:3480"; an address
 * with http:// or https:// is kept as typed, without a trailing slash. Anything else is refused.
 */
export function parseMessagesUrl(input: string): { ok: true; url: string } | { ok: false; error: string } {
  const raw = input.trim().replace(/\/+$/, "");
  if (!raw) return { ok: false, error: "Type an address, for example http://192.168.1.20:3480" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { ok: false, error: "That doesn't look like an address. For example http://192.168.1.20:3480" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { ok: false, error: "The address starts with http:// or https://" };
  if (!u.hostname || u.username || u.password || u.search || u.hash || (u.pathname && u.pathname !== "/")) {
    return { ok: false, error: "Only the address and port, for example http://192.168.1.20:3480" };
  }
  if (withScheme !== raw && !u.port) u.port = String(MESSAGES_PORT);
  return { ok: true, url: `${u.protocol}//${u.host}` };
}

/** True when an address only works on this computer, so a phone cannot open links to it. */
export function isLocalOnly(url: string): boolean {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h.endsWith(".localhost");
  } catch {
    return false;
  }
}

/** What the clinic is told, when the person has not chosen: only when I say, no automatic step. */
export const DEFAULT_CLINIC: ClinicSettings = { share: "when-i-say", tellAfterDays: false };

/** The clinic choice. "Never" never tells the clinic automatically either. */
export function clinicOf(s: Settings): ClinicSettings {
  const c = { ...DEFAULT_CLINIC, ...(s.clinic ?? {}) };
  return c.share === "never" ? { ...c, tellAfterDays: false } : c;
}

export const CLINIC_CHOICES: { value: ClinicSettings["share"]; label: string; hint: string }[] = [
  { value: "always", label: "Always", hint: "Weekly, and when two categories stand out" },
  { value: "when-i-say", label: "Only when I say", hint: "Nothing unless you approve it" },
  { value: "never", label: "Never", hint: "Nothing, ever" },
];
