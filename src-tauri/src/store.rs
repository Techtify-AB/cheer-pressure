//! What the desktop app keeps on disk, in its own app data folder (rhythm.json):
//!
//! - per day (04:00 to 04:00 local time), the first and last key press time to the
//!   minute ("HH:MM"), and
//! - typing session summaries the web UI has not picked up yet.
//!
//! No keys, characters or text are ever written here. Only times and counts.

use crate::rhythm::Stats;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};

/// How many days of first and last activity to keep.
const KEEP_DAYS: usize = 120;
/// Summaries waiting for the UI; older ones are dropped beyond this.
const KEEP_PENDING: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DayActivity {
  pub first: String,
  pub last: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
  pub id: String,
  /// Local day the session started, "YYYY-MM-DD".
  pub date: String,
  /// ISO times of the first and last key press.
  pub started_at: String,
  pub ended_at: String,
  /// Length of the session in seconds, first to last press.
  pub window_sec: f64,
  pub presses: usize,
  pub median_interval_ms: Option<f64>,
  pub spread_ms: Option<f64>,
  pub p95_pause_ms: Option<f64>,
  pub median_hold_ms: Option<f64>,
}

impl SessionSummary {
  pub fn new(id: String, date: String, started_at: String, ended_at: String, window_sec: f64, s: &Stats) -> Self {
    Self {
      id,
      date,
      started_at,
      ended_at,
      window_sec,
      presses: s.presses,
      median_interval_ms: s.median_interval_ms,
      spread_ms: s.spread_ms,
      p95_pause_ms: s.p95_pause_ms,
      median_hold_ms: s.median_hold_ms,
    }
  }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Data {
  #[serde(default)]
  pub days: BTreeMap<String, DayActivity>,
  #[serde(default)]
  pub pending_sessions: Vec<SessionSummary>,
}

pub struct Store {
  path: Option<PathBuf>,
  pub data: Data,
  dirty: bool,
}

impl Store {
  pub fn open(path: Option<PathBuf>) -> Self {
    let data = path
      .as_ref()
      .and_then(|p| fs::read_to_string(p).ok())
      .and_then(|s| serde_json::from_str(&s).ok())
      .unwrap_or_default();
    Self { path, data, dirty: false }
  }

  /// Records a key press at a day and clock minute. Times before 04:00 belong to the
  /// end of the day, so they are compared as later than any time after 04:00.
  pub fn touch(&mut self, day: &str, hhmm: &str) {
    let key = |t: &str| if t < "04:00" { format!("1{t}") } else { format!("0{t}") };
    match self.data.days.get_mut(day) {
      Some(d) => {
        if key(hhmm) < key(&d.first) {
          d.first = hhmm.to_string();
          self.dirty = true;
        }
        if key(hhmm) > key(&d.last) {
          d.last = hhmm.to_string();
          self.dirty = true;
        }
      }
      None => {
        self.data.days.insert(day.to_string(), DayActivity { first: hhmm.to_string(), last: hhmm.to_string() });
        while self.data.days.len() > KEEP_DAYS {
          let oldest = self.data.days.keys().next().cloned();
          if let Some(k) = oldest {
            self.data.days.remove(&k);
          }
        }
        self.dirty = true;
      }
    }
  }

  pub fn push_session(&mut self, s: SessionSummary) {
    self.data.pending_sessions.push(s);
    let n = self.data.pending_sessions.len();
    if n > KEEP_PENDING {
      self.data.pending_sessions.drain(0..n - KEEP_PENDING);
    }
    self.dirty = true;
  }

  pub fn take_sessions(&mut self) -> Vec<SessionSummary> {
    if self.data.pending_sessions.is_empty() {
      return Vec::new();
    }
    self.dirty = true;
    std::mem::take(&mut self.data.pending_sessions)
  }

  pub fn clear(&mut self) {
    self.data = Data::default();
    self.dirty = true;
    self.save_if_dirty();
  }

  pub fn save_if_dirty(&mut self) {
    if !self.dirty {
      return;
    }
    let Some(path) = &self.path else { return };
    if let Some(dir) = path.parent() {
      let _ = fs::create_dir_all(dir);
    }
    if let Ok(json) = serde_json::to_string_pretty(&self.data) {
      let tmp = path.with_extension("json.tmp");
      if fs::write(&tmp, json).is_ok() && fs::rename(&tmp, path).is_ok() {
        self.dirty = false;
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn first_and_last_activity_per_day() {
    let mut s = Store::open(None);
    s.touch("2026-11-14", "09:12");
    s.touch("2026-11-14", "08:58");
    s.touch("2026-11-14", "23:40");
    s.touch("2026-11-14", "12:00");
    assert_eq!(s.data.days["2026-11-14"], DayActivity { first: "08:58".into(), last: "23:40".into() });
    // After midnight is still the end of the same day.
    s.touch("2026-11-14", "00:35");
    assert_eq!(s.data.days["2026-11-14"].last, "00:35");
    s.touch("2026-11-14", "23:59");
    assert_eq!(s.data.days["2026-11-14"].last, "00:35");
  }

  #[test]
  fn sessions_are_taken_once() {
    let mut s = Store::open(None);
    let st = Stats { presses: 30, median_interval_ms: Some(150.0), spread_ms: Some(40.0), p95_pause_ms: Some(600.0), median_hold_ms: Some(90.0) };
    s.push_session(SessionSummary::new("a".into(), "2026-11-14".into(), "x".into(), "y".into(), 10.0, &st));
    assert_eq!(s.take_sessions().len(), 1);
    assert!(s.take_sessions().is_empty());
  }
}
