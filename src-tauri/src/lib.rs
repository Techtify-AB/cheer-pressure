//! Cheer Pressure desktop app: the web UI in a main window, a small mascot window, a
//! menu bar icon, and typing rhythm measured across the computer (timing only).

mod frontmost;
mod listener;
mod rhythm;
mod store;

use chrono::{DateTime, Local};
use listener::{KeySink, StartError};
use rhythm::{Burst, BurstCollector, Numbers, NotCounted};
use serde::Serialize;
use std::{
  sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
  },
  thread,
  time::{Duration, Instant},
};
use store::{Store, TypingDayRow};
use tauri::{
  menu::{Menu, MenuItem, PredefinedMenuItem},
  tray::TrayIconBuilder,
  window::{Effect, EffectState, EffectsBuilder},
  AppHandle, Emitter, Manager, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

const MAIN: &str = "main";
const MASCOT: &str = "mascot";
const MASCOT_W: f64 = 160.0;
const MASCOT_H: f64 = 180.0;
/// The mascot window while it shows the daily question's bubble and three answers.
const MASCOT_EXPANDED_W: f64 = 300.0;
const MASCOT_EXPANDED_H: f64 = 300.0;
/// The local hour a new day starts for first and last activity.
const DAY_STARTS_AT_HOUR: i64 = 4;
/// Live numbers are sent while there was a press in the last this many ms.
const TYPING_RECENT_MS: f64 = 2_000.0;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
  /// "running", "permission-needed", "unsupported" or "error".
  pub listener: &'static str,
  pub paused: bool,
}

/// The burst being typed now: whether it counts as writing, and if not, why.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveBurst {
  presses: u32,
  kind: &'static str,
  counted: bool,
  why: Option<NotCounted>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Live {
  typing: bool,
  burst: Option<LiveBurst>,
  /// The current burst's numbers while it counts, otherwise the last counted burst's.
  stats: Numbers,
  counted_today: u32,
}

fn empty_numbers() -> Numbers {
  rhythm::numbers(&[], &[], 0, 0)
}

fn live_burst(b: &Burst) -> LiveBurst {
  let v = rhythm::verdict(b);
  LiveBurst { presses: b.presses, kind: b.kind.as_str(), counted: v.is_ok(), why: v.err() }
}

#[derive(Debug, Clone, Serialize)]
struct DayRow {
  date: String,
  first: String,
  last: String,
}

#[derive(Default)]
struct Inner {
  collector: BurstCollector,
  /// When the burst being typed started (wall clock), for its day.
  burst_start: Option<DateTime<Local>>,
  /// The last counted burst's numbers, for the live view.
  last_counted: Option<Numbers>,
  /// Wall-clock moments of presses since the last tick, for first and last activity.
  activity_first: Option<DateTime<Local>>,
  activity_last: Option<DateTime<Local>>,
  was_typing: bool,
}

/// Shared by the key listener thread, the once-a-second ticker and the commands.
pub struct Measure {
  origin: Instant,
  paused: AtomicBool,
  listener: Mutex<&'static str>,
  inner: Mutex<Inner>,
  store: Mutex<Store>,
}

impl Measure {
  fn now_ms(&self) -> f64 {
    self.origin.elapsed().as_secs_f64() * 1000.0
  }

  fn status(&self) -> Status {
    Status { listener: *self.listener.lock().unwrap(), paused: self.paused.load(Ordering::SeqCst) }
  }

  /// Keeps a finished burst if it counts as writing. Returns whether it did.
  fn finish_burst(&self, inner: &mut Inner, burst: Option<Burst>) -> bool {
    let Some(burst) = burst else { return false };
    let start = inner.burst_start.take().unwrap_or_else(Local::now);
    if rhythm::verdict(&burst).is_err() {
      return false;
    }
    let day = day_of(start);
    let keep_open_from = day_of(start - chrono::Duration::days(1));
    inner.last_counted = Some(rhythm::burst_numbers(&burst));
    self.store.lock().unwrap().add_burst(&day, &keep_open_from, &burst)
  }
}

/// The day a moment belongs to: a day runs from 04:00 to 04:00 (same as lib/passive.ts).
fn day_of(wall: DateTime<Local>) -> String {
  (wall - chrono::Duration::hours(DAY_STARTS_AT_HOUR)).format("%Y-%m-%d").to_string()
}

struct Sink(Arc<Measure>);

impl KeySink for Sink {
  fn key_down(&self, repeat: bool) {
    let m = &self.0;
    if m.paused.load(Ordering::Relaxed) {
      return;
    }
    let t = m.now_ms();
    let wall = Local::now();
    let mut inner = m.inner.lock().unwrap();
    // The kind of app in front is read once, when a new burst starts; only the kind is kept.
    let ended = inner.collector.key_down(t, repeat, frontmost::frontmost_kind);
    if ended.is_some() {
      m.finish_burst(&mut inner, ended);
    }
    if repeat {
      return;
    }
    if inner.burst_start.is_none() || inner.collector.current().is_some_and(|b| b.presses == 1) {
      inner.burst_start = Some(wall);
    }
    if inner.activity_first.is_none() {
      inner.activity_first = Some(wall);
    }
    inner.activity_last = Some(wall);
  }

  fn key_up(&self) {
    let m = &self.0;
    if m.paused.load(Ordering::Relaxed) {
      return;
    }
    let t = m.now_ms();
    m.inner.lock().unwrap().collector.key_up(t);
  }
}

struct TrayItems {
  pause: MenuItem<tauri::Wry>,
}

fn start_listener(measure: &Arc<Measure>) {
  let result = listener::start(Box::new(Sink(measure.clone())));
  *measure.listener.lock().unwrap() = match result {
    Ok(()) => "running",
    Err(StartError::PermissionNeeded) => "permission-needed",
    Err(StartError::Unsupported) => "unsupported",
    Err(StartError::Failed) => "error",
  };
}

fn emit_status(app: &AppHandle) {
  let measure = app.state::<Arc<Measure>>();
  let status = measure.status();
  if let Some(items) = app.try_state::<TrayItems>() {
    let _ = items.pause.set_text(if status.paused { "Resume measuring" } else { "Pause measuring" });
  }
  let _ = app.emit("typing-status", status);
}

fn set_paused(app: &AppHandle, paused: bool) {
  let measure = app.state::<Arc<Measure>>().inner().clone();
  measure.paused.store(paused, Ordering::SeqCst);
  if paused {
    let mut inner = measure.inner.lock().unwrap();
    let burst = inner.collector.close();
    let counted = measure.finish_burst(&mut inner, burst);
    inner.was_typing = false;
    drop(inner);
    if counted {
      let _ = app.emit("typing-counted", ());
    }
    let today = day_of(Local::now());
    let counted_today = measure.store.lock().unwrap().counted_on(&today);
    let _ = app.emit("typing-live", Live { typing: false, burst: None, stats: empty_numbers(), counted_today });
  }
  emit_status(app);
}

fn show_main(app: &AppHandle) {
  if let Some(w) = app.get_webview_window(MAIN) {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

/// Once a second: first and last activity, live numbers while typing, burst ends,
/// and a retry when the permission was missing.
fn ticker(app: AppHandle) {
  let measure = app.state::<Arc<Measure>>().inner().clone();
  let mut tick: u64 = 0;
  loop {
    thread::sleep(Duration::from_secs(1));
    tick += 1;

    if tick % 3 == 0 && *measure.listener.lock().unwrap() == "permission-needed" && listener::has_permission() {
      start_listener(&measure);
      emit_status(&app);
    }

    let now = measure.now_ms();
    let mut live: Option<Live> = None;
    let mut ended = false;
    let (first, last) = {
      let mut inner = measure.inner.lock().unwrap();
      let first = inner.activity_first.take();
      let last = inner.activity_last.take();
      if !measure.paused.load(Ordering::SeqCst) {
        let typing = inner.collector.last_press().is_some_and(|t| now - t <= TYPING_RECENT_MS);
        let burst = inner.collector.tick(now);
        let ending = burst.as_ref().map(live_burst);
        ended = measure.finish_burst(&mut inner, burst);
        if typing || inner.was_typing || ending.is_some() {
          let current = inner.collector.current().map(live_burst).or(ending);
          let stats = match inner.collector.current() {
            Some(b) if rhythm::verdict(b).is_ok() => rhythm::burst_numbers(b),
            _ => inner.last_counted.clone().unwrap_or_else(empty_numbers),
          };
          let today = day_of(Local::now());
          let counted_today = measure.store.lock().unwrap().counted_on(&today);
          live = Some(Live { typing, burst: current, stats, counted_today });
        }
        inner.was_typing = typing;
      }
      (first, last)
    };

    {
      let mut store = measure.store.lock().unwrap();
      for wall in [first, last].into_iter().flatten() {
        // A day runs from 04:00 to 04:00, so typing at 00:40 counts as the end of the
        // evening before, not the start of a new day (same as lib/passive.ts).
        let day = (wall - chrono::Duration::hours(DAY_STARTS_AT_HOUR)).format("%Y-%m-%d").to_string();
        store.touch(&day, &wall.format("%H:%M").to_string());
      }
      if tick % 30 == 0 {
        // A day that has passed keeps only its numbers.
        store.close_days_before(&day_of(Local::now() - chrono::Duration::days(1)));
      }
      if ended || tick % 30 == 0 {
        store.save_if_dirty();
      }
    }
    if let Some(l) = live {
      let _ = app.emit("typing-live", l);
    }
    if ended {
      let _ = app.emit("typing-counted", ());
    }
  }
}

// Commands for the web UI (wrapped by lib/platform.ts).

#[tauri::command]
fn typing_status(measure: tauri::State<'_, Arc<Measure>>) -> Status {
  measure.status()
}

#[tauri::command]
fn typing_set_paused(app: AppHandle, paused: bool) -> Status {
  set_paused(&app, paused);
  app.state::<Arc<Measure>>().status()
}

/// Lists the app under Input Monitoring and opens that pane of System Settings.
#[tauri::command]
fn typing_open_permission() {
  listener::request_permission();
  listener::open_settings();
}

#[tauri::command]
fn typing_retry(app: AppHandle) -> Status {
  let measure = app.state::<Arc<Measure>>().inner().clone();
  if *measure.listener.lock().unwrap() != "running" {
    start_listener(&measure);
    emit_status(&app);
  }
  measure.status()
}

/// Typing per day and kind of app, newest first: today's numbers grow as the day goes on.
#[tauri::command]
fn typing_days(measure: tauri::State<'_, Arc<Measure>>) -> Vec<TypingDayRow> {
  measure.store.lock().unwrap().typing_rows()
}

/// "Delete everything" in the UI: forgets first and last activity, typing days and the
/// running burst, and writes the empty file.
#[tauri::command]
fn forget_all(measure: tauri::State<'_, Arc<Measure>>) {
  {
    let mut inner = measure.inner.lock().unwrap();
    let _ = inner.collector.close();
    *inner = Inner::default();
  }
  measure.store.lock().unwrap().clear();
}

#[tauri::command]
fn day_rhythm(measure: tauri::State<'_, Arc<Measure>>) -> Vec<DayRow> {
  let store = measure.store.lock().unwrap();
  store
    .data
    .days
    .iter()
    .rev()
    .take(14)
    .map(|(date, d)| DayRow { date: date.clone(), first: d.first.clone(), last: d.last.clone() })
    .collect()
}

/// Shows the main window, and opens a page in it if `path` is given (for example
/// the proposed check-in when the mascot is clicked).
#[tauri::command]
fn open_main(app: AppHandle, path: Option<String>) {
  show_main(&app);
  if let Some(p) = path.filter(|p| p.starts_with('/')) {
    let _ = app.emit_to(MAIN, "navigate", p);
  }
}

/// Opens the system print dialog for the calling window (Save as PDF is in it). The web
/// view's own window.print() is not reliable in the macOS desktop shell.
#[tauri::command]
fn print_page(window: tauri::WebviewWindow) {
  let _ = window.print();
}

/// Logged once per window so a smoke test can see that each page's script ran.
#[tauri::command]
fn page_ready(window: tauri::WebviewWindow, path: String) {
  println!("cheer-pressure: page ready in window '{}': {}", window.label(), path);
}

/// Grows the mascot window to hold the daily question's bubble, or shrinks it back, keeping
/// its bottom-right corner where it is. Never focuses it.
#[tauri::command]
fn mascot_expand(app: AppHandle, expanded: bool) {
  let Some(w) = app.get_webview_window(MASCOT) else { return };
  let (Ok(pos), Ok(size), Ok(scale)) = (w.outer_position(), w.outer_size(), w.scale_factor()) else { return };
  let (lw, lh) = if expanded { (MASCOT_EXPANDED_W, MASCOT_EXPANDED_H) } else { (MASCOT_W, MASCOT_H) };
  let (nw, nh) = ((lw * scale).round() as i32, (lh * scale).round() as i32);
  if nw == size.width as i32 && nh == size.height as i32 {
    return;
  }
  let right = pos.x + size.width as i32;
  let bottom = pos.y + size.height as i32;
  let _ = w.set_size(tauri::PhysicalSize::new(nw as u32, nh as u32));
  let _ = w.set_position(PhysicalPosition::new(right - nw, bottom - nh));
}

fn place_mascot(app: &AppHandle) {
  let Some(w) = app.get_webview_window(MASCOT) else { return };
  let monitor = w.primary_monitor().ok().flatten().or_else(|| w.current_monitor().ok().flatten());
  if let Some(m) = monitor {
    let area = m.work_area();
    let scale = m.scale_factor();
    let margin = 16.0 * scale;
    let x = area.position.x as f64 + area.size.width as f64 - MASCOT_W * scale - margin;
    let y = area.position.y as f64 + area.size.height as f64 - MASCOT_H * scale - margin;
    let _ = w.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
  }
}

pub fn run() {
  let measure = Arc::new(Measure {
    origin: Instant::now(),
    paused: AtomicBool::new(false),
    listener: Mutex::new("unsupported"),
    inner: Mutex::new(Inner::default()),
    store: Mutex::new(Store::open(None)),
  });

  let app = tauri::Builder::default()
    .manage(measure.clone())
    .invoke_handler(tauri::generate_handler![
      typing_status,
      typing_set_paused,
      typing_open_permission,
      typing_retry,
      typing_days,
      day_rhythm,
      forget_all,
      open_main,
      print_page,
      mascot_expand,
      page_ready
    ])
    .setup(move |app| {
      let handle = app.handle().clone();

      // Local file for first and last activity and unsent session summaries.
      if let Ok(dir) = app.path().app_data_dir() {
        *measure.store.lock().unwrap() = Store::open(Some(dir.join("rhythm.json")));
      }

      let main = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App("index.html".into()))
        .title("Cheer Pressure")
        .inner_size(520.0, 820.0)
        .min_inner_size(380.0, 560.0)
        // The main window keeps polling for messages from someone you trust while it is
        // hidden to the menu bar; the default policy would pause its timers (macOS 14+).
        .background_throttling(tauri::utils::config::BackgroundThrottlingPolicy::Disabled)
        // One frosted pane: the window is see-through and the system blurs the desktop behind
        // it; the page lays a cream wash on that blur (app/globals.css, html[data-shell]).
        // Active keeps it frosted when the window is not in front. Light keeps the blur light
        // under the dark text, also when the Mac is in dark mode.
        .transparent(true)
        .theme(Some(tauri::Theme::Light))
        .effects(
          EffectsBuilder::new()
            .effect(Effect::Sidebar)
            .state(EffectState::Active)
            .build(),
        );
      // The title bar is part of the glass: the window buttons stay, the title is hidden, and
      // the empty parts of the page's header drag the window (data-tauri-drag-region). The
      // buttons sit level with the header row, which starts after them (app/globals.css).
      #[cfg(target_os = "macos")]
      let main = main
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(18.0, 21.0));
      main.build()?;

      let mascot = WebviewWindowBuilder::new(app, MASCOT, WebviewUrl::App("mascot/index.html".into()))
        .title("Cheer Pressure mascot")
        .inner_size(MASCOT_W, MASCOT_H)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        .accept_first_mouse(true)
        .visible(false)
        .build()?;
      place_mascot(&handle);
      let _ = mascot.show();

      // Menu bar icon.
      let open = MenuItem::with_id(app, "open", "Open Cheer Pressure", true, None::<&str>)?;
      let pause = MenuItem::with_id(app, "pause", "Pause measuring", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit Cheer Pressure", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open, &pause, &PredefinedMenuItem::separator(app)?, &quit])?;
      app.manage(TrayItems { pause: pause.clone() });
      TrayIconBuilder::with_id("tray")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Cheer Pressure")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
          "open" => show_main(app),
          "pause" => {
            let paused = app.state::<Arc<Measure>>().paused.load(Ordering::SeqCst);
            set_paused(app, !paused);
          }
          "quit" => app.exit(0),
          _ => {}
        })
        .build(app)?;

      start_listener(&measure);
      emit_status(&handle);
      let ticker_handle = handle.clone();
      thread::Builder::new().name("cheer-pressure-ticker".into()).spawn(move || ticker(ticker_handle))?;
      Ok(())
    })
    .on_window_event(|window, event| {
      // Closing the main window hides it to the menu bar; Quit is in the menu.
      if window.label() == MAIN {
        if let WindowEvent::CloseRequested { api, .. } = event {
          api.prevent_close();
          let _ = window.hide();
        }
      }
    })
    .build(tauri::generate_context!())
    .expect("error while building the Cheer Pressure app");

  app.run(|app, event| match event {
    #[cfg(target_os = "macos")]
    RunEvent::Reopen { .. } => show_main(app),
    RunEvent::Exit => {
      // Keep the running burst if it counts, and save to disk.
      let measure = app.state::<Arc<Measure>>().inner().clone();
      let mut inner = measure.inner.lock().unwrap();
      let burst = inner.collector.close();
      measure.finish_burst(&mut inner, burst);
      drop(inner);
      measure.store.lock().unwrap().save_if_dirty();
    }
    _ => {}
  });
}
