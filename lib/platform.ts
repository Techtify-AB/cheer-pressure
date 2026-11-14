"use client";

// The one place that knows whether the UI runs inside the desktop app (Tauri) or in
// a plain browser. Pages call these functions and never import Tauri themselves, so
// the static web build works without Tauri. In a browser every desktop call is a
// harmless no-op that returns null or an empty list.

import type { AppKind, BurstNumbers, NotCounted } from "./typing";

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
  /** The burst being typed now, or null: whether it counts as writing, and if not, why. */
  burst: { presses: number; kind: AppKind; counted: boolean; why: NotCounted | null } | null;
  /** Rhythm numbers over the counted bursts of the last minute. */
  stats: BurstNumbers;
  /** Counted presses today, every kind except games. */
  countedToday: number;
}

/** One day of typing for one kind of app, as the desktop app hands it over. Numbers only. */
export interface DesktopTypingDay {
  date: string;
  kind: "writing" | "code" | "browser" | "other" | "all";
  presses: number;
  bursts: number;
  spreadMs: number | null;
  holdMs: number | null;
  thinkingPer100: number | null;
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
/** Typing per day and kind of app for the last days, today's still growing. */
export const typingDays = async () => (await invoke<DesktopTypingDay[]>("typing_days")) ?? [];
/** Forgets everything the desktop app keeps on disk (for "Delete everything"). */
export const forgetDesktopData = () => invoke<void>("forget_all");
export const dayRhythm = async () => (await invoke<DayActivity[]>("day_rhythm")) ?? [];

export const onTypingLive = (h: (live: LiveTyping) => void) => listen<LiveTyping>("typing-live", h);
export const onTypingStatus = (h: (s: DesktopStatus) => void) => listen<DesktopStatus>("typing-status", h);
/** A burst was counted; call typingDays to collect today's numbers. */
export const onTypingCounted = (h: () => void) => listen<null>("typing-counted", () => h());

// Windows

/** Shows the main window; with a path, also opens that page in it. */
export const openMainWindow = (path?: string) => invoke<void>("open_main", { path: path ?? null });
/** The main window is asked to open a page (sent by openMainWindow from another window). */
export const onNavigate = (h: (path: string) => void) => listen<string>("navigate", h);
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
