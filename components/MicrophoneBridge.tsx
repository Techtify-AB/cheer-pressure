"use client";

// The microphone, at app level, in the main window only (components/AppShell.tsx), like the
// camera (components/CameraBridge.tsx):
//
// - It listens only while the person has it on in Settings (off by default), nothing is paused,
//   and the window is open and showing. It is asked for only then.
// - It hands the microphone to "Voice, live" (/demo/voice/) and "Live" (/live/) while they are open.
// - Every finished stretch (numbers only: pace, how much the pitch moved, loudness) is stored
//   once, here. No audio is kept or sent and no words are recognised (lib/voice/tone.ts).
// - While it listens, a heartbeat in local storage lets the mascot window show "Microphone on".

import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useVoice } from "@/components/voice/useVoice";
import { onToneSession, resetVoice, startListening, stopListening } from "@/lib/voice/index";
import { sourcesOf } from "@/lib/settings";
import { readData, saveToneSession, useData } from "@/lib/storage";

export const MIC_LIVE_KEY = "cheerpressure.microphone.live";
const HEARTBEAT_MS = 2000;

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}
const isVisible = () => document.visibilityState !== "hidden";

export function micHeartbeatFresh(): boolean {
  try {
    const t = Number(window.localStorage.getItem(MIC_LIVE_KEY));
    return Number.isFinite(t) && Date.now() - t < HEARTBEAT_MS * 2.5;
  } catch {
    return false;
  }
}

export function MicrophoneBridge() {
  const data = useData();
  const pathname = usePathname();
  const view = useVoice();
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  // "Voice, live" and "Live" start the microphone themselves, only on a press.
  const onVoiceScreen = !!pathname?.startsWith("/demo/voice") || !!pathname?.startsWith("/live") || !!pathname?.startsWith("/hello");
  const wanted = !!data?.profile && sourcesOf(data.settings).microphone && !data.settings.pausedAll && visible;
  const ours = useRef(false);

  useEffect(
    () =>
      onToneSession((s) => {
        if (s.source !== "computer" || !sourcesOf(readData().settings).microphone) return;
        saveToneSession({
          date: s.date,
          minutes: s.minutes,
          speakingMinutes: s.speakingMinutes,
          segmentsPerMinute: s.segmentsPerMinute,
          pitchVariability: s.pitchVariability,
          loudnessMean: s.loudnessMean,
          source: "user",
          savedAt: new Date().toISOString(),
        });
      }),
    [],
  );

  useEffect(() => {
    const phase = view.phase;
    if (onVoiceScreen) {
      if (ours.current && (phase === "on" || phase === "starting")) stopListening();
      ours.current = false;
      return;
    }
    if (wanted && phase === "off") {
      ours.current = true;
      void startListening();
    } else if (!wanted && (phase === "on" || phase === "starting")) stopListening();
    else if (!wanted && phase !== "off" && phase !== "example") resetVoice();
  }, [wanted, view.phase, onVoiceScreen]);

  useEffect(() => () => stopListening(), []);

  const on = view.phase === "on";
  useEffect(() => {
    if (!on) {
      try {
        window.localStorage.removeItem(MIC_LIVE_KEY);
      } catch {
        // nothing to clear
      }
      return;
    }
    const beat = () => {
      try {
        window.localStorage.setItem(MIC_LIVE_KEY, String(Date.now()));
      } catch {
        // storage blocked: the mascot simply shows nothing
      }
    };
    beat();
    const id = window.setInterval(beat, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [on]);

  return null;
}

/** "Microphone on", on every screen of the main window while it listens ("Voice, live" shows its own). */
export function MicrophoneOnSign() {
  const view = useVoice();
  const pathname = usePathname();
  if (view.phase !== "on" || pathname?.startsWith("/demo/voice")) return null;
  return (
    <span className="camera-on" role="status">
      <span className="camera-on-dot" aria-hidden="true" />
      Microphone on
    </span>
  );
}
