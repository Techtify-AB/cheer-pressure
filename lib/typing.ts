// Typing rhythm from key timings only, in bursts of real writing. The same rules as the
// desktop app's Rust code (src-tauri/src/rhythm.rs); this copy runs the in-app text box in a
// browser and the tests. Pure code: give it moments ("a key went down", "a key came up",
// "the keyboard repeated a held key"), never keys.
//
// BURSTS. A burst is a run of presses with no gap over 2 s. Only bursts of at least 30
// presses count; a few presses to open something or switch apps are not writing.
//
// MOTOR RHYTHM, NOT THINKING. Inside a counted burst:
// - gaps under 1 s are the motor part of typing: rhythm evenness is their spread (75th
//   minus 25th percentile);
// - gaps of 1 to 2 s are thinking pauses, counted separately per 100 presses and never in the
//   rhythm numbers, so writing that needs more thought does not look like a change in the
//   person;
// - gaps over 2 s end the burst.
// Hold time is the median time a key is held down (holds up to 2 s).
//
// NOT WRITING. Without ever knowing which key it is, a burst that looks like something else
// is not counted. Thresholds chosen from generated samples of ordinary prose, held-key game
// input and shortcut tapping (scripts/typing-samples.mts prints the separation; the same
// samples run in the Rust tests):
// - auto-repeat events above 50 % of key-down events: keys held down ("held keys");
// - median hold above 180 ms: keys held down, as in games ("held keys");
// - more than 20 % of presses made while two or more other keys are still down ("keys at once");
// - fewer than 80 % of gaps under 1 s: scattered presses, such as shortcuts ("too slow").
// Measured on 300 generated samples of each kind (min to max):
//   prose:      repeats 0 to 21 % (a held backspace), median hold 78 to 115 ms, keys at once
//               0 to 3 %, gaps under 1 s 91 to 99 %;
//   game:       repeats 0 (without auto-repeat) or 73 to 85 %, median hold 385 to 733 ms,
//               keys at once 54 to 95 %;
//   shortcuts:  gaps under 1 s 26 to 72 %.
// Each threshold sits between the kinds with room on both sides.
//
// A DAY. One value per measure per day, pooled over the day's counted bursts, and only when
// the day has at least 300 counted presses.

export const BURST_GAP_MS = 2_000;
export const MOTOR_GAP_MS = 1_000;
export const MIN_BURST_PRESSES = 30;
export const MIN_DAY_PRESSES = 300;
/** Holds longer than this are not part of hold time (a key held on purpose, or a lost release). */
export const MAX_HOLD_MS = 2_000;
/** For the held-keys check, holds up to this long still count (and presses this old are let go). */
export const LONG_HOLD_MS = 5_000;
export const MAX_REPEAT_SHARE = 0.5;
export const MAX_MEDIAN_HOLD_MS = 180;
export const MAX_CHORD_SHARE = 0.2;
export const MIN_MOTOR_SHARE = 0.8;
/** The live numbers in the box cover the last minute of counted typing. */
export const LIVE_WINDOW_MS = 60_000;

/** The kind of app in front when a burst started. Never its name or what is in it. */
export type AppKind = "writing" | "code" | "browser" | "game" | "other";

export type NotCounted = "too-short" | "held-keys" | "keys-at-once" | "too-slow" | "game";
export type Verdict = { counted: true } | { counted: false; why: NotCounted };

/** What a burst is made of: counts and durations only. */
export interface Burst {
  kind: AppKind;
  presses: number;
  /** Key-down events that were the keyboard repeating a held key. */
  repeats: number;
  /** Gaps under 1 s between presses, ms. */
  motorGaps: number[];
  /** Gaps of 1 to 2 s between presses. */
  thinking: number;
  /** Every paired hold up to LONG_HOLD_MS, ms. */
  holds: number[];
  /** Presses made while two or more other keys were still down. */
  chordPresses: number;
}

export interface BurstNumbers {
  presses: number;
  /** Spread of the gaps under 1 s, ms (rhythm evenness: higher is more uneven). */
  spreadMs: number | null;
  /** Median hold, ms. */
  holdMs: number | null;
  /** Gaps of 1 to 2 s per 100 presses. */
  thinkingPer100: number | null;
}

export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

const sortNum = (v: number[]) => [...v].sort((a, b) => a - b);

/** The features the not-writing checks look at. */
export function features(b: Burst) {
  const gaps = b.presses > 1 ? b.presses - 1 : 0;
  return {
    repeatShare: b.presses + b.repeats ? b.repeats / (b.presses + b.repeats) : 0,
    medianHold: quantile(sortNum(b.holds), 0.5),
    chordShare: b.presses ? b.chordPresses / b.presses : 0,
    motorShare: gaps ? b.motorGaps.length / gaps : 1,
  };
}

/** Whether a burst counts as writing, and if not, why. Never looks at which key. */
export function verdict(b: Burst): Verdict {
  if (b.kind === "game") return { counted: false, why: "game" };
  const f = features(b);
  if (f.repeatShare > MAX_REPEAT_SHARE || (f.medianHold !== null && f.medianHold > MAX_MEDIAN_HOLD_MS)) {
    return { counted: false, why: "held-keys" };
  }
  if (f.chordShare > MAX_CHORD_SHARE) return { counted: false, why: "keys-at-once" };
  if (b.presses >= 10 && f.motorShare < MIN_MOTOR_SHARE) return { counted: false, why: "too-slow" };
  if (b.presses < MIN_BURST_PRESSES) return { counted: false, why: "too-short" };
  return { counted: true };
}

/** Rhythm numbers from motor gaps, holds and thinking pauses (any number of bursts pooled). */
export function numbers(motorGaps: number[], holds: number[], thinking: number, presses: number): BurstNumbers {
  const g = sortNum(motorGaps);
  const h = sortNum(holds.filter((x) => x >= 0 && x <= MAX_HOLD_MS));
  const q25 = quantile(g, 0.25);
  const q75 = quantile(g, 0.75);
  return {
    presses,
    spreadMs: q25 !== null && q75 !== null ? q75 - q25 : null,
    holdMs: quantile(h, 0.5),
    thinkingPer100: presses ? (thinking / presses) * 100 : null,
  };
}

export const burstNumbers = (b: Burst) => numbers(b.motorGaps, b.holds, b.thinking, b.presses);

/** A day's counted bursts, pooled. Values only when the day has at least 300 counted presses. */
export class DayPool {
  motorGaps: number[] = [];
  holds: number[] = [];
  thinking = 0;
  presses = 0;
  bursts = 0;

  add(b: Burst) {
    if (!verdict(b).counted) return;
    this.motorGaps.push(...b.motorGaps);
    this.holds.push(...b.holds);
    this.thinking += b.thinking;
    this.presses += b.presses;
    this.bursts += 1;
  }

  summary(): BurstNumbers & { bursts: number } {
    const n = numbers(this.motorGaps, this.holds, this.thinking, this.presses);
    const enough = this.presses >= MIN_DAY_PRESSES;
    return {
      presses: this.presses,
      bursts: this.bursts,
      spreadMs: enough ? n.spreadMs : null,
      holdMs: enough ? n.holdMs : null,
      thinkingPer100: enough ? n.thinkingPer100 : null,
    };
  }
}

const emptyBurst = (kind: AppKind): Burst => ({ kind, presses: 0, repeats: 0, motorGaps: [], thinking: 0, holds: [], chordPresses: 0 });

/**
 * Cuts key moments into bursts. Times are ms on one monotonic clock. `kindNow` is asked once
 * when a burst starts (the kind of app in front); the box passes "writing".
 */
export class BurstCollector {
  private current: Burst | null = null;
  private lastPress: number | null = null;
  /** Presses still down, oldest first. */
  private open: number[] = [];

  constructor(private kindNow: () => AppKind = () => "other") {}

  /** A key went down. `repeat` when it is the keyboard repeating a held key. Returns a burst that ended. */
  keyDown(t: number, repeat = false): Burst | null {
    if (repeat) {
      if (this.current) this.current.repeats += 1;
      return null;
    }
    let ended: Burst | null = null;
    if (this.current && this.lastPress !== null && t - this.lastPress > BURST_GAP_MS) ended = this.close();
    if (!this.current) this.current = emptyBurst(this.kindNow());
    const b = this.current;
    if (this.lastPress !== null && b.presses > 0) {
      const gap = t - this.lastPress;
      if (gap < MOTOR_GAP_MS) b.motorGaps.push(gap);
      else if (gap <= BURST_GAP_MS) b.thinking += 1;
    }
    while (this.open.length && t - this.open[0] > LONG_HOLD_MS) this.open.shift();
    if (this.open.length >= 2) b.chordPresses += 1;
    b.presses += 1;
    this.open.push(t);
    this.lastPress = t;
    return ended;
  }

  /** A key came up. It is paired with the oldest press still down (the key is never known). */
  keyUp(t: number) {
    const d = this.open.shift();
    if (d === undefined) return;
    const hold = t - d;
    if (this.current && hold >= 0 && hold <= LONG_HOLD_MS) this.current.holds.push(hold);
  }

  /** Ends the burst if nothing was pressed for over 2 s. Returns it. */
  tick(now: number): Burst | null {
    if (this.current && this.lastPress !== null && now - this.lastPress > BURST_GAP_MS) return this.close();
    return null;
  }

  /** The burst being typed now, or null. */
  now(): Burst | null {
    return this.current;
  }

  lastPressAt(): number | null {
    return this.lastPress;
  }

  /** Ends the burst now (pause, leaving the page). */
  close(): Burst | null {
    const b = this.current;
    this.current = null;
    this.open = [];
    return b;
  }
}

/** Plain words for the live view. */
export function verdictWords(v: Verdict, kind: AppKind, presses: number): string {
  if (v.counted) return `Counting: ${kind === "other" ? "typing" : kind}`;
  switch (v.why) {
    case "too-short":
      return `Not counted yet: too short (${presses} of ${MIN_BURST_PRESSES} presses)`;
    case "held-keys":
      return "Not counted: looks like held keys";
    case "keys-at-once":
      return "Not counted: looks like several keys at once";
    case "too-slow":
      return "Not counted: scattered presses, not writing";
    case "game":
      return "Not counted: a game is in front";
  }
}
