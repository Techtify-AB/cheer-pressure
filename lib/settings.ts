// The few things the person can choose: which sources are measured, which small things
// the companion may suggest, and quiet hours. Pure code with the defaults in one place,
// so older stored data (without these fields) reads as "everything on, 22:00 to 08:00".

import { clockToMinutes } from "./dates";
import type { AppData, RoutineId, Settings, Sources } from "./types";

export const ROUTINES: { id: RoutineId; label: string }[] = [
  { id: "walk", label: "A walk in daylight" },
  { id: "morning-light", label: "Morning light" },
  { id: "regular-bedtime", label: "A regular bedtime" },
  { id: "music", label: "Music" },
  { id: "call-someone", label: "Calling someone" },
];

/** Shown on home and in the sheet: the sources that exist but are not connected yet. */
export const NOT_CONNECTED = ["Camera", "Microphone", "Bedside sensor"];

export const DEFAULT_QUIET_HOURS = { from: "22:00", to: "08:00" };

export function sourcesOf(s: Settings): Sources {
  return { typing: s.sources?.typing ?? true, dayRhythm: s.sources?.dayRhythm ?? true };
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
  if (src.typing && src.dayRhythm) return data;
  return {
    ...data,
    typingSessions: src.typing ? data.typingSessions : [],
    activityDays: src.dayRhythm ? data.activityDays : [],
  };
}
