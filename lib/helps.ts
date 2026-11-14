// "What helps you?": the person's own list, and step one of the ladder chosen from it.
//
// Onboarding asks what helps; the answer is the person's own list (starting items they picked,
// plus their own words). Step one of the ladder suggests ONE thing from it, never one that is
// switched off or removed. Each suggestion is recorded: what was offered, whether it was taken,
// what the person said when asked "Did it help?", and whether the categories came back within
// the following days.
//
// The learning is one plain count, small enough to say in one sentence. The person's own answer
// is the main signal; the values coming back is the second, at a quarter of the weight:
//
//   points = yes + 0.5 x "a little" + 0.25 x (times values came back within 3 days)
//   out of = answers (yes, a little, not really) + 0.25 x (times taken and judged)
//   score  = (points + 1) / (out of + 2)
//
// An untried thing starts at one half. One the person said helped rises above that; one they
// said did not help, or that was taken without values coming back, sinks below it, so untried
// things are still offered before things that did not seem to help (the little exploration).
// Ties keep the order of the person's own list, fewer tries first. Answers come from two
// places: "Did it help?" asked here after a suggestion with no activity behind it, and the
// activity library's own "Did that help?" (a FeedbackByItem, see below). Pure code, unit tested
// in scripts/test-helps.mts. The brain (lib/brain.ts) gets the same history and may choose instead.

import { activityHelpStats } from "./activities/feedback";
import { activityForHelp } from "./activities/index";
import { daysBetween } from "./dates";
import { routinesOf } from "./settings";
import type { AppData, DayKey, HelpItem, LadderState, RoutineId, SuggestionRecord } from "./types";

/** The starting list, from the challenge's own words. `phrase` is used in a sentence. */
export const STARTING_HELPS: { id: string; label: string; phrase: string; suggestion: string }[] = [
  { id: "outdoors", label: "Being outdoors or in nature", phrase: "time outdoors", suggestion: "Step outside for a while today, a park or just the street, at whatever pace feels fine." },
  { id: "music", label: "Music", phrase: "music", suggestion: "Put on some music you like while you do something ordinary." },
  { id: "game", label: "A game", phrase: "a game", suggestion: "Play a game you like for a little while." },
  { id: "light", label: "Light in the morning", phrase: "morning light", suggestion: "Get some daylight within an hour of waking, even ten minutes by a window counts." },
  { id: "moving", label: "Moving your body", phrase: "moving your body", suggestion: "Move your body a little today, a stretch or a short walk is plenty." },
  { id: "making", label: "Making or cooking something", phrase: "making or cooking something", suggestion: "Make or cook something small today, nothing fancy." },
  { id: "watching", label: "Something to watch or look at", phrase: "something to watch", suggestion: "Find something nice to watch or look at for a while." },
  { id: "talking", label: "Talking with someone", phrase: "talking with someone", suggestion: "Call or message someone you like today, just to say hello." },
];

/** How many days after a suggestion was taken the values may take to come back and still count. */
export const CAME_BACK_WITHIN_DAYS = 3;
/** At most this many of the person's own items. */
export const MAX_OWN_HELPS = 6;

const STARTING = new Map(STARTING_HELPS.map((h) => [h.id, h]));

/** The earlier routines, as starting items, for people who set up before "What helps you?". */
const FROM_ROUTINE: Record<RoutineId, string> = {
  walk: "outdoors",
  "morning-light": "light",
  music: "music",
  "call-someone": "talking",
  "regular-bedtime": "",
};

/** The starting list with nothing picked. */
export function startingList(pick: string[] = []): HelpItem[] {
  return STARTING_HELPS.map((h) => ({ id: h.id, label: h.label, on: pick.includes(h.id), own: false }));
}

/**
 * The person's own list. Before onboarding asked, it is made from the earlier routines: every
 * starting item on, except those whose routine the person had switched off.
 */
export function helpsOf(data: Pick<AppData, "helps" | "settings">): HelpItem[] {
  if (data.helps) return data.helps;
  const routines = routinesOf(data.settings);
  const off = new Set(Object.entries(routines).filter(([, on]) => !on).map(([id]) => FROM_ROUTINE[id as RoutineId]).filter(Boolean));
  return STARTING_HELPS.map((h) => ({ id: h.id, label: h.label, on: !off.has(h.id), own: false }));
}

/** Adds one of the person's own, if it is new and there is room. Returns the list unchanged otherwise. */
export function addOwn(list: HelpItem[], text: string, id: string): HelpItem[] {
  const label = text.trim().replace(/\s+/g, " ").slice(0, 60);
  if (!label) return list;
  if (list.some((h) => h.label.toLowerCase() === label.toLowerCase())) {
    return list.map((h) => (h.label.toLowerCase() === label.toLowerCase() ? { ...h, on: true } : h));
  }
  if (list.filter((h) => h.own).length >= MAX_OWN_HELPS) return list;
  return [...list, { id: `own-${id}`, label, on: true, own: true }];
}

/** The suggestion sentence for one item. */
export function suggestionText(item: Pick<HelpItem, "id" | "label" | "own">): string {
  const s = STARTING.get(item.id);
  if (s) return s.suggestion;
  return `You said "${item.label}" helps you. Maybe a little of that today?`;
}

/** How the item reads inside a sentence. */
export function itemPhrase(item: Pick<HelpItem, "id" | "label">): string {
  const s = STARTING.get(item.id);
  return s ? s.phrase : `"${item.label}"`;
}

/** What the person answered about one item elsewhere (the activity library's "Did that help?"). */
export interface ItemFeedback {
  yes: number;
  aLittle: number;
  notReally: number;
}
/** Per HelpItem id. */
export type FeedbackByItem = Record<string, ItemFeedback>;

/**
 * The activity library's answers to "Did that help?", per HelpItem. The library keeps them per
 * activity; this is where they are mapped onto the person's own list.
 */
export function feedbackFromActivities(data: Pick<AppData, "helps" | "settings" | "activitiesDone">): FeedbackByItem {
  const stats = activityHelpStats(data.activitiesDone ?? []);
  const out: FeedbackByItem = {};
  for (const h of helpsOf(data)) {
    const a = activityForHelp(h.id, h.label);
    const st = a ? stats[a] : undefined;
    if (st && st.answered) out[h.id] = { yes: st.yes, aLittle: st.aLittle, notReally: st.no };
  }
  return out;
}

/** The weight of "the values came back" next to the person's own answer. */
export const CAME_BACK_WEIGHT = 0.25;

export interface HelpStats {
  id: string;
  /** Times it was taken ("I'll try that") and judged. */
  tried: number;
  /** Of those, times the values came back within CAME_BACK_WITHIN_DAYS days. */
  back: number;
  /** Times the person answered "Did it help?" (yes, a little, not really; skips leave out). */
  asked: number;
  /** Of those, yes or a little. */
  helped: number;
  score: number;
}

/** The counts per item, from the suggestion history and the person's own answers. */
export function statsFor(items: HelpItem[], history: SuggestionRecord[], feedback: FeedbackByItem = {}): HelpStats[] {
  return items.map((h) => {
    const mine = history.filter((r) => r.item === h.id);
    const taken = mine.filter((r) => r.answer === "try" && r.cameBack !== undefined);
    const back = taken.filter((r) => r.cameBack).length;
    const f = feedback[h.id] ?? { yes: 0, aLittle: 0, notReally: 0 };
    const yes = f.yes + mine.filter((r) => r.helped === "yes").length;
    const little = f.aLittle + mine.filter((r) => r.helped === "a-little").length;
    const not = f.notReally + mine.filter((r) => r.helped === "not-really").length;
    const asked = yes + little + not;
    const points = yes + 0.5 * little + CAME_BACK_WEIGHT * back;
    const outOf = asked + CAME_BACK_WEIGHT * taken.length;
    return { id: h.id, tried: taken.length, back, asked, helped: yes + little, score: (points + 1) / (outOf + 2) };
  });
}

export interface HelpOrder {
  /** The items to offer, best first: only those switched on. */
  order: HelpItem[];
  /** The plain line when the first one is first because of what followed it before, else null. */
  reason: string | null;
  /** True when the first one is there because of what was learned. */
  learned: boolean;
}

/** The one plain line when a learned choice is used: what it rests on. */
export function learnedLine(item: Pick<HelpItem, "id" | "label">, s?: Pick<HelpStats, "asked" | "helped" | "back">): string {
  if (s && s.asked > 0 && s.helped > 0) {
    return `You've said ${itemPhrase(item)} helped ${s.helped} of ${s.asked} ${s.asked === 1 ? "time" : "times"}, so I'm suggesting it first.`;
  }
  return `Last time ${itemPhrase(item)} was followed by better days, so I'm suggesting it first.`;
}

/**
 * The person's own list, ordered by the count above. Never an item that is switched off or
 * removed. `exclude` leaves out items already offered in this conversation.
 */
export function orderByWhatHelped(items: HelpItem[], history: SuggestionRecord[], exclude: string[] = [], feedback: FeedbackByItem = {}): HelpOrder {
  const on = items.filter((h) => h.on && !exclude.includes(h.id));
  const stats = new Map(statsFor(on, history, feedback).map((s) => [s.id, s]));
  const listIndex = new Map(items.map((h, i) => [h.id, i]));
  const order = [...on].sort((a, b) => {
    const sa = stats.get(a.id)!;
    const sb = stats.get(b.id)!;
    return sb.score - sa.score || sa.tried + sa.asked - (sb.tried + sb.asked) || listIndex.get(a.id)! - listIndex.get(b.id)!;
  });
  const first = order[0];
  const s = first ? stats.get(first.id)! : null;
  // Said only when the count put it first: the person said it helped, or values came back after
  // it, and the plain list order would have offered something else.
  const plainFirst = on[0];
  const learned = !!first && !!s && (s.helped > 0 || s.back > 0) && plainFirst?.id !== first.id;
  const reason = learned ? learnedLine(first, s!) : null;
  return { order, reason, learned };
}

/**
 * Judges the suggestions that were taken: true when the ladder closed because the values came
 * back within CAME_BACK_WITHIN_DAYS days of the suggestion, false when that many days passed
 * without. Returns the history with the new judgements, and whether anything changed.
 */
export function judgeSuggestions(
  history: SuggestionRecord[],
  ladder: LadderState | null | undefined,
  today: DayKey,
): { history: SuggestionRecord[]; changed: boolean } {
  let changed = false;
  const out = history.map((r) => {
    if (r.answer !== "try" || r.cameBack !== undefined) return r;
    const sameLadder = ladder && ladder.startedOn === r.ladderStartedOn;
    const closedOn = sameLadder ? ladder.closedOn : undefined;
    if (closedOn && daysBetween(r.offeredOn, closedOn) <= CAME_BACK_WITHIN_DAYS) {
      changed = true;
      return { ...r, cameBack: true, judgedOn: closedOn };
    }
    if (daysBetween(r.offeredOn, today) > CAME_BACK_WITHIN_DAYS) {
      changed = true;
      return { ...r, cameBack: false, judgedOn: today };
    }
    return r;
  });
  return { history: out, changed };
}

// --- Recording what was offered ------------------------------------------------------------

/** One new suggestion in the history, not answered yet. */
export function recordOffer(
  history: SuggestionRecord[],
  o: { id: string; ladderStartedOn: DayKey; today: DayKey; item: HelpItem; learned: boolean; simulated: boolean },
): SuggestionRecord[] {
  const r: SuggestionRecord = {
    id: o.id,
    ladderStartedOn: o.ladderStartedOn,
    offeredOn: o.today,
    item: o.item.id,
    label: o.item.label,
    answer: null,
    learned: o.learned,
    simulated: o.simulated,
  };
  return [...history.filter((h) => h.id !== o.id), r];
}

/** The person's answer to one suggestion. An answered one keeps its first answer. */
export function answerOffer(history: SuggestionRecord[], id: string, answer: "try" | "other" | "not-now", extra: { at?: string; viaActivity?: boolean } = {}): SuggestionRecord[] {
  return history.map((r) =>
    r.id === id && r.answer === null ? { ...r, answer, ...(answer === "try" ? { answeredAt: extra.at ?? new Date().toISOString(), viaActivity: !!extra.viaActivity } : {}) } : r,
  );
}

/** Item ids already offered in this ladder (so "Something else" moves on). */
export function offeredIn(history: SuggestionRecord[], ladderStartedOn: DayKey): string[] {
  return history.filter((r) => r.ladderStartedOn === ladderStartedOn).map((r) => r.item);
}

/** The newest suggestion of this ladder still waiting for an answer, if any. */
export function openOffer(history: SuggestionRecord[], ladderStartedOn: DayKey): SuggestionRecord | null {
  return [...history].reverse().find((r) => r.ladderStartedOn === ladderStartedOn && r.answer === null) ?? null;
}

/** The plain count for one item, for Settings: "You said it helped 2 of 3 times. Followed by better days once." */
export function countLine(s: HelpStats): string | null {
  if (!s.tried && !s.asked) return null;
  const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
  const said = s.asked ? `You said it helped ${s.helped} of ${s.asked} ${s.asked === 1 ? "time" : "times"}.` : "";
  const back = s.tried ? (s.back ? `Followed by better days ${times(s.back)}.` : `Values did not come back soon after (${times(s.tried)}).`) : "";
  return [said, back].filter(Boolean).join(" ");
}

// --- "Did it help?" for suggestions with no activity behind them ---------------------------

export const HELPED_ANSWERS: { value: "yes" | "a-little" | "not-really"; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "a-little", label: "A little" },
  { value: "not-really", label: "Not really" },
];

/** Asked no sooner than this after "I'll try that", so it comes the next time the app is opened. */
export const ASK_HELPED_AFTER_MS = 30 * 60_000;

/**
 * The one suggestion to ask "Did it help?" about now: taken ("I'll try that") today or
 * yesterday, at least ASK_HELPED_AFTER_MS ago, with no activity behind it (the activity asks
 * itself), and not asked yet. Asked once: any answer, or "Skip", ends it.
 */
export function helpedQuestionDue(history: SuggestionRecord[], now: Date, today: DayKey): SuggestionRecord | null {
  const due = history.filter((r) => {
    if (r.answer !== "try" || r.viaActivity || r.helped || r.simulated) return false;
    const d = daysBetween(r.offeredOn, today);
    if (d < 0 || d > 1) return false;
    const at = r.answeredAt ? Date.parse(r.answeredAt) : NaN;
    return Number.isFinite(at) ? now.getTime() - at >= ASK_HELPED_AFTER_MS : d >= 1;
  });
  return due[due.length - 1] ?? null;
}

/** Stores the answer to "Did it help?" (or "skipped"). */
export function answerHelped(history: SuggestionRecord[], id: string, helped: NonNullable<SuggestionRecord["helped"]>): SuggestionRecord[] {
  return history.map((r) => (r.id === id && !r.helped ? { ...r, helped } : r));
}

/** "Did a walk outdoors help?" in plain words. */
export function helpedQuestion(r: Pick<SuggestionRecord, "item" | "label">): string {
  return `Did ${itemPhrase({ id: r.item, label: r.label })} help?`;
}
