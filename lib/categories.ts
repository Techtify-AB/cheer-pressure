// The four categories as the person sees them: what each input is doing (measuring, off, or
// not connected yet) and one short line per category, for Home, My values and Settings.
// Pure code over the stored data and the evaluation; the categories themselves are SOURCES in
// lib/passive.ts.

import { formatDay } from "./dates";
import { dailyQuestionOf } from "./daily";
import { joinPhrases, LEARNING_DAYS, phoneSleepReplaces, SOURCES, type CategoryId, type Evaluation, type Input, type PassiveMetric } from "./passive";
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
    case "phoneHealth":
      // Only the phone app asks; Health never says whether reading was allowed, so asked counts as on.
      return data.phoneHealth?.askedAt || data.healthNights?.length || data.stepDays?.length ? "measuring" : "not-connected";
    case "reactionCheck":
      // Nothing to switch on: it counts whenever the person does a check (no results yet shows as still learning).
      return "measuring";
  }
}

/** Short words for an input in a category's line. */
const SHORT: Record<string, string> = {
  "phone-health": "your phone's health data",
  steps: "steps from your phone",
  "computer-use": "an estimate from your first and last key press each day",
  movement: "movement from the camera",
  "voice-pace": "pace of the voice",
  typing: "typing rhythm",
  "reaction-check": "the reaction check (experimental)",
  expression: "face movement",
  posture: "posture",
  "voice-tone": "tone of voice",
  "trusted-contact": "contact with the person you trust",
  "daily-answer": "your daily answer",
};

/**
 * One short line per category: since when it stands out, or what it rests on now (inputs with
 * values or measuring, in the category's order: in Energy movement first and typing last).
 */
export function categoryLine(id: CategoryId, data: AppData, e: Evaluation, today: DayKey, paired: boolean): string {
  const changed = e.metrics.filter((m) => m.source === id && m.status === "changed");
  if (changed.length && !e.learning) {
    const since = changed.map((m) => changedSince(m, today)).filter((d): d is string => !!d).sort()[0];
    return `Stands out${since ? ` since ${formatDay(since)}` : ""}`;
  }
  const views = inputViews(id, data, e, paired);
  const on = views.filter((v) => v.kind === "values" || v.kind === "learning").map((v) => SHORT[v.input.id] ?? v.input.label.toLowerCase());
  if (!on.length) {
    if (views.some((v) => v.kind === "off" && v.href === "/settings/#trust")) return "Needs someone you trust";
    return views.some((v) => v.kind === "off") ? "Off" : "Not connected yet";
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
  sleep: ["phoneAsleep", "phoneBedtime", "phoneWake", "quietNight", "firstActivity", "lastActivity"],
  energy: ["steps", "movementLevel", "positionChanges"],
  social: ["contact"],
  mood: ["ownAnswer"],
};

/** Which measure a strip is, in small words under the category's name. */
export const MEASURE_WORDS: Partial<Record<PassiveKey, string>> = {
  phoneAsleep: "Time asleep (your phone)",
  phoneBedtime: "Bedtime (your phone)",
  phoneWake: "Wake time (your phone)",
  steps: "Steps (your phone)",
  quietNight: "Estimated night (this computer)",
  firstActivity: "The day's start (this computer)",
  lastActivity: "The day's end (this computer)",
  movementLevel: "Movement (camera)",
  reactionTime: "Reaction time (experimental)",
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

/**
 * Every input of a category, in the category's order, each with one honest state: its values
 * (when there are days with a value to compare), "on, still learning", "off" with where to turn
 * it on, or "not connected yet". Nothing is left out because it has no data.
 */
export type InputView =
  | { kind: "values"; input: Input; metrics: PassiveMetric[] }
  | { kind: "learning"; input: Input; days: number }
  | { kind: "off"; input: Input; action: string; rest: string; href: string }
  | { kind: "not-connected"; input: Input };

/** How an input that is off is turned on: the words of the link, the rest of the line, and where it goes. */
const TURN_ON: Record<string, { action: string; rest: string; href: string }> = {
  "phone-health": { action: "Allow sleep and steps", rest: " from your phone's health data. They stay on this phone.", href: "/settings/#measure-sleep" },
  steps: { action: "Allow sleep and steps", rest: " from your phone's health data. They stay on this phone.", href: "/settings/#measure-energy" },
  "computer-use": { action: "Turn on the estimate from this computer", rest: " to see your nights. Only the time of the first and last key press.", href: "/settings/#measure-sleep" },
  movement: { action: "Turn on the camera", rest: " to measure movement. The picture is worked out on this computer.", href: "/settings/#measure-energy" },
  "voice-pace": { action: "Turn on the microphone", rest: " to measure the pace of your voice. No words are recognised.", href: "/settings/#measure-energy" },
  typing: { action: "Turn on typing rhythm", rest: " to measure it. Only the timing of key presses, never which keys.", href: "/settings/#measure-energy" },
  "reaction-check": { action: "Try the reaction check", rest: " (experimental): five taps, about half a minute. One bad night's sleep slows reactions too.", href: "/activities/reaction/" },
  "trusted-contact": { action: "Turn on messages with someone you trust", rest: " to count them, never what they say.", href: "/settings/#measure-social" },
  "daily-answer": { action: "Turn on the daily question", rest: " to add your own answers.", href: "/settings/#daily" },
  expression: { action: "Turn on the camera", rest: " to observe face movement. The picture is worked out on this computer.", href: "/settings/#measure-energy" },
  posture: { action: "Turn on the camera", rest: " to observe posture. The picture is worked out on this computer.", href: "/settings/#measure-energy" },
  "voice-tone": { action: "Turn on the microphone", rest: " to observe tone of voice. No words are recognised.", href: "/settings/#measure-energy" },
};

/** An input in running text: "Only typing is being measured." */
export const INPUT_WORDS: Record<string, string> = {
  "phone-health": "sleep from your phone",
  steps: "steps",
  "computer-use": "the estimate from this computer",
  movement: "movement",
  "voice-pace": "the pace of your voice",
  typing: "typing",
  "reaction-check": "the reaction check",
  "trusted-contact": "contact with the person you trust",
  "daily-answer": "your own answers",
  expression: "face movement",
  posture: "posture",
  "voice-tone": "tone of voice",
};

export function inputViews(id: CategoryId, data: AppData, e: Evaluation, paired: boolean): InputView[] {
  const cat = SOURCES.find((c) => c.id === id)!;
  return cat.inputs.map((input): InputView => {
    if (!input.setting) return { kind: "not-connected", input };
    // On the phone, the phone's own nights replace this estimate as Sleep's source (there is no computer to read there).
    if (input.id === "computer-use" && phoneSleepReplaces(data, e.today)) return { kind: "not-connected", input };
    const metrics = e.metrics.filter((m) => input.measures.includes(m.key));
    const withData = metrics.filter((m) => m.points.length > 0);
    const state = inputState(input, data, paired);
    if (input.setting === "phoneHealth" && state === "not-connected" && !withData.length) return { kind: "not-connected", input };
    if (withData.some((m) => m.status !== "learning")) return { kind: "values", input, metrics: withData };
    const days = Math.min(LEARNING_DAYS, Math.max(0, ...metrics.map((m) => m.points.length)));
    if (state === "measuring" || withData.length) return { kind: "learning", input, days };
    if (input.setting === "contact" && sourcesOf(data.settings).contact && !data.settings.pausedAll) {
      return { kind: "off", input, action: "Invite someone you trust", rest: " to count your messages with them, never what they say.", href: "/settings/#trust" };
    }
    return { kind: "off", input, ...TURN_ON[input.id] };
  });
}

/**
 * The category's opening sentence. Never the category described by its one available input: with
 * only typing, Energy says "Only typing is being measured. Turn on the camera to add movement."
 */
export function categoryOpening(id: CategoryId, views: InputView[], e: Evaluation): string {
  const phrases = e.metrics.filter((m) => m.source === id && m.status === "changed" && m.phrase).map((m) => m.phrase!);
  if (phrases.length && !e.learning) {
    const t = joinPhrases(phrases);
    return `Over the last week ${t} than your usual.`;
  }
  const active = views.filter((v) => v.kind === "values" || v.kind === "learning");
  const off = views.filter((v): v is Extract<InputView, { kind: "off" }> => v.kind === "off");
  const add = off[0] ? ` ${off[0].action} to add ${INPUT_WORDS[off[0].input.id]}.` : "";
  if (!active.length) return `Nothing is measured here yet.${add}`;
  if (active.length === 1 && off.length) return `Only ${INPUT_WORDS[active[0].input.id]} is being measured.${add}`;
  const names = joinPhrases(active.map((v) => INPUT_WORDS[v.input.id]));
  const capital = names.charAt(0).toUpperCase() + names.slice(1);
  if (active.every((v) => v.kind === "learning")) return `${capital}: still learning your usual.`;
  return `${capital}: within your usual over the last week.`;
}
