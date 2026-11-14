import type { DayKey } from "./types";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function dayKey(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayKey(): DayKey {
  return dayKey(new Date());
}

export function parseDay(key: DayKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0);
}

export function addDays(key: DayKey, n: number): DayKey {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Whole days from a to b (b later gives a positive number). */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

export function formatDay(key: DayKey): string {
  return parseDay(key).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function formatShortDay(key: DayKey): string {
  return parseDay(key).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** "23:30" to minutes after noon, so a night that crosses midnight stays in order (23:30 = 690, 00:30 = 750). */
export function clockToNightMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  let mins = h * 60 + m;
  if (mins < 12 * 60) mins += 24 * 60;
  return mins - 12 * 60;
}

export function nightMinutesToClock(v: number): string {
  let mins = Math.round(v) + 12 * 60;
  mins = ((mins % 1440) + 1440) % 1440;
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/** "07:15" to minutes after midnight. */
export function clockToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToClock(v: number): string {
  let mins = Math.round(v);
  mins = ((mins % 1440) + 1440) % 1440;
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

export function shiftClock(hhmm: string, deltaMin: number): string {
  return minutesToClock(clockToMinutes(hhmm) + deltaMin);
}

/** Hours slept from bedtime to wake time. */
export function sleepHours(bedtime: string, wakeTime: string): number {
  const bed = clockToMinutes(bedtime);
  let wake = clockToMinutes(wakeTime);
  if (wake <= bed) wake += 1440;
  return (wake - bed) / 60;
}

/** "1 hour 20 minutes", "40 minutes". */
export function describeMinutes(mins: number): string {
  const m = Math.round(Math.abs(mins) / 5) * 5;
  const h = Math.floor(m / 60);
  const r = m % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (r) parts.push(`${r} minutes`);
  return parts.join(" ") || "a few minutes";
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
