// "What helps you?": the person's own list, and step one of the ladder chosen from it.
//
// Onboarding asks what helps; the answer is the person's own list (starting items they picked,
// plus their own words). Step one of the ladder suggests ONE thing from it, never one that is
// switched off or removed. Each suggestion is recorded: what was offered, whether it was taken,
// and whether the categories came back within the following days.
//
// The learning is a plain count, small enough to say in one sentence:
//
//   For each thing: how often it was taken (tried), and how often the values came back within
//   CAME_BACK_WITHIN_DAYS days after (back). It is ranked by (back + 1) / (tried + 2).
//
// An untried thing starts at one half. One that was tried and followed by values coming back
// rises above that; one tried without values coming back sinks below it, so untried things still
// get offered before things that did not seem to help (the little exploration). Ties keep the
// order of the person's own list, fewer tries first. Pure code, unit tested in
// scripts/test-helps.mts. The brain (lib/brain.ts) gets the same history and may choose instead.

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

export interface HelpStats {
  id: string;
  /** Times it was taken ("I'll try that") and judged. */
  tried: number;
  /** Of those, times the values came back within CAME_BACK_WITHIN_DAYS days. */
  back: number;
  score: number;
}

/** The counts per item, from the suggestion history. Only judged, taken suggestions count. */
export function statsFor(items: HelpItem[], history: SuggestionRecord[]): HelpStats[] {
  return items.map((h) => {
    const taken = history.filter((r) => r.item === h.id && r.answer === "try" && r.cameBack !== undefined);
    const back = taken.filter((r) => r.cameBack).length;
    return { id: h.id, tried: taken.length, back, score: (back + 1) / (taken.length + 2) };
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

/**
 * The person's own list, ordered by what was followed by values coming back. Never an item that
 * is switched off or removed. `exclude` leaves out items already offered in this conversation.
 */
export function orderByWhatHelped(items: HelpItem[], history: SuggestionRecord[], exclude: string[] = []): HelpOrder {
  const on = items.filter((h) => h.on && !exclude.includes(h.id));
  const stats = new Map(statsFor(on, history).map((s) => [s.id, s]));
  const listIndex = new Map(items.map((h, i) => [h.id, i]));
  const order = [...on].sort((a, b) => {
    const sa = stats.get(a.id)!;
    const sb = stats.get(b.id)!;
    return sb.score - sa.score || sa.tried - sb.tried || listIndex.get(a.id)! - listIndex.get(b.id)!;
  });
  const first = order[0];
  const s = first ? stats.get(first.id)! : null;
  // Said only when the count put it first: it came back after it before, and the plain list
  // order would have offered something else.
  const plainFirst = on[0];
  const learned = !!first && !!s && s.back > 0 && plainFirst?.id !== first.id;
  const reason = learned ? `Last time ${itemPhrase(first)} was followed by better days, so I'm suggesting it first.` : null;
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
