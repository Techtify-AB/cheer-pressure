//! Typing rhythm from timestamps only. Pure code, no OS calls, so it can be tested.
//!
//! The listener hands over two kinds of moments: "a key went down" and "a key came up".
//! It never says which key. From those moments this module computes, for a rolling
//! window and for a whole session:
//!
//! - presses: how many key presses
//! - median interval: the middle time between one press and the next
//! - spread: the interquartile range of those intervals (75th minus 25th percentile)
//! - p95 pause: the 95th percentile of those intervals
//! - median hold: the middle time from a key going down to a key coming up
//!
//! Gaps longer than 5 s are not intervals (the person stopped, then started again).
//! Because the key is never known, a release is paired with the oldest press that has
//! not been released yet. For normal typing that is the right pair; when keys overlap
//! in another order it is an approximation.

use serde::Serialize;
use std::collections::VecDeque;

/// Gaps longer than this are a pause in typing, not an interval.
pub const MAX_INTERVAL_MS: f64 = 5_000.0;
/// Holds longer than this are ignored (a key held on purpose, or a lost release).
pub const MAX_HOLD_MS: f64 = 2_000.0;
/// Live window.
pub const LIVE_WINDOW_MS: f64 = 60_000.0;
/// A session ends after this long without a key press.
pub const SESSION_IDLE_MS: f64 = 5.0 * 60_000.0;
/// Sessions shorter than this many presses are not kept: too few to say anything.
pub const MIN_SESSION_PRESSES: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
  pub presses: usize,
  pub median_interval_ms: Option<f64>,
  pub spread_ms: Option<f64>,
  pub p95_pause_ms: Option<f64>,
  pub median_hold_ms: Option<f64>,
}

/// Linear interpolation between closest ranks, the same as lib/levels.ts and lib/typing.ts.
pub fn quantile(sorted: &[f64], q: f64) -> Option<f64> {
  match sorted.len() {
    0 => None,
    1 => Some(sorted[0]),
    n => {
      let pos = (n - 1) as f64 * q;
      let lo = pos.floor() as usize;
      let hi = pos.ceil() as usize;
      Some(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo as f64))
    }
  }
}

fn sorted(mut v: Vec<f64>) -> Vec<f64> {
  v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
  v
}

/// Statistics from press times (ms, any origin, ascending) and hold durations (ms).
pub fn stats(downs: &[f64], holds: &[f64]) -> Stats {
  let intervals: Vec<f64> = downs
    .windows(2)
    .map(|w| w[1] - w[0])
    .filter(|d| *d >= 0.0 && *d <= MAX_INTERVAL_MS)
    .collect();
  let intervals = sorted(intervals);
  let holds = sorted(holds.iter().copied().filter(|h| *h >= 0.0 && *h <= MAX_HOLD_MS).collect());
  let spread = match (quantile(&intervals, 0.25), quantile(&intervals, 0.75)) {
    (Some(lo), Some(hi)) => Some(hi - lo),
    _ => None,
  };
  Stats {
    presses: downs.len(),
    median_interval_ms: quantile(&intervals, 0.5),
    spread_ms: spread,
    p95_pause_ms: quantile(&intervals, 0.95),
    median_hold_ms: quantile(&holds, 0.5),
  }
}

/// A finished session, ready to be summarised with wall-clock times by the caller.
#[derive(Debug, Clone, PartialEq)]
pub struct SessionEnd {
  pub first_ms: f64,
  pub last_ms: f64,
  pub stats: Stats,
}

/// Collects key-down and key-up moments. Times are ms on one monotonic clock.
#[derive(Debug, Default)]
pub struct Collector {
  /// Presses in the live window.
  live_downs: VecDeque<f64>,
  /// (release time, hold) in the live window.
  live_holds: VecDeque<(f64, f64)>,
  /// Presses still waiting for their release, oldest first.
  open: VecDeque<f64>,
  /// The whole current session.
  session_downs: Vec<f64>,
  session_holds: Vec<f64>,
}

impl Collector {
  pub fn key_down(&mut self, t: f64) {
    self.live_downs.push_back(t);
    self.session_downs.push(t);
    self.open.push_back(t);
    // A release that never came: forget presses older than the longest hold we accept.
    while self.open.front().is_some_and(|d| t - d > MAX_HOLD_MS) {
      self.open.pop_front();
    }
  }

  pub fn key_up(&mut self, t: f64) {
    if let Some(d) = self.open.pop_front() {
      let hold = t - d;
      if (0.0..=MAX_HOLD_MS).contains(&hold) {
        self.live_holds.push_back((t, hold));
        self.session_holds.push(hold);
      }
    }
  }

  pub fn last_press(&self) -> Option<f64> {
    self.session_downs.last().copied()
  }

  fn trim_live(&mut self, now: f64, window: f64) {
    while self.live_downs.front().is_some_and(|d| now - d > window) {
      self.live_downs.pop_front();
    }
    while self.live_holds.front().is_some_and(|(at, _)| now - at > window) {
      self.live_holds.pop_front();
    }
  }

  /// Statistics for the last `window` ms.
  pub fn live(&mut self, now: f64, window: f64) -> Stats {
    self.trim_live(now, window);
    let downs: Vec<f64> = self.live_downs.iter().copied().collect();
    let holds: Vec<f64> = self.live_holds.iter().map(|(_, h)| *h).collect();
    stats(&downs, &holds)
  }

  /// Ends the session if nothing was pressed for `SESSION_IDLE_MS`.
  pub fn end_if_idle(&mut self, now: f64) -> Option<SessionEnd> {
    match self.last_press() {
      Some(last) if now - last >= SESSION_IDLE_MS => self.end_now(),
      _ => None,
    }
  }

  /// Ends the session now (pause, quit). Returns a summary if it had enough presses.
  pub fn end_now(&mut self) -> Option<SessionEnd> {
    let downs = std::mem::take(&mut self.session_downs);
    let holds = std::mem::take(&mut self.session_holds);
    self.live_downs.clear();
    self.live_holds.clear();
    self.open.clear();
    if downs.len() < MIN_SESSION_PRESSES {
      return None;
    }
    Some(SessionEnd { first_ms: downs[0], last_ms: downs[downs.len() - 1], stats: stats(&downs, &holds) })
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn close(a: Option<f64>, b: f64) -> bool {
    a.is_some_and(|a| (a - b).abs() < 1e-9)
  }

  #[test]
  fn quantile_matches_linear_interpolation() {
    let v = [100.0, 200.0, 300.0, 400.0];
    assert!(close(quantile(&v, 0.5), 250.0));
    assert!(close(quantile(&v, 0.25), 175.0));
    assert!(close(quantile(&v, 0.75), 325.0));
    assert!(close(quantile(&v, 0.95), 385.0));
    assert_eq!(quantile(&[], 0.5), None);
    assert!(close(quantile(&[7.0], 0.9), 7.0));
  }

  #[test]
  fn even_typing_has_no_spread() {
    let downs: Vec<f64> = (0..11).map(|i| i as f64 * 200.0).collect();
    let s = stats(&downs, &[90.0, 100.0, 110.0]);
    assert_eq!(s.presses, 11);
    assert!(close(s.median_interval_ms, 200.0));
    assert!(close(s.spread_ms, 0.0));
    assert!(close(s.p95_pause_ms, 200.0));
    assert!(close(s.median_hold_ms, 100.0));
  }

  #[test]
  fn gaps_over_five_seconds_are_not_intervals() {
    // 0, 100, 200, then 10 s later 10200, 10300.
    let s = stats(&[0.0, 100.0, 200.0, 10_200.0, 10_300.0], &[]);
    assert_eq!(s.presses, 5);
    assert!(close(s.median_interval_ms, 100.0));
    assert!(close(s.p95_pause_ms, 100.0));
    assert_eq!(s.median_hold_ms, None);
  }

  #[test]
  fn uneven_typing_has_a_larger_spread() {
    let even: Vec<f64> = (0..21).map(|i| i as f64 * 180.0).collect();
    let mut t = 0.0;
    let mut uneven = vec![0.0];
    for i in 0..20 {
      t += if i % 2 == 0 { 90.0 } else { 420.0 };
      uneven.push(t);
    }
    let a = stats(&even, &[]).spread_ms.unwrap();
    let b = stats(&uneven, &[]).spread_ms.unwrap();
    assert!(b > a + 100.0, "even {a}, uneven {b}");
  }

  #[test]
  fn release_pairs_with_oldest_open_press() {
    let mut c = Collector::default();
    // Overlapping keys: A down 0, B down 50, A up 100, B up 160.
    c.key_down(0.0);
    c.key_down(50.0);
    c.key_up(100.0);
    c.key_up(160.0);
    let s = c.live(200.0, LIVE_WINDOW_MS);
    assert_eq!(s.presses, 2);
    assert!(close(s.median_interval_ms, 50.0));
    assert!(close(s.median_hold_ms, 105.0)); // holds 100 and 110
  }

  #[test]
  fn a_release_without_a_press_is_ignored() {
    let mut c = Collector::default();
    c.key_up(10.0);
    c.key_down(20.0);
    c.key_up(80.0);
    assert!(close(c.live(100.0, LIVE_WINDOW_MS).median_hold_ms, 60.0));
  }

  #[test]
  fn lost_releases_do_not_pair_later() {
    let mut c = Collector::default();
    c.key_down(0.0); // its release is never seen
    c.key_down(3_000.0);
    c.key_up(3_080.0);
    assert!(close(c.live(3_100.0, LIVE_WINDOW_MS).median_hold_ms, 80.0));
  }

  #[test]
  fn live_window_drops_old_presses() {
    let mut c = Collector::default();
    for i in 0..10 {
      c.key_down(i as f64 * 100.0);
    }
    for i in 0..5 {
      c.key_down(70_000.0 + i as f64 * 100.0);
    }
    let s = c.live(70_500.0, LIVE_WINDOW_MS);
    assert_eq!(s.presses, 5);
  }

  #[test]
  fn session_ends_after_five_idle_minutes_and_needs_enough_presses() {
    let mut c = Collector::default();
    for i in 0..30 {
      let t = i as f64 * 150.0;
      c.key_down(t);
      c.key_up(t + 80.0);
    }
    assert_eq!(c.end_if_idle(4_350.0 + 60_000.0), None);
    let end = c.end_if_idle(4_350.0 + SESSION_IDLE_MS).expect("session ends");
    assert_eq!(end.stats.presses, 30);
    assert!(close(end.stats.median_interval_ms, 150.0));
    assert!(close(end.stats.median_hold_ms, 80.0));
    assert!(close(Some(end.first_ms), 0.0));
    assert!(close(Some(end.last_ms), 4_350.0));
    // Nothing left after the end.
    assert_eq!(c.last_press(), None);

    let mut short = Collector::default();
    for i in 0..5 {
      short.key_down(i as f64 * 100.0);
    }
    assert_eq!(short.end_now(), None);
  }
}
