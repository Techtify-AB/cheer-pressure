// The daily question: "How are you today?" with three answers, once a day or as often as
// the person sets. One tap answers and closes it; it can always be dismissed, with no
// reminder the same day. Pure code: when it is due, and the answers as daily values.
//
// - Never in quiet hours. Never twice on one day: an answer or a dismissal that day ends it.
// - If its time passed while the computer was asleep or off, it comes once when the person
//   is next here that day; earlier days are never stacked up.
// - Unanswered days are never counted as low.

import { clockToMinutes, daysBetween, minutesToClock } from "./dates";
import { inQuietHours, quietHoursOf } from "./settings";
import type { DailyAnswer, DailyAnswerValue, DailyQuestionSettings, DayKey, Settings } from "./types";

export const QUESTION = "How are you today?";

export const ANSWERS: { value: DailyAnswerValue; label: string }[] = [
  { value: "good", label: "Good" },
  { value: "okay", label: "Okay" },
  { value: "not-so-good", label: "Not so good" },
];

export const FREQUENCIES: { value: DailyQuestionSettings["every"]; label: string; gapDays: number | null }[] = [
  { value: "off", label: "Off", gapDays: null },
  { value: "day", label: "Every day", gapDays: 1 },
  { value: "other-day", label: "Every other day", gapDays: 2 },
  { value: "twice-week", label: "Twice a week", gapDays: 3 },
  { value: "week", label: "Once a week", gapDays: 7 },
];

export const TIMES: { value: DailyQuestionSettings["when"]; label: string; at: string }[] = [
  { value: "morning", label: "Morning", at: "09:30" },
  { value: "midday", label: "Midday", at: "12:30" },
  { value: "evening", label: "Evening", at: "18:30" },
];

export const DEFAULT_DAILY_QUESTION: DailyQuestionSettings = { every: "day", when: "midday" };

export function dailyQuestionOf(s: Settings): DailyQuestionSettings {
  return { ...DEFAULT_DAILY_QUESTION, ...(s.dailyQuestion ?? {}) };
}

/** The clock time it comes up: the chosen time, moved to the end of quiet hours (plus 30 minutes) if it falls inside them. */
export function questionTime(s: Settings): string {
  const at = TIMES.find((t) => t.value === dailyQuestionOf(s).when)!.at;
  const q = quietHoursOf(s);
  return inQuietHours(clockToMinutes(at), q) ? minutesToClock(clockToMinutes(q.to) + 30) : at;
}

export interface DueInput {
  today: DayKey;
  /** Minutes after midnight, now. */
  minutesNow: number;
  settings: Settings;
  answers: DailyAnswer[];
}

export type DueReason = "due" | "off" | "paused" | "done-today" | "quiet-hours" | "not-yet" | "not-this-day";

/** Whether the question comes up now, and if not, why. */
export function questionDue(i: DueInput): { due: boolean; reason: DueReason } {
  const d = dailyQuestionOf(i.settings);
  const freq = FREQUENCIES.find((f) => f.value === d.every);
  if (!freq?.gapDays) return { due: false, reason: "off" };
  if (i.settings.pausedAll) return { due: false, reason: "paused" };
  if (i.answers.some((a) => a.date === i.today)) return { due: false, reason: "done-today" };
  if (inQuietHours(i.minutesNow, quietHoursOf(i.settings))) return { due: false, reason: "quiet-hours" };
  if (i.minutesNow < clockToMinutes(questionTime(i.settings))) return { due: false, reason: "not-yet" };
  const last = i.answers.filter((a) => a.date < i.today).map((a) => a.date).sort().pop();
  if (last && daysBetween(last, i.today) < freq.gapDays) return { due: false, reason: "not-this-day" };
  return { due: true, reason: "due" };
}

/** Daily values for the rule: 0 good, 1 okay, 2 not so good. Dismissed days have no value. */
export const ANSWER_VALUE: Record<DailyAnswerValue, number> = { good: 0, okay: 1, "not-so-good": 2 };
export const answerLabel = (v: number) => ANSWERS[Math.max(0, Math.min(2, Math.round(v)))].label;
