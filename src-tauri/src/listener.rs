//! The system-wide key listener. On macOS a listen-only CGEventTap: it can see that a
//! key went down or up anywhere on the computer, but it cannot change or block input.
//!
//! PRIVACY: the callback reads only the event type (down or up) and whether the press
//! is the keyboard's own auto-repeat. It never reads the key code, the character or
//! the modifiers. The moment is taken with the app's own clock, so nothing from the
//! event itself is kept. Needs the "Input Monitoring" permission.

/// Something that wants to know that a key went down or up, and nothing more.
pub trait KeySink: Send + Sync + 'static {
  fn key_down(&self);
  fn key_up(&self);
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartError {
  PermissionNeeded,
  /// Not built for this operating system yet (only used outside macOS).
  #[cfg_attr(target_os = "macos", allow(dead_code))]
  Unsupported,
  Failed,
}

#[cfg(target_os = "macos")]
mod mac {
  use super::{KeySink, StartError};
  use objc2_core_foundation::{kCFRunLoopCommonModes, CFMachPort, CFRunLoop};
  use objc2_core_graphics::{
    CGEvent, CGEventField, CGEventMask, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventTapProxy,
    CGEventType, CGPreflightListenEventAccess, CGRequestListenEventAccess,
  };
  use std::{cell::Cell, ffi::c_void, ptr::NonNull, sync::mpsc, thread};

  struct Context {
    sink: Box<dyn KeySink>,
    tap: Cell<Option<NonNull<CFMachPort>>>,
  }

  unsafe extern "C-unwind" fn callback(
    _proxy: CGEventTapProxy,
    kind: CGEventType,
    event: NonNull<CGEvent>,
    data: *mut c_void,
  ) -> *mut CGEvent {
    // SAFETY: data is the Context leaked in start(), alive for the rest of the process.
    let ctx = unsafe { &*(data as *const Context) };
    if matches!(kind, CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput) {
      // macOS switched the tap off; switch it back on.
      if let Some(tap) = ctx.tap.get() {
        CGEvent::tap_enable(unsafe { tap.as_ref() }, true);
      }
      return event.as_ptr();
    }
    let down = match kind {
      CGEventType::KeyDown => true,
      CGEventType::KeyUp => false,
      _ => return event.as_ptr(),
    };
    if down {
      // The only field read: is this the keyboard repeating a held key? Repeats are
      // not new presses. This says nothing about which key it is.
      let repeat = CGEvent::integer_value_field(Some(unsafe { event.as_ref() }), CGEventField::KeyboardEventAutorepeat) != 0;
      if repeat {
        return event.as_ptr();
      }
      let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ctx.sink.key_down()));
    } else {
      let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| ctx.sink.key_up()));
    }
    // A listen-only tap passes every event on unchanged.
    event.as_ptr()
  }

  pub fn has_permission() -> bool {
    CGPreflightListenEventAccess()
  }

  /// Asks macOS to list the app under Input Monitoring (shows the system prompt once).
  pub fn request_permission() {
    let _ = CGRequestListenEventAccess();
  }

  pub fn open_settings() {
    let _ = std::process::Command::new("open")
      .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")
      .spawn();
  }

  pub fn start(sink: Box<dyn KeySink>) -> Result<(), StartError> {
    if !has_permission() {
      return Err(StartError::PermissionNeeded);
    }
    let (tx, rx) = mpsc::channel::<Result<(), StartError>>();
    thread::Builder::new()
      .name("cheer-pressure-keys".into())
      .spawn(move || {
        let mask: CGEventMask = (1 << CGEventType::KeyDown.0) | (1 << CGEventType::KeyUp.0);
        let ctx = Box::into_raw(Box::new(Context { sink, tap: Cell::new(None) }));
        let tap = unsafe {
          CGEvent::tap_create(
            CGEventTapLocation::SessionEventTap,
            CGEventTapPlacement::TailAppendEventTap,
            CGEventTapOptions::ListenOnly,
            mask,
            Some(callback),
            ctx as *mut c_void,
          )
        };
        let Some(tap) = tap else {
          drop(unsafe { Box::from_raw(ctx) });
          let _ = tx.send(Err(StartError::PermissionNeeded));
          return;
        };
        unsafe { (*ctx).tap.set(Some(NonNull::from(&*tap))) };
        let (Some(source), Some(run_loop)) = (CFMachPort::new_run_loop_source(None, Some(&tap), 0), CFRunLoop::current())
        else {
          tap.invalidate();
          drop(unsafe { Box::from_raw(ctx) });
          let _ = tx.send(Err(StartError::Failed));
          return;
        };
        run_loop.add_source(Some(&source), unsafe { kCFRunLoopCommonModes });
        CGEvent::tap_enable(&tap, true);
        let _ = tx.send(Ok(()));
        // Runs for the life of the app. The context is never freed while the tap exists.
        CFRunLoop::run();
      })
      .map_err(|_| StartError::Failed)?;
    rx.recv().unwrap_or(Err(StartError::Failed))
  }
}

#[cfg(target_os = "macos")]
pub use mac::{has_permission, open_settings, request_permission, start};

// Windows and Linux: not built yet. The app runs and the UI falls back to measuring
// only in its own text box.
#[cfg(not(target_os = "macos"))]
pub fn has_permission() -> bool {
  false
}
#[cfg(not(target_os = "macos"))]
pub fn request_permission() {}
#[cfg(not(target_os = "macos"))]
pub fn open_settings() {}
#[cfg(not(target_os = "macos"))]
pub fn start(_sink: Box<dyn KeySink>) -> Result<(), StartError> {
  Err(StartError::Unsupported)
}
