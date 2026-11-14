//! What the desktop app keeps on disk, in its own app data folder (rhythm.json):
//!
//! - per day (04:00 to 04:00 local time), the first and last key press time to the
//!   minute ("HH:MM"), and
//! - typing per day and kind of app (writing, code, browser, other, and "all" pooled):
//!   today's and yesterday's counted bursts as whole-millisecond gaps and holds, so the day's
//!   numbers can be pooled, and older days only as their summary numbers.
//!
//! No keys, characters, text, app names or window titles are ever written here. Only times,
//! counts and the kind of app as one word. Games are never counted, so never kept.

use crate::rhythm::{AppKind, Burst, DayPool, DaySummary};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};

/// How many days of first and last activity to keep.
const KEEP_DAYS: usize = 120;
/// How many days of typing summaries to keep (the rule looks back 35 days).
const KEEP_TYPING_DAYS: usize = 60;
/// The pooled row: every kind except games.
pub const ALL: &str = "all";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DayActivity {
  pub first: String,
  pub last: String,
}

/// One day of typing for one kind of app, as the UI receives it.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TypingDayRow {
  pub date: String,
  pub kind: String,
  #[serde(flatten)]
  pub summary: DaySummary,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Data {
  #[serde(default)]
  pub days: BTreeMap<String, DayActivity>,
  /// Open days (today, yesterday): date, then kind, then the pooled counted bursts.
  #[serde(default)]
  pub typing_open: BTreeMap<String, BTreeMap<String, DayPool>>,
  /// Closed days: date, then kind, then the day's numbers.
  #[serde(default)]
  pub typing_days: BTreeMap<String, BTreeMap<String, DaySummary>>,
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

  /**
   * Adds a counted burst to its day, under its kind and under "all". Days before `keep_open_from`
   * are closed: only their numbers are kept. Returns false for a burst that does not count.
   */
  pub fn add_burst(&mut self, day: &str, keep_open_from: &str, burst: &Burst) -> bool {
    if burst.kind == AppKind::Game {
      return false;
    }
    let kinds = self.data.typing_open.entry(day.to_string()).or_default();
    if !kinds.entry(burst.kind.as_str().to_string()).or_default().add(burst) {
      return false;
    }
    kinds.entry(ALL.to_string()).or_default().add(burst);
    self.close_days_before(keep_open_from);
    self.dirty = true;
    true
  }

  /// Turns open days before `date` into their summary numbers.
  pub fn close_days_before(&mut self, date: &str) {
    let old: Vec<String> = self.data.typing_open.keys().filter(|d| d.as_str() < date).cloned().collect();
    for d in old {
      if let Some(kinds) = self.data.typing_open.remove(&d) {
        let sums = kinds.into_iter().map(|(k, pool)| (k, pool.summary())).collect();
        self.data.typing_days.insert(d, sums);
        self.dirty = true;
      }
    }
    while self.data.typing_days.len() > KEEP_TYPING_DAYS {
      let oldest = self.data.typing_days.keys().next().cloned();
      if let Some(k) = oldest {
        self.data.typing_days.remove(&k);
      }
    }
  }

  /// Every typing day kept, closed and open, newest first.
  pub fn typing_rows(&self) -> Vec<TypingDayRow> {
    let mut rows: Vec<TypingDayRow> = vec![];
    for (date, kinds) in &self.data.typing_days {
      for (kind, summary) in kinds {
        rows.push(TypingDayRow { date: date.clone(), kind: kind.clone(), summary: summary.clone() });
      }
    }
    for (date, kinds) in &self.data.typing_open {
      for (kind, pool) in kinds {
        rows.push(TypingDayRow { date: date.clone(), kind: kind.clone(), summary: pool.summary() });
      }
    }
    rows.sort_by(|a, b| b.date.cmp(&a.date).then(a.kind.cmp(&b.kind)));
    rows
  }

  /// Counted presses on a day, every kind except games.
  pub fn counted_on(&self, day: &str) -> u32 {
    self.data.typing_open.get(day).and_then(|k| k.get(ALL)).map(|p| p.presses).unwrap_or(0)
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

  fn writing_burst(kind: AppKind, presses: u32) -> Burst {
    Burst {
      kind,
      presses,
      repeats: 0,
      motor_gaps: (1..presses).map(|i| 150.0 + (i % 5) as f64 * 10.0).collect(),
      thinking: 0,
      holds: (0..presses).map(|_| 90.0).collect(),
      chord_presses: 0,
    }
  }

  #[test]
  fn typing_days_pool_by_kind_and_all_and_close_old_days() {
    let mut s = Store::open(None);
    for _ in 0..4 {
      assert!(s.add_burst("2026-11-13", "2026-11-12", &writing_burst(AppKind::Writing, 100)));
    }
    assert!(s.add_burst("2026-11-13", "2026-11-12", &writing_burst(AppKind::Code, 50)));
    assert!(!s.add_burst("2026-11-13", "2026-11-12", &writing_burst(AppKind::Game, 100)), "games are never kept");
    assert!(!s.add_burst("2026-11-13", "2026-11-12", &writing_burst(AppKind::Writing, 10)), "too short");
    assert_eq!(s.counted_on("2026-11-13"), 450);
    let rows = s.typing_rows();
    let all = rows.iter().find(|r| r.kind == ALL).unwrap();
    let writing = rows.iter().find(|r| r.kind == "writing").unwrap();
    let code = rows.iter().find(|r| r.kind == "code").unwrap();
    assert_eq!((all.summary.presses, writing.summary.presses, code.summary.presses), (450, 400, 50));
    assert!(all.summary.spread_ms.is_some() && writing.summary.spread_ms.is_some());
    assert!(code.summary.spread_ms.is_none(), "under 300 counted presses: no value");
    assert!(!rows.iter().any(|r| r.kind == "game"));
    // Two days later the day is closed: only its numbers stay.
    s.add_burst("2026-11-15", "2026-11-14", &writing_burst(AppKind::Writing, 100));
    assert!(!s.data.typing_open.contains_key("2026-11-13"));
    assert_eq!(s.data.typing_days["2026-11-13"]["all"].presses, 450);
    assert_eq!(s.typing_rows().iter().filter(|r| r.date == "2026-11-13").count(), 3);
  }

  #[test]
  fn older_files_with_sessions_still_open() {
    let json = r#"{"days":{"2026-11-01":{"first":"08:00","last":"22:00"}},"pending_sessions":[{"id":"a"}]}"#;
    let data: Data = serde_json::from_str(json).expect("old file reads");
    assert_eq!(data.days.len(), 1);
    assert!(data.typing_days.is_empty());
  }
}
