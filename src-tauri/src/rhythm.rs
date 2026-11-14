//! Typing rhythm from key timings only, in bursts of real writing. Pure code, no OS calls,
//! so it can be tested. The same rules as lib/typing.ts (the browser's text box and the
//! TypeScript tests).
//!
//! The listener hands over three kinds of moments: "a key went down", "the keyboard repeated a
//! held key" and "a key came up". It never says which key.
//!
//! BURSTS. A burst is a run of presses with no gap over 2 s. Only bursts of at least 30 presses
//! count; a few presses to open something or switch apps are not writing.
//!
//! MOTOR RHYTHM, NOT THINKING. Inside a counted burst, gaps under 1 s are the motor part of
//! typing: rhythm evenness is their spread (75th minus 25th percentile). Gaps of 1 to 2 s are
//! thinking pauses, counted per 100 presses and never part of the rhythm numbers. Gaps over
//! 2 s end the burst. Hold time is the median time a key is held (holds up to 2 s).
//!
//! NOT WRITING. Without ever knowing which key it is, a burst is not counted when (thresholds
//! from generated samples of prose, held-key game input and shortcut tapping; the tests below
//! generate the same three kinds, and scripts/typing-samples.mts prints how they separate):
//! - auto-repeat events are over 50 % of key-down events ("held keys"),
//! - the median hold is over 180 ms ("held keys"),
//! - over 20 % of presses come while two or more other keys are still down ("keys at once"),
//! - fewer than 80 % of gaps are under 1 s ("too slow", scattered presses such as shortcuts),
//! - a game is in front.
//! Measured on 300 samples of each kind: prose has repeats 0 to 21 %, median hold 78 to 115 ms,
//! keys at once 0 to 3 %, gaps under 1 s 91 to 99 %; games have median hold 385 ms or more and
//! keys at once 54 % or more; shortcut tapping has gaps under 1 s 26 to 72 %.
//!
//! A DAY. One value per measure per day and kind of app, pooled over that day's counted bursts,
//! only when the day has at least 300 counted presses.
//!
//! Because the key is never known, a release is paired with the oldest press still down; when
//! keys overlap in another order that is an approximation.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

pub const BURST_GAP_MS: f64 = 2_000.0;
pub const MOTOR_GAP_MS: f64 = 1_000.0;
pub const MIN_BURST_PRESSES: u32 = 30;
pub const MIN_DAY_PRESSES: u32 = 300;
/// Holds longer than this are not part of hold time.
pub const MAX_HOLD_MS: f64 = 2_000.0;
/// For the held-keys check, holds up to this long still count (and presses this old are let go).
pub const LONG_HOLD_MS: f64 = 5_000.0;
pub const MAX_REPEAT_SHARE: f64 = 0.5;
pub const MAX_MEDIAN_HOLD_MS: f64 = 180.0;
pub const MAX_CHORD_SHARE: f64 = 0.2;
pub const MIN_MOTOR_SHARE: f64 = 0.8;

/// The kind of app in front when a burst started. Never its name or what is in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, PartialOrd, Ord, Hash)]
#[serde(rename_all = "lowercase")]
pub enum AppKind {
  Writing,
  Code,
  Browser,
  Game,
  Other,
}

impl AppKind {
  pub fn as_str(self) -> &'static str {
    match self {
      AppKind::Writing => "writing",
      AppKind::Code => "code",
      AppKind::Browser => "browser",
      AppKind::Game => "game",
      AppKind::Other => "other",
    }
  }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NotCounted {
  TooShort,
  HeldKeys,
  KeysAtOnce,
  TooSlow,
  Game,
}

/// What a burst is made of: counts and durations only.
#[derive(Debug, Clone, PartialEq)]
pub struct Burst {
  pub kind: AppKind,
  pub presses: u32,
  pub repeats: u32,
  /// Gaps under 1 s between presses, ms.
  pub motor_gaps: Vec<f64>,
  /// Gaps of 1 to 2 s.
  pub thinking: u32,
  /// Every paired hold up to LONG_HOLD_MS, ms.
  pub holds: Vec<f64>,
  /// Presses made while two or more other keys were still down.
  pub chord_presses: u32,
}

impl Burst {
  fn new(kind: AppKind) -> Self {
    Self { kind, presses: 0, repeats: 0, motor_gaps: vec![], thinking: 0, holds: vec![], chord_presses: 0 }
  }
}

/// Linear interpolation between closest ranks, the same as lib/typing.ts and lib/passive.ts.
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

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Features {
  pub repeat_share: f64,
  pub median_hold: Option<f64>,
  pub chord_share: f64,
  pub motor_share: f64,
}

pub fn features(b: &Burst) -> Features {
  let gaps = b.presses.saturating_sub(1);
  let all = b.presses + b.repeats;
  Features {
    repeat_share: if all > 0 { b.repeats as f64 / all as f64 } else { 0.0 },
    median_hold: quantile(&sorted(b.holds.clone()), 0.5),
    chord_share: if b.presses > 0 { b.chord_presses as f64 / b.presses as f64 } else { 0.0 },
    motor_share: if gaps > 0 { b.motor_gaps.len() as f64 / gaps as f64 } else { 1.0 },
  }
}

/// Whether a burst counts as writing; if not, why. Never looks at which key.
pub fn verdict(b: &Burst) -> Result<(), NotCounted> {
  if b.kind == AppKind::Game {
    return Err(NotCounted::Game);
  }
  let f = features(b);
  if f.repeat_share > MAX_REPEAT_SHARE || f.median_hold.is_some_and(|h| h > MAX_MEDIAN_HOLD_MS) {
    return Err(NotCounted::HeldKeys);
  }
  if f.chord_share > MAX_CHORD_SHARE {
    return Err(NotCounted::KeysAtOnce);
  }
  if b.presses >= 10 && f.motor_share < MIN_MOTOR_SHARE {
    return Err(NotCounted::TooSlow);
  }
  if b.presses < MIN_BURST_PRESSES {
    return Err(NotCounted::TooShort);
  }
  Ok(())
}

/// Rhythm numbers over pooled motor gaps, holds and thinking pauses.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Numbers {
  pub presses: u32,
  pub spread_ms: Option<f64>,
  pub hold_ms: Option<f64>,
  pub thinking_per100: Option<f64>,
}

pub fn numbers(motor_gaps: &[f64], holds: &[f64], thinking: u32, presses: u32) -> Numbers {
  let g = sorted(motor_gaps.to_vec());
  let h = sorted(holds.iter().copied().filter(|x| (0.0..=MAX_HOLD_MS).contains(x)).collect());
  let spread = match (quantile(&g, 0.25), quantile(&g, 0.75)) {
    (Some(lo), Some(hi)) => Some(hi - lo),
    _ => None,
  };
  Numbers {
    presses,
    spread_ms: spread,
    hold_ms: quantile(&h, 0.5),
    thinking_per100: if presses > 0 { Some(thinking as f64 / presses as f64 * 100.0) } else { None },
  }
}

pub fn burst_numbers(b: &Burst) -> Numbers {
  numbers(&b.motor_gaps, &b.holds, b.thinking, b.presses)
}

/// A day's counted bursts for one kind of app, pooled. Kept as whole milliseconds, so it is
/// small enough to keep on disk until the day is over.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct DayPool {
  pub motor_gaps: Vec<u16>,
  pub holds: Vec<u16>,
  pub thinking: u32,
  pub presses: u32,
  pub bursts: u32,
}

/// One day of typing for one kind of app: numbers only, null under 300 counted presses.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DaySummary {
  pub presses: u32,
  pub bursts: u32,
  pub spread_ms: Option<f64>,
  pub hold_ms: Option<f64>,
  pub thinking_per100: Option<f64>,
}

impl DayPool {
  /// Adds a burst if it counts as writing. Returns whether it did.
  pub fn add(&mut self, b: &Burst) -> bool {
    if verdict(b).is_err() {
      return false;
    }
    self.motor_gaps.extend(b.motor_gaps.iter().map(|g| g.round().clamp(0.0, 65_535.0) as u16));
    self.holds.extend(b.holds.iter().filter(|h| **h <= MAX_HOLD_MS).map(|h| h.round().clamp(0.0, 65_535.0) as u16));
    self.thinking += b.thinking;
    self.presses += b.presses;
    self.bursts += 1;
    true
  }

  pub fn summary(&self) -> DaySummary {
    let g: Vec<f64> = self.motor_gaps.iter().map(|v| *v as f64).collect();
    let h: Vec<f64> = self.holds.iter().map(|v| *v as f64).collect();
    let n = numbers(&g, &h, self.thinking, self.presses);
    let enough = self.presses >= MIN_DAY_PRESSES;
    DaySummary {
      presses: self.presses,
      bursts: self.bursts,
      spread_ms: n.spread_ms.filter(|_| enough),
      hold_ms: n.hold_ms.filter(|_| enough),
      thinking_per100: n.thinking_per100.filter(|_| enough),
    }
  }
}

/// Cuts key moments into bursts. Times are ms on one monotonic clock.
#[derive(Debug, Default)]
pub struct BurstCollector {
  current: Option<Burst>,
  last_press: Option<f64>,
  /// Presses still down, oldest first.
  open: VecDeque<f64>,
}

impl BurstCollector {
  /// A key went down (`repeat`: the keyboard repeating a held key). `kind_now` is asked once,
  /// when a new burst starts. Returns a burst that ended because of the gap before this press.
  pub fn key_down(&mut self, t: f64, repeat: bool, kind_now: impl FnOnce() -> AppKind) -> Option<Burst> {
    if repeat {
      if let Some(b) = self.current.as_mut() {
        b.repeats += 1;
      }
      return None;
    }
    let mut ended = None;
    if self.current.is_some() && self.last_press.is_some_and(|l| t - l > BURST_GAP_MS) {
      ended = self.close();
    }
    let last = self.last_press;
    while self.open.front().is_some_and(|d| t - d > LONG_HOLD_MS) {
      self.open.pop_front();
    }
    let chord = self.open.len() >= 2;
    let b = self.current.get_or_insert_with(|| Burst::new(kind_now()));
    if b.presses > 0 {
      if let Some(l) = last {
        let gap = t - l;
        if gap < MOTOR_GAP_MS {
          b.motor_gaps.push(gap);
        } else if gap <= BURST_GAP_MS {
          b.thinking += 1;
        }
      }
    }
    if chord {
      b.chord_presses += 1;
    }
    b.presses += 1;
    self.open.push_back(t);
    self.last_press = Some(t);
    ended
  }

  /// A key came up: paired with the oldest press still down.
  pub fn key_up(&mut self, t: f64) {
    if let Some(d) = self.open.pop_front() {
      let hold = t - d;
      if let Some(b) = self.current.as_mut() {
        if (0.0..=LONG_HOLD_MS).contains(&hold) {
          b.holds.push(hold);
        }
      }
    }
  }

  /// Ends the burst if nothing was pressed for over 2 s.
  pub fn tick(&mut self, now: f64) -> Option<Burst> {
    if self.current.is_some() && self.last_press.is_some_and(|l| now - l > BURST_GAP_MS) {
      return self.close();
    }
    None
  }

  pub fn current(&self) -> Option<&Burst> {
    self.current.as_ref()
  }

  pub fn last_press(&self) -> Option<f64> {
    self.last_press
  }

  /// Ends the burst now (pause, quit).
  pub fn close(&mut self) -> Option<Burst> {
    self.open.clear();
    self.current.take()
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn close(a: Option<f64>, b: f64) -> bool {
    a.is_some_and(|a| (a - b).abs() < 1e-9)
  }

  /// The same tiny generator as lib/replay.ts and scripts/typing-samples.mts.
  struct Rng(u32);
  impl Rng {
    fn next(&mut self) -> f64 {
      self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
      self.0 as f64 / 4_294_967_296.0
    }
    fn normal(&mut self) -> f64 {
      (0..6).map(|_| self.next()).sum::<f64>() - 3.0
    }
  }

  #[derive(Clone, Copy, PartialEq)]
  enum M {
    Down,
    Up,
    Repeat,
  }

  fn repeats(down: f64, hold: f64, out: &mut Vec<(f64, M)>) {
    let mut t = down + 400.0;
    while t < down + hold {
      out.push((t, M::Repeat));
      t += 80.0;
    }
  }

  fn prose(seed: u32, presses: usize) -> Vec<(f64, M)> {
    let mut r = Rng(seed);
    let typical = 150.0 + r.next() * 70.0;
    let hold_mid = 80.0 + r.next() * 30.0;
    let mut out = vec![];
    let mut t = 1000.0;
    for i in 0..presses {
      if i > 0 {
        let thinking = r.next() < 0.04;
        t += if thinking { 1000.0 + r.next() * 950.0 } else { (typical * (0.35 * r.normal() / 0.707).exp()).min(950.0) };
      }
      let held = r.next() < 0.015;
      let hold = if held { 600.0 + r.next() * 300.0 } else { (hold_mid + 15.0 * r.normal() / 0.707).max(40.0) };
      out.push((t, M::Down));
      out.push((t + hold, M::Up));
      if held {
        repeats(t, hold, &mut out);
      }
    }
    out.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    out
  }

  fn game(seed: u32, with_repeats: bool) -> Vec<(f64, M)> {
    let mut r = Rng(seed);
    let mut out = vec![];
    let mut t = 1000.0;
    for _ in 0..80 {
      t += 60.0 + r.next() * 260.0;
      let held = r.next() < 0.6;
      let hold = if held { 300.0 + r.next() * 1200.0 } else { 60.0 + r.next() * 60.0 };
      out.push((t, M::Down));
      out.push((t + hold, M::Up));
      if held && with_repeats {
        repeats(t, hold, &mut out);
      }
    }
    out.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    out
  }

  fn shortcuts(seed: u32) -> Vec<(f64, M)> {
    let mut r = Rng(seed);
    let mut out = vec![];
    let mut t = 1000.0;
    for _ in 0..40 {
      t += if r.next() < 0.15 { 120.0 + r.next() * 200.0 } else { 500.0 + r.next() * 1400.0 };
      let hold = 60.0 + r.next() * 70.0;
      out.push((t, M::Down));
      out.push((t + hold, M::Up));
    }
    out.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
    out
  }

  fn bursts(moments: &[(f64, M)], kind: AppKind) -> Vec<Burst> {
    let mut c = BurstCollector::default();
    let mut out = vec![];
    for (t, m) in moments {
      match m {
        M::Up => c.key_up(*t),
        M::Down | M::Repeat => {
          if let Some(b) = c.key_down(*t, *m == M::Repeat, || kind) {
            out.push(b);
          }
        }
      }
    }
    if let Some(b) = c.close() {
      out.push(b);
    }
    out
  }

  fn main_burst(m: &[(f64, M)]) -> Burst {
    bursts(m, AppKind::Writing).into_iter().max_by_key(|b| b.presses).unwrap()
  }

  fn even(c: &mut BurstCollector, start: f64, n: usize, gap: f64) -> Vec<Burst> {
    let mut ended = vec![];
    for i in 0..n {
      let t = start + i as f64 * gap;
      if let Some(b) = c.key_down(t, false, || AppKind::Writing) {
        ended.push(b);
      }
      c.key_up(t + 90.0);
    }
    ended
  }

  #[test]
  fn quantile_matches_linear_interpolation() {
    let v = [100.0, 200.0, 300.0, 400.0];
    assert!(close(quantile(&v, 0.5), 250.0));
    assert!(close(quantile(&v, 0.25), 175.0));
    assert!(close(quantile(&v, 0.95), 385.0));
    assert_eq!(quantile(&[], 0.5), None);
  }

  #[test]
  fn a_gap_over_two_seconds_cuts_the_burst() {
    let mut c = BurstCollector::default();
    even(&mut c, 0.0, 40, 200.0);
    let cut = even(&mut c, 39.0 * 200.0 + 2_001.0, 40, 200.0);
    assert_eq!(cut.len(), 1);
    assert_eq!(cut[0].presses, 40);
    assert_eq!(c.current().unwrap().presses, 40);

    let mut c2 = BurstCollector::default();
    even(&mut c2, 0.0, 20, 200.0);
    let none = even(&mut c2, 19.0 * 200.0 + 1_900.0, 20, 200.0);
    assert!(none.is_empty(), "a gap of 1.9 s does not cut");
    assert_eq!(c2.current().unwrap().thinking, 1);
    let last = 19.0 * 200.0 + 1_900.0 + 19.0 * 200.0;
    assert!(c2.tick(last + 2_000.0).is_none());
    assert!(c2.tick(last + 2_001.0).is_some());
  }

  #[test]
  fn kind_is_asked_once_per_burst() {
    let mut c = BurstCollector::default();
    let mut asked = 0;
    for i in 0..35 {
      c.key_down(i as f64 * 150.0, false, || {
        asked += 1;
        AppKind::Code
      });
    }
    assert_eq!(asked, 1);
    assert_eq!(c.current().unwrap().kind, AppKind::Code);
  }

  #[test]
  fn only_gaps_under_one_second_make_the_rhythm() {
    let mut plain = BurstCollector::default();
    even(&mut plain, 0.0, 50, 180.0);
    let p = burst_numbers(&plain.close().unwrap());
    let mut c = BurstCollector::default();
    let mut t = 0.0;
    for i in 0..50 {
      if i > 0 {
        t += if i % 10 == 0 { 1_600.0 } else { 180.0 };
      }
      c.key_down(t, false, || AppKind::Writing);
      c.key_up(t + 90.0);
    }
    let b = c.close().unwrap();
    let n = burst_numbers(&b);
    assert!(close(n.spread_ms, p.spread_ms.unwrap()) && close(n.spread_ms, 0.0), "thinking pauses do not move the rhythm");
    assert_eq!(b.thinking, 4);
    assert_eq!(b.motor_gaps.len(), 45);
    assert!(close(n.thinking_per100, 8.0));
    let n2 = numbers(&[100.0, 200.0, 300.0, 400.0, 500.0], &[90.0, 100.0, 110.0, 3_000.0], 0, 5);
    assert!(close(n2.spread_ms, 200.0) && close(n2.hold_ms, 100.0));
  }

  #[test]
  fn generated_prose_counts_and_games_and_shortcuts_do_not() {
    for seed in 1..=200 {
      let p = main_burst(&prose(seed, 120));
      assert!(verdict(&p).is_ok(), "prose sample {seed}: {:?} {:?}", verdict(&p), features(&p));
      let g = main_burst(&game(seed, seed % 2 == 0));
      assert!(matches!(verdict(&g), Err(NotCounted::HeldKeys) | Err(NotCounted::KeysAtOnce)), "game sample {seed}");
      let s = main_burst(&shortcuts(seed));
      assert!(verdict(&s).is_err(), "shortcut sample {seed}: {:?}", features(&s));
    }
  }

  #[test]
  fn held_key_short_burst_and_game_in_front() {
    let mut held = BurstCollector::default();
    held.key_down(0.0, false, || AppKind::Writing);
    let mut t = 400.0;
    while t < 3_000.0 {
      held.key_down(t, true, || AppKind::Writing);
      t += 80.0;
    }
    assert_eq!(verdict(held.current().unwrap()), Err(NotCounted::HeldKeys));
    let mut short = BurstCollector::default();
    even(&mut short, 0.0, 12, 150.0);
    assert_eq!(verdict(short.current().unwrap()), Err(NotCounted::TooShort));
    let mut g = BurstCollector::default();
    for i in 0..60 {
      g.key_down(i as f64 * 180.0, false, || AppKind::Game);
      g.key_up(i as f64 * 180.0 + 90.0);
    }
    assert_eq!(verdict(&g.close().unwrap()), Err(NotCounted::Game));
  }

  #[test]
  fn a_day_pools_counted_bursts_and_needs_300_presses() {
    let mut pool = DayPool::default();
    for b in bursts(&prose(7, 200), AppKind::Writing) {
      pool.add(&b);
    }
    let small = pool.summary();
    assert!(small.presses < MIN_DAY_PRESSES && small.spread_ms.is_none() && small.hold_ms.is_none());
    for b in bursts(&prose(8, 200), AppKind::Writing) {
      pool.add(&b);
    }
    for b in bursts(&game(3, true), AppKind::Writing) {
      assert!(!pool.add(&b));
    }
    for b in bursts(&shortcuts(3), AppKind::Writing) {
      assert!(!pool.add(&b));
    }
    let day = pool.summary();
    assert_eq!(day.presses, 400);
    assert!(day.spread_ms.is_some() && day.hold_ms.is_some());
    // Pooling equals the numbers over all the day's gaps and holds (to the whole millisecond kept).
    let all: Vec<Burst> = bursts(&prose(7, 200), AppKind::Writing).into_iter().chain(bursts(&prose(8, 200), AppKind::Writing)).collect();
    let g: Vec<f64> = all.iter().flat_map(|b| b.motor_gaps.iter().map(|v| v.round())).collect();
    let h: Vec<f64> = all.iter().flat_map(|b| b.holds.iter().filter(|x| **x <= MAX_HOLD_MS).map(|v| v.round())).collect();
    let direct = numbers(&g, &h, all.iter().map(|b| b.thinking).sum(), 400);
    assert!(close(day.spread_ms, direct.spread_ms.unwrap()) && close(day.hold_ms, direct.hold_ms.unwrap()));
  }
}
