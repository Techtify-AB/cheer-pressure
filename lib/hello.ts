// The daily hello (/hello/): when it comes, and the plan the phone app schedules its
// notifications from. Pure code on top of lib/daily.ts, which decides the same thing for the
// daily question on Home and in the desktop app's bubble: both store to the same place
// (dailyAnswers), so a day answered in one is never asked again in the other.
//
// - Every day for the first two weeks when the person chose it, then as often as they chose.
// - Never in quiet hours (the time is moved to the end of them), never twice a day, and a missed
//   day is never stacked up: the plan only lists days ahead, as if each one were answered.

import { addDays, dayKey } from "./dates";
import { gapDaysOn, questionTime } from "./daily";
import type { AppData, DailyAnswer, DayKey, Settings } from "./types";

/** How many days ahead the plan lists. The app sends a new plan whenever it changes. */
export const PLAN_DAYS = 21;
/** Cheri ends the hello herself by then. */
export const HELLO_MAX_MS = 40_000;
/** The longest one hold to talk may last. */
export const HOLD_MAX_MS = 25_000;

/** One scheduled notification, in the phone bridge's shape (NotificationPlan in lib/phone.ts). */
export interface HelloNotice {
  id: string;
  kind: "hello";
  /** ISO time, local clock time on that day, never inside quiet hours. */
  at: string;
  title: string;
  body: string;
  /** Where the notification opens, inside the app. */
  path: string;
}

export const HELLO_TITLE = "A hello from Cheri";
export const HELLO_BODY = "How are you today? A few seconds is enough.";

/** The day the person started: their profile's creation day, if any. */
export function startedOnOf(data: Pick<AppData, "profile">): DayKey | undefined {
  return data.profile ? dayKey(new Date(data.profile.createdAt)) : undefined;
}

/**
 * The days with a hello from today on: today when it has not been answered or dismissed yet,
 * then every gap days, as if each one were answered. Empty when it is off.
 */
export function helloDates(settings: Settings, answers: DailyAnswer[], today: DayKey, startedOn?: DayKey, days = PLAN_DAYS): DayKey[] {
  const out: DayKey[] = [];
  const last = answers.map((a) => a.date).filter((d) => d <= today).sort().pop();
  let prev: DayKey | null = last ?? null;
  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    if (prev === day) continue; // already answered today
    const gap = gapDaysOn(settings, day, startedOn);
    if (!gap) continue;
    if (prev && Math.round((Date.parse(day) - Date.parse(prev)) / 86_400_000) < gap) continue;
    out.push(day);
    prev = day;
  }
  return out;
}

/**
 * The plan the phone app schedules its notifications from: one notice per day with a hello, at
 * the chosen time, from now on. Nothing while everything is paused or before setup.
 */
export function helloPlan(data: Pick<AppData, "profile" | "settings" | "dailyAnswers">, now: Date): { notices: HelloNotice[] } {
  const s = data.settings;
  if (!data.profile || s.pausedAll) return { notices: [] };
  const today = dayKey(now);
  const at = questionTime(s);
  const [h, m] = at.split(":").map(Number);
  // Today's time already passed: the plan starts tomorrow (a missed hello is never made up for).
  const passed = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
  const notices = helloDates(s, data.dailyAnswers ?? [], passed ? addDays(today, 1) : today, startedOnOf(data))
    .map((day) => {
      const [y, mo, d] = day.split("-").map(Number);
      return { day, when: new Date(y, mo - 1, d, h, m, 0, 0) };
    })
    .filter((x) => x.when.getTime() > now.getTime())
    .map((x) => ({ id: `hello-${x.day}`, kind: "hello" as const, at: x.when.toISOString(), title: HELLO_TITLE, body: HELLO_BODY, path: "/hello/" }));
  return { notices };
}
