"use client";

// The daily question, "How are you today?", on Home and in the mascot window's bubble.
// One tap answers and closes it; "Not now" closes it for today with no reminder. "Not so good"
// does not start anything by itself: it shows one gentle line and a quiet "Talk to me".

import { useCallback } from "react";
import { useClockMinutes, useToday } from "@/components/hooks";
import { ANSWERS, QUESTION, questionDue } from "@/lib/daily";
import { saveDailyAnswer } from "@/lib/storage";
import type { AppData, DailyAnswerValue } from "@/lib/types";

/** Whether the daily question is due now, and how to answer or dismiss it. */
export function useDailyQuestion(data: AppData | null) {
  const today = useToday();
  const minutes = useClockMinutes();
  const due =
    !!data?.profile &&
    questionDue({ today, minutesNow: minutes, settings: data.settings, answers: data.dailyAnswers ?? [] }).due;
  const answer = useCallback(
    (value: DailyAnswerValue) => saveDailyAnswer({ date: today, answer: value, dismissed: false, at: new Date().toISOString(), source: "user" }),
    [today],
  );
  const dismiss = useCallback(
    () => saveDailyAnswer({ date: today, answer: null, dismissed: true, at: new Date().toISOString(), source: "user" }),
    [today],
  );
  return { due, answer, dismiss };
}

/** What Cheri says after an answer: a one-line thanks, or a gentle line for "Not so good". */
export function afterAnswer(value: DailyAnswerValue): string {
  return value === "not-so-good" ? "Thanks for telling me. Some days are like that." : "Thanks for telling me.";
}

/** The three answers as one row of buttons. */
export function DailyAnswers({ onAnswer, className = "daily-answers" }: { onAnswer: (v: DailyAnswerValue) => void; className?: string }) {
  return (
    <div className={className} role="group" aria-label={QUESTION}>
      {ANSWERS.map((a) => (
        <button key={a.value} type="button" className="option daily-option" onClick={() => onAnswer(a.value)}>
          {a.label}
        </button>
      ))}
    </div>
  );
}
