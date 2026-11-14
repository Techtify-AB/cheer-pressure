// Typing rhythm from timestamps only, in the browser. The same calculation as the
// desktop app's Rust code (src-tauri/src/rhythm.rs), used for the "only in this box"
// text field. Pure code: give it moments, never keys.
//
// - presses: how many key presses
// - median interval: the middle time from one press to the next
// - spread: interquartile range of those times (75th minus 25th percentile)
// - p95 pause: 95th percentile of those times
// - median hold: the middle time from a key going down to a key coming up
//
// Gaps over 5 s are not intervals. The key is never known, so a release is paired
// with the oldest press that is still down.

export const MAX_INTERVAL_MS = 5_000;
export const MAX_HOLD_MS = 2_000;
export const LIVE_WINDOW_MS = 60_000;
export const SESSION_IDLE_MS = 5 * 60_000;
export const MIN_SESSION_PRESSES = 20;

export interface TypingStats {
  presses: number;
  medianIntervalMs: number | null;
  spreadMs: number | null;
  p95PauseMs: number | null;
  medianHoldMs: number | null;
}

export interface TypingSessionEnd {
  firstMs: number;
  lastMs: number;
  stats: TypingStats;
}

export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function typingStats(downs: number[], holds: number[]): TypingStats {
  const intervals: number[] = [];
  for (let i = 1; i < downs.length; i++) {
    const d = downs[i] - downs[i - 1];
    if (d >= 0 && d <= MAX_INTERVAL_MS) intervals.push(d);
  }
  intervals.sort((a, b) => a - b);
  const h = holds.filter((x) => x >= 0 && x <= MAX_HOLD_MS).sort((a, b) => a - b);
  const q25 = quantile(intervals, 0.25);
  const q75 = quantile(intervals, 0.75);
  return {
    presses: downs.length,
    medianIntervalMs: quantile(intervals, 0.5),
    spreadMs: q25 !== null && q75 !== null ? q75 - q25 : null,
    p95PauseMs: quantile(intervals, 0.95),
    medianHoldMs: quantile(h, 0.5),
  };
}

export class TypingCollector {
  private liveDowns: number[] = [];
  private liveHolds: [number, number][] = [];
  private open: number[] = [];
  private sessionDowns: number[] = [];
  private sessionHolds: number[] = [];

  keyDown(t: number) {
    this.liveDowns.push(t);
    this.sessionDowns.push(t);
    this.open.push(t);
    while (this.open.length && t - this.open[0] > MAX_HOLD_MS) this.open.shift();
  }

  keyUp(t: number) {
    const d = this.open.shift();
    if (d === undefined) return;
    const hold = t - d;
    if (hold >= 0 && hold <= MAX_HOLD_MS) {
      this.liveHolds.push([t, hold]);
      this.sessionHolds.push(hold);
    }
  }

  lastPress(): number | null {
    return this.sessionDowns.length ? this.sessionDowns[this.sessionDowns.length - 1] : null;
  }

  live(now: number, windowMs = LIVE_WINDOW_MS): TypingStats {
    while (this.liveDowns.length && now - this.liveDowns[0] > windowMs) this.liveDowns.shift();
    while (this.liveHolds.length && now - this.liveHolds[0][0] > windowMs) this.liveHolds.shift();
    return typingStats(
      this.liveDowns,
      this.liveHolds.map(([, h]) => h),
    );
  }

  endIfIdle(now: number): TypingSessionEnd | null {
    const last = this.lastPress();
    return last !== null && now - last >= SESSION_IDLE_MS ? this.endNow() : null;
  }

  /** Ends the session now. A summary only if it had enough presses. */
  endNow(): TypingSessionEnd | null {
    const downs = this.sessionDowns;
    const holds = this.sessionHolds;
    this.sessionDowns = [];
    this.sessionHolds = [];
    this.liveDowns = [];
    this.liveHolds = [];
    this.open = [];
    if (downs.length < MIN_SESSION_PRESSES) return null;
    return { firstMs: downs[0], lastMs: downs[downs.length - 1], stats: typingStats(downs, holds) };
  }
}
