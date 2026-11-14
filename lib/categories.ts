// The four categories as the person sees them: what each input is doing (measuring, off, or
// not connected yet) and one short line per category, for Home, My values and Settings.
// Pure code over the stored data and the evaluation; the categories themselves are SOURCES in
// lib/passive.ts.

import { formatDay } from "./dates";
import { dailyQuestionOf } from "./daily";
import { joinPhrases, SOURCES, type CategoryId, type Evaluation, type Input, type PassiveMetric } from "./passive";
import { changedSince } from "./report";
import { sourcesOf } from "./settings";
import type { AppData, DayKey, PassiveKey } from "./types";

export type InputState = "measuring" | "off" | "not-connected";

/** What an input is doing now. `paired`: a person they trust is connected (lib/trusted.ts). */
export function inputState(input: Input, data: AppData, paired: boolean): InputState {
  if (!input.setting) return "not-connected";
  const src = sourcesOf(data.settings);
  if (data.settings.pausedAll) return "off";
  switch (input.setting) {
    case "dayRhythm":
      return src.dayRhythm ? "measuring" : "off";
    case "typing":
      return src.typing ? "measuring" : "off";
    case "camera":
      return src.camera ? "measuring" : "off";
    case "microphone":
      return src.microphone ? "measuring" : "off";
    case "contact":
      if (!src.contact) return "off";
      return paired ? "measuring" : "not-connected";
    case "dailyQuestion":
      return dailyQuestionOf(data.settings).every === "off" ? "off" : "measuring";
  }
}

/** Short words for an input in a category's line. */
const SHORT: Record<string, string> = {
  "computer-use": "an estimate from your first and last key press each day",
  typing: "typing rhythm",
  movement: "movement from the camera",
  "voice-pace": "pace of the voice",
  expression: "face movement",
  posture: "posture",
  "voice-tone": "tone of voice",
  "trusted-contact": "messages with someone you trust",
  "daily-answer": "your daily answer",
};

/** One short line per category: what it rests on now, or since when it stands out. */
export function categoryLine(id: CategoryId, data: AppData, e: Evaluation, today: DayKey, paired: boolean): string {
  const cat = SOURCES.find((c) => c.id === id)!;
  const changed = e.metrics.filter((m) => m.source === id && m.status === "changed");
  if (changed.length && !e.learning) {
    const since = changed.map((m) => changedSince(m, today)).filter((d): d is string => !!d).sort()[0];
    return `Stands out${since ? ` since ${formatDay(since)}` : ""}`;
  }
  const on = cat.inputs.filter((i) => inputState(i, data, paired) === "measuring").map((i) => SHORT[i.id] ?? i.label.toLowerCase());
  if (!on.length) {
    const any = cat.inputs.some((i) => i.setting && inputState(i, data, paired) === "off");
    return any ? "Off" : "Not connected yet";
  }
  const text = on.length > 1 ? `${on.slice(0, -1).join(", ")} and ${on[on.length - 1]}` : on[0];
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const CATEGORY_IDS: CategoryId[] = SOURCES.map((c) => c.id);

/**
 * The one measure each category is drawn with in the replay, in order of preference: the first
 * one that has changed, else the first one with days. Energy is movement, never typing; Mood is
 * the person's own answer, never a sensor.
 */
export const STRIP_MEASURES: Record<CategoryId, PassiveKey[]> = {
  sleep: ["quietNight", "firstActivity", "lastActivity"],
  energy: ["movementLevel", "positionChanges"],
  social: ["contact"],
  mood: ["ownAnswer"],
};

/** Which measure a strip is, in small words under the category's name. */
export const MEASURE_WORDS: Partial<Record<PassiveKey, string>> = {
  quietNight: "Estimated night (this computer)",
  firstActivity: "The day's start (this computer)",
  lastActivity: "The day's end (this computer)",
  movementLevel: "Movement (camera)",
  positionChanges: "Position changes (camera)",
  contact: "Contact with the person you trust",
  ownAnswer: "Your daily answers",
};

/** The daily answer's values as rows, index = value (lib/daily.ts ANSWER_VALUE). */
export const ANSWER_LEVELS = ["Good", "Okay", "Not so good"];

export function stripMetric(e: Evaluation, id: CategoryId): PassiveMetric {
  const list = STRIP_MEASURES[id].map((k) => e.metrics.find((m) => m.key === k)!).filter(Boolean);
  return list.find((m) => m.status === "changed") ?? list.find((m) => m.points.length > 0) ?? list[0];
}

/** "Sleep: your nights have been shorter than your usual", or null when the category has not changed. */
export function categorySentence(e: Evaluation, id: CategoryId): string | null {
  const phrases = e.metrics.filter((m) => m.source === id && m.status === "changed" && m.phrase).map((m) => m.phrase!);
  if (!phrases.length) return null;
  return `${SOURCES.find((c) => c.id === id)!.label}: ${joinPhrases(phrases)} than your usual`;
}

/** Where one measure stands against the person's own usual, as one short observation. */
export function againstUsual(m: PassiveMetric | undefined): string {
  if (!m || (!m.points.length && m.status === "learning")) return "No days yet";
  if (m.status === "learning") return "Still learning your usual";
  if (m.status === "no-recent") return "Too few days this week to compare";
  if (m.status === "changed" && m.phrase) return `${m.phrase.charAt(0).toUpperCase()}${m.phrase.slice(1)} than your usual`;
  return "Within your usual";
}
