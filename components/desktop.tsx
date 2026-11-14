"use client";

// React glue for the desktop app. Everything goes through lib/platform.ts, and in a
// plain browser these hooks report "not the desktop app" and do nothing else.

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  isDesktop,
  onTypingLive,
  onTypingSessionEnded,
  onTypingStatus,
  pageReady,
  takeTypingSessions,
  typingStatus,
  type DesktopSession,
  type DesktopStatus,
  type LiveTyping,
} from "@/lib/platform";
import { saveTypingSessions } from "@/lib/storage";
import type { TypingSession } from "@/lib/types";

const noSubscribe = () => () => {};

/** True inside the desktop app. False during server render and in a browser. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(noSubscribe, isDesktop, () => false);
}

/** The desktop listener's state and its live numbers, kept up to date by events. */
export function useDesktopTyping() {
  const desktop = useIsDesktop();
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [live, setLive] = useState<LiveTyping | null>(null);

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    typingStatus().then((s) => {
      if (alive && s) setStatus(s);
    });
    const stopStatus = onTypingStatus(setStatus);
    const stopLive = onTypingLive(setLive);
    return () => {
      alive = false;
      stopStatus();
      stopLive();
    };
  }, [desktop]);

  return { desktop, status, live, setStatus };
}

export function fromDesktopSession(d: DesktopSession): TypingSession {
  return {
    id: d.id,
    date: d.date,
    measuredIn: "computer",
    windowSec: d.windowSec,
    presses: d.presses,
    medianIntervalMs: d.medianIntervalMs,
    spreadMs: d.spreadMs,
    p95PauseMs: d.p95PauseMs,
    medianHoldMs: d.medianHoldMs,
    source: "user",
    savedAt: new Date().toISOString(),
  };
}

/**
 * Lives in the main window only. Collects finished typing sessions from the desktop
 * app and stores them with the rest of the person's data.
 */
export function DesktopBridge() {
  useEffect(() => {
    if (!isDesktop()) return;
    pageReady(window.location.pathname);
    const collect = async () => {
      const list = await takeTypingSessions();
      saveTypingSessions(list.map(fromDesktopSession));
    };
    void collect();
    return onTypingSessionEnded(() => void collect());
  }, []);
  return null;
}
