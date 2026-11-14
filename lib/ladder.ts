// The ladder after the person answers "Not my best". Owner's decision: first one
// small thing to do, then reaching someone they trust, then the clinic.
//
//   Step 1, right away: one thing from the person's own "What helps you?" list (lib/helps.ts),
//   best first by what was followed by values coming back. "Something else" offers the next one.
//   Step 2, when the measures have still not come back after 2 days: someone you trust.
//   Step 3, when the measures have still not come back after 7 days: the clinic.
//
// "I'd like someone to check in on me" jumps straight to step 2.
// "Not now" at any step is respected for 3 days: nothing is offered in that time.
// While the measures are back in the person's usual range, nothing escalates.
// In quiet hours, or while everything is paused, the companion never speaks up; a step
// can still be seen when the person opens the conversation themselves.
//
// Pure code: given the stored state, today's date, the clock and the passive result,
// it says which step is due. The screens only show it and store the answers.

import { daysBetween, addDays } from "./dates";
import { enoughToAsk, type Evaluation } from "./passive";
import { inQuietHours } from "./settings";
import type { DayKey, LadderState, RoutineId } from "./types";

export const SOMEONE_AFTER_DAYS = 2;
export const CLINIC_AFTER_DAYS = 7;
export const DECLINE_RESPECTED_DAYS = 3;

/** What the companion would bring up next. "ask" is the first "How are you doing?". */
export type Due = "none" | "ask" | "small-thing" | "someone" | "clinic";

export interface LadderInput {
  ladder: LadderState | null | undefined;
  today: DayKey;
  /** Minutes after midnight, now. */
  minutesNow: number;
  quietHours: { from: string; to: string };
  pausedAll: boolean;
  /** The passive rule's result for today. */
  passive: Pick<Evaluation, "askNow" | "changed">;
}

export interface LadderOutcome {
  due: Due;
  /** Whether the companion may speak up about it now (a cue on home and the mascot). */
  speakUp: boolean;
  quiet: boolean;
  reason:
    | "nothing"
    | "rule-asks"
    | "small-thing-waiting"
    | "requested"
    | "declined-recently"
    | "back-to-usual"
    | "too-early"
    | "someone-due"
    | "clinic-due"
    | "done";
  /** True when the measures came back: the caller may close the ladder. */
  close: boolean;
}

/** The measures still stand out the way the rule asks about (enoughToAsk in lib/passive.ts). */
export function stillChanged(p: Pick<Evaluation, "changed">): boolean {
  return enoughToAsk(p.changed);
}

export function isActive(l: LadderState | null | undefined): l is LadderState {
  return !!l && !l.closedOn;
}

function decide(i: LadderInput): Omit<LadderOutcome, "speakUp" | "quiet"> {
  const l = i.ladder;
  if (!isActive(l)) {
    return i.passive.askNow
      ? { due: "ask", reason: "rule-asks", close: false }
      : { due: "none", reason: "nothing", close: false };
  }

  // Step 1 is offered in the same conversation as "Not my best".
  if (l.smallThing && !l.smallThing.answer) return { due: "small-thing", reason: "small-thing-waiting", close: false };
  // The person asked for someone: offered right away, whatever the measures say.
  if (l.someoneRequestedOn && !l.someone?.answer) return { due: "someone", reason: "requested", close: false };

  if (l.declinedOn && daysBetween(l.declinedOn, i.today) < DECLINE_RESPECTED_DAYS) {
    return { due: "none", reason: "declined-recently", close: false };
  }
  if (!stillChanged(i.passive)) return { due: "none", reason: "back-to-usual", close: true };

  const days = daysBetween(l.startedOn, i.today);
  const someoneOffered = !!l.someone?.answer;
  if (l.clinic?.answer === "approve") return { due: "none", reason: "done", close: false };
  if (days >= CLINIC_AFTER_DAYS && someoneOffered) return { due: "clinic", reason: "clinic-due", close: false };
  if (days >= SOMEONE_AFTER_DAYS && l.someone?.answer !== "yes") return { due: "someone", reason: "someone-due", close: false };
  return { due: "none", reason: "too-early", close: false };
}

/** Which step is due, and whether the companion may speak up about it now. */
export function ladderDue(i: LadderInput): LadderOutcome {
  const d = decide(i);
  const quiet = inQuietHours(i.minutesNow, i.quietHours);
  return { ...d, quiet, speakUp: d.due !== "none" && !quiet && !i.pausedAll };
}

// State changes. Each returns a new state; the screen stores it.

/** "Not my best": the ladder starts, and step 1 is offered now. */
export function startAfterNotBest(today: DayKey, routine: RoutineId | null, simulated: boolean): LadderState {
  return { startedOn: today, simulated, smallThing: { routine, offeredOn: today } };
}

/**
 * "Not my best": the ladder starts, and step 1 offers one thing from the person's own list.
 * `choice` is null when nothing on the list is switched on.
 */
export function startWithHelp(today: DayKey, choice: { item: string; label: string; learned: boolean } | null, simulated: boolean): LadderState {
  return { startedOn: today, simulated, smallThing: { routine: null, offeredOn: today, ...(choice ?? {}) } };
}

/** "Something else": the next thing on the list is offered instead, same ladder, same day. */
export function offerNext(l: LadderState, next: { item: string; label: string; learned: boolean }, today: DayKey): LadderState {
  return { ...l, smallThing: { routine: null, offeredOn: today, ...next } };
}

/** "I'd like someone to check in on me": straight to step 2. Keeps a ladder already running. */
export function requestSomeone(l: LadderState | null | undefined, today: DayKey, simulated: boolean): LadderState {
  const base = isActive(l) ? l : { startedOn: today, simulated };
  return { ...base, someoneRequestedOn: today, someone: undefined, declinedOn: undefined };
}

export function answerSmallThing(l: LadderState, answer: "try" | "not-now", today: DayKey): LadderState {
  if (!l.smallThing) return l;
  return {
    ...l,
    smallThing: { ...l.smallThing, answer },
    declinedOn: answer === "not-now" ? today : l.declinedOn,
  };
}

export function answerSomeone(l: LadderState, answer: "yes" | "not-now", today: DayKey): LadderState {
  return {
    ...l,
    someone: { offeredOn: today, answer },
    someoneRequestedOn: undefined,
    declinedOn: answer === "not-now" ? today : l.declinedOn,
  };
}

export function answerReply(l: LadderState, reply: "yes" | "no"): LadderState {
  return l.someone ? { ...l, someone: { ...l.someone, reply } } : l;
}

export function answerClinic(l: LadderState, answer: "approve" | "not-now", today: DayKey): LadderState {
  return { ...l, clinic: { offeredOn: today, answer }, declinedOn: answer === "not-now" ? today : l.declinedOn };
}

export function closeLadder(l: LadderState, today: DayKey): LadderState {
  return { ...l, closedOn: today };
}

/** For the demo control "Skip ahead two days": every date in the ladder moves `days` earlier. */
export function shiftLadder(l: LadderState, days: number): LadderState {
  const s = (d: DayKey | undefined) => (d ? addDays(d, -days) : d);
  return {
    ...l,
    startedOn: addDays(l.startedOn, -days),
    smallThing: l.smallThing && { ...l.smallThing, offeredOn: s(l.smallThing.offeredOn)! },
    someoneRequestedOn: s(l.someoneRequestedOn),
    someone: l.someone && { ...l.someone, offeredOn: s(l.someone.offeredOn)! },
    clinic: l.clinic && { ...l.clinic, offeredOn: s(l.clinic.offeredOn)! },
    declinedOn: s(l.declinedOn),
    closedOn: s(l.closedOn),
  };
}
