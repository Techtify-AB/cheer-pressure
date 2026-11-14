"use client";

// The one place that knows whether the UI runs inside the desktop app (Tauri) or in
// a plain browser. Pages call these functions and never import Tauri themselves, so
// the static web build works without Tauri. In a browser every desktop call is a
// harmless no-op that returns null or an empty list.

import type { TypingStats } from "./typing";

/** True inside the Cheer Pressure desktop app. */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export type ListenerState = "running" | "permission-needed" | "unsupported" | "error";

export interface DesktopStatus {
  listener: ListenerState;
  paused: boolean;
}

export interface LiveTyping {
  /** A key was pressed in the last 2 seconds. */
  typing: boolean;
  windowSec: number;
  stats: TypingStats;
}

/** A finished typing session as the desktop app hands it over. Numbers only. */
export interface DesktopSession {
  id: string;
  date: string;
  startedAt: string;
  endedAt: string;
  windowSec: number;
  presses: number;
  medianIntervalMs: number | null;
  spreadMs: number | null;
  p95PauseMs: number | null;
  medianHoldMs: number | null;
}

export interface DayActivity {
  date: string;
  first: string;
  last: string;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isDesktop()) return null;
  try {
    const core = await import("@tauri-apps/api/core");
    return await core.invoke<T>(cmd, args);
  } catch {
    return null;
  }
}

/** Listens to an app event. Returns a function that stops listening. */
function listen<T>(event: string, handler: (payload: T) => void): () => void {
  if (!isDesktop()) return () => {};
  let stop: (() => void) | null = null;
  let stopped = false;
  import("@tauri-apps/api/event")
    .then((ev) => ev.listen<T>(event, (e) => handler(e.payload)))
    .then((un) => {
      if (stopped) un();
      else stop = un;
    })
    .catch(() => {});
  return () => {
    stopped = true;
    stop?.();
  };
}

// Typing rhythm measured across the computer

export const typingStatus = () => invoke<DesktopStatus>("typing_status");
export const setTypingPaused = (paused: boolean) => invoke<DesktopStatus>("typing_set_paused", { paused });
/** Lists the app under Input Monitoring and opens that pane of System Settings. */
export const openInputMonitoringSettings = () => invoke<void>("typing_open_permission");
export const retryTyping = () => invoke<DesktopStatus>("typing_retry");
/** Session summaries not stored yet. Each one is handed over once. */
export const takeTypingSessions = async () => (await invoke<DesktopSession[]>("typing_take_sessions")) ?? [];
export const dayRhythm = async () => (await invoke<DayActivity[]>("day_rhythm")) ?? [];

export const onTypingLive = (h: (live: LiveTyping) => void) => listen<LiveTyping>("typing-live", h);
export const onTypingStatus = (h: (s: DesktopStatus) => void) => listen<DesktopStatus>("typing-status", h);
/** A session ended; call takeTypingSessions to collect it. */
export const onTypingSessionEnded = (h: () => void) => listen<null>("typing-session", () => h());

// Windows

export const openMainWindow = () => invoke<void>("open_main");
export const pageReady = (path: string) => invoke<void>("page_ready", { path });

/** Starts moving the current frameless window with the mouse. */
export async function startWindowDrag() {
  if (!isDesktop()) return;
  try {
    const win = await import("@tauri-apps/api/window");
    await win.getCurrentWindow().startDragging();
  } catch {
    // Dragging is a nicety; ignore if it is not allowed.
  }
}
