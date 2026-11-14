// "A quick reaction check" (experimental): five taps. Wait for the circle to change, then tap
// as fast as you can. Each wait is random, 1 to 3 seconds. A tap that comes too early is
// discarded and that round repeats. The result is the middle (median) of the five times, in ms,
// shown only against the person's own usual, never as a score.
//
// Adapted from the earlier timing taps (git show 816347f^:app/reaction/page.tsx): the same
// phases, the same median, too-early taps not counted. New: the rounds follow on by themselves
// (about 15 s in all), the wait is 1 to 3 s, and the comparison with the person's usual.
// Pure, unit tested in scripts/test-activities.mts.

export const ROUNDS = 5;
export const MIN_WAIT_MS = 1000;
export const MAX_WAIT_MS = 3000;
/** How long a time (or "too soon") stays before the next round starts by itself. */
export const BETWEEN_MS = 700;
/** At least this many earlier results before there is a usual to compare with. */
export const MIN_FOR_USUAL = 5;
/** Within this share of the usual counts as "about the same". */
export const SAME_BAND = 0.1;

export type ReactionPhase = "intro" | "waiting" | "go" | "early" | "between" | "done";

export interface ReactionState {
  phase: ReactionPhase;
  /** The counted times, ms. */
  times: number[];
  /** When the circle changed (ms, any clock), while phase is "go". */
  goAt: number | null;
  /** Too-early taps so far (discarded). */
  early: number;
}

export const initialReaction = (): ReactionState => ({ phase: "intro", times: [], goAt: null, early: 0 });

/** The random wait before the circle changes: 1 to 3 seconds. */
export function waitMs(random: () => number = Math.random): number {
  return Math.round(MIN_WAIT_MS + random() * (MAX_WAIT_MS - MIN_WAIT_MS));
}

/** Start (or repeat) a round: waiting for the change. */
export function arm(state: ReactionState): ReactionState {
  if (state.phase === "done") return state;
  return { ...state, phase: "waiting", goAt: null };
}

/** The circle changes now. Only from waiting. */
export function go(state: ReactionState, now: number): ReactionState {
  if (state.phase !== "waiting") return state;
  return { ...state, phase: "go", goAt: now };
}

/** A tap. Too early: discarded, the round repeats. On time: counted. */
export function tap(state: ReactionState, now: number): ReactionState {
  if (state.phase === "intro") return arm(state);
  if (state.phase === "waiting") return { ...state, phase: "early", early: state.early + 1 };
  if (state.phase === "go" && state.goAt !== null) {
    const times = [...state.times, Math.max(0, Math.round(now - state.goAt))];
    return { ...state, times, goAt: null, phase: times.length >= ROUNDS ? "done" : "between" };
  }
  return state;
}

export function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export type ReactionCompare = "same" | "quicker" | "slower" | "learning";

/** Against the person's own usual: the median of their earlier results (at least five). */
export function compareWithUsual(resultMs: number, earlierMs: number[]): ReactionCompare {
  if (earlierMs.length < MIN_FOR_USUAL) return "learning";
  const usual = median(earlierMs.slice(-20));
  if (resultMs < usual * (1 - SAME_BAND)) return "quicker";
  if (resultMs > usual * (1 + SAME_BAND)) return "slower";
  return "same";
}

export const COMPARE_LINE: Record<ReactionCompare, string> = {
  same: "About the same as your usual.",
  quicker: "A little quicker than your usual.",
  slower: "A little slower than your usual.",
  learning: "Noted. I'm still learning your usual.",
};

/** Offered after an activity at most once a day. */
export function mayOfferReaction(offeredOn: string | undefined, today: string): boolean {
  return offeredOn !== today;
}
