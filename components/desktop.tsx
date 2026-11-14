"use client";

// React glue for the desktop app. Everything goes through lib/platform.ts, and in a
// plain browser these hooks report "not the desktop app" and do nothing else.

import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  dayRhythm,
  isDesktop,
  onNavigate,
  onTypingCounted,
  onTypingLive,
  onTypingStatus,
  pageReady,
  typingDays,
  typingStatus,
  type DesktopStatus,
  type DesktopTypingDay,
  type LiveTyping,
} from "@/lib/platform";
import { sourcesOf } from "@/lib/settings";
import { readData, saveActivityDays, saveTypingDays } from "@/lib/storage";
import type { TypingDay } from "@/lib/types";

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

export function fromDesktopDay(d: DesktopTypingDay): TypingDay {
  return { ...d, measuredIn: "computer", source: "user", savedAt: new Date().toISOString() };
}

/**
 * Lives in the main window only. Collects typing per day and kind of app, and first and
 * last activity, from the desktop app and stores them with the rest of the person's
 * data, and opens pages the mascot asks for.
 */
export function DesktopBridge() {
  const router = useRouter();
  useEffect(() => {
    if (!isDesktop()) return;
    pageReady(window.location.pathname);
    // A source switched off in Settings, or Pause everything: nothing new is kept.
    const allowed = () => {
      const s = readData().settings;
      const src = sourcesOf(s);
      return { typing: src.typing && !s.pausedAll, day: src.dayRhythm && !s.pausedAll };
    };
    const collect = async () => {
      if (!allowed().typing) return;
      const list = await typingDays();
      saveTypingDays(list.map(fromDesktopDay));
    };
    const syncDays = async () => {
      if (!allowed().day) return;
      const days = await dayRhythm();
      saveActivityDays(days.map((d) => ({ ...d, source: "user" as const })));
    };
    void collect();
    void syncDays();
    const daysTimer = window.setInterval(() => {
      void syncDays();
      void collect();
    }, 60_000);
    const stopSessions = onTypingCounted(() => void collect());
    const stopNavigate = onNavigate((path) => router.push(path));
    return () => {
      window.clearInterval(daysTimer);
      stopSessions();
      stopNavigate();
    };
  }, [router]);
  return null;
}
