// "What helps you?": the person's own list, and step one of the ladder chosen from it.
//
// Onboarding asks what helps; the answer is the person's own list (starting items they picked,
// plus their own words). Step one of the ladder suggests ONE thing from it, never one that is
// switched off or removed. Each suggestion is recorded: what was offered and whether it was
// taken.
//
// Cheri learns what helps from two signals, and the values come first:
//
// 1. THE VALUES (the main signal, Cheri learns it by herself). For each time something was done
//    on day D (an activity, or a suggestion taken that has no activity behind it), the person's
//    daily values in the four categories are compared for the three days before (D-3 to D-1) and
//    the three days after (D+1 to D+3). Every measure with values counts, each as its distance
//    from the person's own usual range (the 10th to 90th percentile of the 28 days before the
//    week before D, in widths of that range, 0 inside it), averaged per day and then over the
//    days. "Followed by better days" when the average after is at least CLEAR_CHANGE smaller,
//    "followed by worse days" when at least CLEAR_CHANGE larger, otherwise "no clear change".
//    "Too early to tell" until the three days after have passed, or with fewer than
//    MIN_DAYS_EACH_SIDE days with values on either side. "Nothing to improve" when the days
//    before were already within CLEAR_CHANGE of the usual range (nothing could get clearly
//    better); it does not count for or against. Pure: followedBy() below, unit tested in
//    scripts/test-helps.mts.
// 2. THE PERSON'S OWN ANSWER (the second signal): "Did that help?" after an activity
//    (lib/activities/feedback.ts) and "Did it help?" once on Home after a suggestion with no
//    activity behind it. Never required, never repeated.
//
// One explainable score per thing, the same for step one and the activity library:
//
//   points = 1 x better days  +  0.5 x "Yes"  +  0.25 x "A little"            (WEIGHT below)
//   out of = 1 x judged times +  0.5 x every answer (Yes, A little, Not really)
//   score  = (points + 1) / (out of + 2)
//
// "Judged times" are better + worse + no clear change; "too early to tell" and "nothing to
// improve" count for nothing. An untried thing starts at one half. Better days or a "Yes" lift
// it above that; worse or unchanged days, or "Not really", sink it below, so untried things are
// still offered before things that did not seem to help (the little exploration). Ties keep the
// order of the person's own list, fewer tries first.
//
// Honest about what it is: with one person and a handful of tries this is weak evidence. Days
// move for many reasons, so the order is a gentle preference, not a finding. The two signals are
// always shown apart ("Followed by better days 3 of 4 times. You said it helped twice."), and a
// disagreement between them is said plainly. The brain (lib/brain.ts) gets both histories and
// may choose instead.

import { activityHelpStats } from "./activities/feedback";
import { activityForHelp } from "./activities/index";
import { addDays, daysBetween } from "./dates";
import { evaluatePassive, MIN_USUAL_DAYS, quantile, RECENT_DAYS, USUAL_DAYS, BAND } from "./passive";
import { forRule, routinesOf } from "./settings";
import type { AppData, DayKey, HelpItem, RoutineId, SuggestionRecord } from "./types";

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

// --- 1. Learning from the values -----------------------------------------------------------

/** Days compared before and after the day something was done. */
export const BEFORE_DAYS = 3;
export const AFTER_DAYS = 3;
/** Each side needs at least this many days with any value, else it is too early to tell. */
export const MIN_DAYS_EACH_SIDE = 2;
/**
 * How much the average distance from usual must change to count, in widths of the person's
 * usual range: a quarter of the range, the same widening the rule itself uses (CHANGE_TESTS
 * medianWide in lib/passive.ts). Also the "already usual" line for "nothing to improve".
 */
export const CLEAR_CHANGE = 0.25;
/** One measure far outside its range counts at most this much, so one odd value cannot carry a day. */
export const MAX_DISTANCE = 3;

/** What followed one time something was done. */
export type Followed = "better" | "worse" | "no-change" | "too-early" | "nothing-to-improve";

/** One time something was done. `thing` is "activity:<id>" or "help:<item id>". */
export interface DoneThing {
  thing: string;
  date: DayKey;
}

/** One measure's daily values (one per day), as lib/passive.ts keeps them. */
export interface ValueSeries {
  key: string;
  points: { date: DayKey; value: number }[];
}

export interface Occasion {
  thing: string;
  date: DayKey;
  followed: Followed;
  /** Average distance from usual in the days before and after (0 is inside the usual range), or null. */
  before: number | null;
  after: number | null;
  daysBefore: number;
  daysAfter: number;
  /** The share of the credit: 1, or 1/2 when one other thing was done within the same three days. */
  share: number;
}

interface Usual {
  low: number;
  high: number;
  width: number;
}

/** The person's usual range for one measure as it was on day D: the 28 days before the week before D. */
function usualOn(points: ValueSeries["points"], day: DayKey): Usual | null {
  const vals = points
    .filter((p) => {
      const age = daysBetween(p.date, day);
      return age >= RECENT_DAYS && age < RECENT_DAYS + USUAL_DAYS;
    })
    .map((p) => p.value)
    .sort((a, b) => a - b);
  if (vals.length < MIN_USUAL_DAYS) return null;
  const low = quantile(vals, BAND.low);
  const high = quantile(vals, BAND.high);
  // A measure that hardly varies (every answer "Good"): the whole spread, or one unit.
  const width = high - low || vals[vals.length - 1] - vals[0] || 1;
  return { low, high, width };
}

/** Distance from the usual range in widths of it: 0 inside, growing outside, at most MAX_DISTANCE. */
export function distanceFromUsual(value: number, usual: Usual): number {
  const d = value < usual.low ? usual.low - value : value > usual.high ? value - usual.high : 0;
  return Math.min(MAX_DISTANCE, d / usual.width);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * What followed each time something was done, judged from the values alone. Pure.
 *
 * - The same thing done again within AFTER_DAYS of a time already counted is part of that time
 *   (a walk every day is one stretch, not three overlapping tries).
 * - Credit is shared: when other things were done within AFTER_DAYS of day D, the days that
 *   follow belong to all of them, so each gets an equal share. Two different things in the same
 *   three days: half each; three: a third each.
 */
export function followedBy(done: DoneThing[], series: ValueSeries[], today: DayKey): Occasion[] {
  const unique = new Map<string, DoneThing>();
  for (const d of done) unique.set(`${d.thing}|${d.date}`, d);
  const all = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || a.thing.localeCompare(b.thing));
  const lastKept = new Map<string, DayKey>();
  const kept: DoneThing[] = [];
  for (const d of all) {
    const last = lastKept.get(d.thing);
    if (last && daysBetween(last, d.date) <= AFTER_DAYS) continue;
    kept.push(d);
    lastKept.set(d.thing, d.date);
  }
  const byDate = series.map((s) => ({ points: s.points, at: new Map(s.points.map((p) => [p.date, p.value])) }));

  return kept.map((d) => {
    const others = new Set(all.filter((o) => o.thing !== d.thing && Math.abs(daysBetween(d.date, o.date)) <= AFTER_DAYS).map((o) => o.thing));
    const share = 1 / (1 + others.size);
    const base = { thing: d.thing, date: d.date, share };
    if (daysBetween(d.date, today) <= AFTER_DAYS) {
      return { ...base, followed: "too-early" as const, before: null, after: null, daysBefore: 0, daysAfter: 0 };
    }
    const usual = byDate.map((s) => usualOn(s.points, d.date));
    const dayDistance = (day: DayKey): number | null => {
      const ds: number[] = [];
      byDate.forEach((s, i) => {
        const u = usual[i];
        const v = s.at.get(day);
        if (u && v !== undefined && Number.isFinite(v)) ds.push(distanceFromUsual(v, u));
      });
      return ds.length ? mean(ds) : null;
    };
    const side = (from: number, to: number) => {
      const out: number[] = [];
      for (let k = from; k <= to; k++) {
        const v = dayDistance(addDays(d.date, k));
        if (v !== null) out.push(v);
      }
      return out;
    };
    const b = side(-BEFORE_DAYS, -1);
    const a = side(1, AFTER_DAYS);
    const counts = { daysBefore: b.length, daysAfter: a.length };
    if (b.length < MIN_DAYS_EACH_SIDE || a.length < MIN_DAYS_EACH_SIDE) {
      return { ...base, ...counts, followed: "too-early" as const, before: b.length ? mean(b) : null, after: a.length ? mean(a) : null };
    }
    const before = mean(b);
    const after = mean(a);
    const followed: Followed =
      before < CLEAR_CHANGE ? "nothing-to-improve" : after <= before - CLEAR_CHANGE ? "better" : after >= before + CLEAR_CHANGE ? "worse" : "no-change";
    return { ...base, ...counts, followed, before, after };
  });
}

/** Everything done, as DoneThings: the activities, and suggestions taken that have no activity behind them. */
export function doneThings(data: Pick<AppData, "activitiesDone" | "suggestions">): DoneThing[] {
  return [
    ...(data.activitiesDone ?? []).map((r) => ({ thing: `activity:${r.activity}`, date: r.date })),
    ...(data.suggestions ?? []).filter((r) => r.answer === "try" && !r.viaActivity).map((r) => ({ thing: `help:${r.item}`, date: r.offeredOn })),
  ];
}

/** Every measure with values, as the rule sees them (switched-off inputs left out). */
export function valueSeries(data: AppData, today: DayKey): ValueSeries[] {
  return evaluatePassive(forRule(data), today)
    .metrics.filter((m) => m.points.length)
    .map((m) => ({ key: m.key, points: m.points }));
}

/** The values-based history for this person, for step one, the library and the brain. */
export function learnFromValues(data: AppData, today: DayKey): Occasion[] {
  return followedBy(doneThings(data), valueSeries(data, today), today);
}

export interface FollowedStats {
  /** Weighted by each time's share of the credit. */
  better: number;
  worse: number;
  noChange: number;
  /** better + worse + no clear change, weighted. */
  counted: number;
  /** Whole times, for the sentences. */
  betterTimes: number;
  worseTimes: number;
  countedTimes: number;
  tooEarly: number;
  nothingToImprove: number;
}

/** The values-based counts for one or more things (a list item and the activity behind it). */
export function followedStats(occasions: Occasion[], things: string[]): FollowedStats {
  const s: FollowedStats = { better: 0, worse: 0, noChange: 0, counted: 0, betterTimes: 0, worseTimes: 0, countedTimes: 0, tooEarly: 0, nothingToImprove: 0 };
  for (const o of occasions) {
    if (!things.includes(o.thing)) continue;
    if (o.followed === "too-early") s.tooEarly++;
    else if (o.followed === "nothing-to-improve") s.nothingToImprove++;
    else {
      s.counted += o.share;
      s.countedTimes++;
      if (o.followed === "better") {
        s.better += o.share;
        s.betterTimes++;
      } else if (o.followed === "worse") {
        s.worse += o.share;
        s.worseTimes++;
      } else s.noChange += o.share;
    }
  }
  return s;
}

// --- 2. The person's own answer --------------------------------------------------------------

/** What the person answered about one thing (the activity's "Did that help?", Home's "Did it help?"). */
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

// --- Both together ----------------------------------------------------------------------------

/**
 * The weights: the values are the main signal, the person's answer the second. A time followed
 * by better days counts 1 out of 1; a "Yes" 0.5 out of 0.5, "A little" 0.25 out of 0.5, "Not
 * really" 0 out of 0.5 (so it counts against).
 */
export const WEIGHT = { betterDays: 1, yes: 0.5, aLittle: 0.25, answer: 0.5 };

export function combinedScore(v: Pick<FollowedStats, "better" | "counted">, a: ItemFeedback): number {
  const points = WEIGHT.betterDays * v.better + WEIGHT.yes * a.yes + WEIGHT.aLittle * a.aLittle;
  const outOf = v.counted + WEIGHT.answer * (a.yes + a.aLittle + a.notReally);
  return (points + 1) / (outOf + 2);
}

const NO_ANSWERS: ItemFeedback = { yes: 0, aLittle: 0, notReally: 0 };

export interface HelpStats {
  id: string;
  values: FollowedStats;
  answers: ItemFeedback;
  score: number;
}

/** What one list item is judged by: its own suggestions, and the activity that fits it. */
export function thingsFor(item: Pick<HelpItem, "id" | "label">): string[] {
  const a = activityForHelp(item.id, item.label);
  return a ? [`help:${item.id}`, `activity:${a}`] : [`help:${item.id}`];
}

/** What the person answered per item: Home's "Did it help?" on the suggestions, plus the activity library's. */
function answersFor(id: string, history: SuggestionRecord[], feedback: FeedbackByItem): ItemFeedback {
  const f = feedback[id] ?? NO_ANSWERS;
  const mine = history.filter((r) => r.item === id);
  return {
    yes: f.yes + mine.filter((r) => r.helped === "yes").length,
    aLittle: f.aLittle + mine.filter((r) => r.helped === "a-little").length,
    notReally: f.notReally + mine.filter((r) => r.helped === "not-really").length,
  };
}

export interface Learned {
  /** The values-based history (learnFromValues). */
  occasions?: Occasion[];
  /** The suggestion history (for Home's "Did it help?" answers). */
  history?: SuggestionRecord[];
  /** The activity library's answers, per item (feedbackFromActivities). */
  feedback?: FeedbackByItem;
}

/** Both signals and the score, per item. */
export function statsFor(items: HelpItem[], learned: Learned = {}): HelpStats[] {
  const occasions = learned.occasions ?? [];
  return items.map((h) => {
    const values = followedStats(occasions, thingsFor(h));
    const answers = answersFor(h.id, learned.history ?? [], learned.feedback ?? {});
    return { id: h.id, values, answers, score: combinedScore(values, answers) };
  });
}

/** Everything step one needs from storage, in one call. */
export function learnedFrom(data: AppData, today: DayKey): Required<Learned> {
  return { occasions: learnFromValues(data, today), history: data.suggestions ?? [], feedback: feedbackFromActivities(data) };
}

// --- Words -----------------------------------------------------------------------------------

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
const said = (a: ItemFeedback) => ({ asked: a.yes + a.aLittle + a.notReally, helped: a.yes + a.aLittle });

/** The values, in one line: "Followed by better days 3 of 4 times." Null with no history. */
export function valuesLine(v: FollowedStats): string | null {
  if (v.countedTimes) {
    if (v.countedTimes === 1) return v.betterTimes ? "Followed by better days last time." : "Not followed by better days last time.";
    return v.betterTimes ? `Followed by better days ${v.betterTimes} of ${v.countedTimes} times.` : `Not followed by better days so far (${v.countedTimes} times).`;
  }
  if (v.tooEarly) return "Too early to tell.";
  if (v.nothingToImprove) return "Done on days that were already usual, so nothing to tell yet.";
  return null;
}

/** The person's own answers, quoted as theirs: "You said it helped twice." Null without answers. */
export function answerLine(a: ItemFeedback): string | null {
  const { asked, helped } = said(a);
  if (!asked) return null;
  if (!helped) return asked === 1 ? "You said it didn't help much." : `You said it didn't help much (${asked} times).`;
  return helped === asked ? `You said it helped ${times(helped)}.` : `You said it helped ${helped} of ${asked} times.`;
}

/** When the two signals disagree, the one plain line that says so; else null. */
export function disagreementLine(v: FollowedStats, a: ItemFeedback): string | null {
  const { asked, helped } = said(a);
  const saidHelped = helped > 0 && helped * 2 > asked;
  const saidNot = asked > 0 && helped === 0;
  if (saidHelped && v.countedTimes && !v.betterTimes) {
    return v.worseTimes ? "You said this helped, though your days did not move back towards your usual afterwards." : "You said this helped, though your days did not change much afterwards.";
  }
  if (saidNot && v.betterTimes * 2 > v.countedTimes) return "Your days moved back towards your usual afterwards, though you said it didn't help much.";
  return null;
}

/**
 * Both signals, apart: the values first, then what the person said, or the disagreement in one
 * line instead. Empty with no history.
 */
export function followedLines(v: FollowedStats, a: ItemFeedback): string[] {
  const second = disagreementLine(v, a) ?? answerLine(a);
  return [valuesLine(v), second].filter((x): x is string => !!x);
}

/** The plain count for one item, for Settings, or null with no history. */
export function countLine(s: Pick<HelpStats, "values" | "answers">): string | null {
  const lines = followedLines(s.values, s.answers);
  return lines.length ? lines.join(" ") : null;
}

/**
 * Step one's line when a learned choice is used: what it rests on, both signals apart.
 * "After morning light, your days moved back towards your usual 3 of 4 times, and you said it
 * helped twice, so I'm suggesting it first." Never "it helped" as a fact.
 */
export function learnedLine(item: Pick<HelpItem, "id" | "label">, s: Pick<HelpStats, "values" | "answers">): string {
  const phrase = itemPhrase(item);
  const v = s.values;
  const { asked, helped } = said(s.answers);
  const saidHelped = helped > 0;
  const saidNot = asked > 0 && helped === 0;
  const first = "so I'm suggesting it first";
  if (v.betterTimes) {
    const days =
      v.countedTimes === 1
        ? `After ${phrase} last time, your days moved back towards your usual`
        : `After ${phrase}, your days moved back towards your usual ${v.betterTimes} of ${v.countedTimes} times`;
    if (saidHelped) return `${days}, and you said it helped ${times(helped)}, ${first}.`;
    if (saidNot) return `${days}, ${first}, though you said it didn't help much.`;
    return `${days}, ${first}.`;
  }
  if (saidHelped) {
    const base = `You said ${phrase} helped ${times(helped)}, ${first}`;
    return v.countedTimes ? `${base}, though your days did not change much afterwards.` : `${base}.`;
  }
  return `I'm suggesting ${phrase} first.`;
}

// --- Ordering ----------------------------------------------------------------------------------

export interface HelpOrder {
  /** The items to offer, best first: only those switched on. */
  order: HelpItem[];
  /** The plain line when the first one is first because of what was learned, else null. */
  reason: string | null;
  /** True when the first one is there because of what was learned. */
  learned: boolean;
}

/**
 * The person's own list, ordered by the score above. Never an item that is switched off or
 * removed. `exclude` leaves out items already offered in this conversation.
 */
export function orderByWhatHelped(items: HelpItem[], learned: Learned = {}, exclude: string[] = []): HelpOrder {
  const on = items.filter((h) => h.on && !exclude.includes(h.id));
  const stats = new Map(statsFor(on, learned).map((s) => [s.id, s]));
  const listIndex = new Map(items.map((h, i) => [h.id, i]));
  const tries = (s: HelpStats) => s.values.countedTimes + said(s.answers).asked;
  const order = [...on].sort((a, b) => {
    const sa = stats.get(a.id)!;
    const sb = stats.get(b.id)!;
    return sb.score - sa.score || tries(sa) - tries(sb) || listIndex.get(a.id)! - listIndex.get(b.id)!;
  });
  const first = order[0];
  const s = first ? stats.get(first.id)! : null;
  // Said only when what was learned put it first: better days followed it, or the person said it
  // helped, and the plain list order would have offered something else.
  const plainFirst = on[0];
  const learnedFirst = !!first && !!s && s.score > 0.5 && (s.values.betterTimes > 0 || said(s.answers).helped > 0) && plainFirst?.id !== first.id;
  const reason = learnedFirst ? learnedLine(first, s!) : null;
  return { order, reason, learned: learnedFirst };
}

// --- The activity library: the same two signals per activity -----------------------------------

/** Both signals and the score for one activity. */
export function activityStats(id: string, occasions: Occasion[], records: Parameters<typeof activityHelpStats>[0]): HelpStats {
  const st = activityHelpStats(records)[id];
  const answers = st ? { yes: st.yes, aLittle: st.aLittle, notReally: st.no } : NO_ANSWERS;
  const values = followedStats(occasions, [`activity:${id}`]);
  return { id, values, answers, score: combinedScore(values, answers) };
}

/** The activity ids ordered by the same score; ties keep the given order. */
export function orderActivities<T extends string>(ids: T[], occasions: Occasion[], records: Parameters<typeof activityHelpStats>[0]): T[] {
  const score = new Map(ids.map((id) => [id, activityStats(id, occasions, records).score]));
  const index = new Map(ids.map((id, i) => [id, i]));
  return [...ids].sort((a, b) => score.get(b)! - score.get(a)! || index.get(a)! - index.get(b)!);
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
