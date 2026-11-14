"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { brain, type BrainOutput } from "@/lib/brain";
import { addDays, todayKey } from "@/lib/dates";
import { computeLevels, type Levels } from "@/lib/levels";
import { readData } from "@/lib/storage";
import type { AppData } from "@/lib/types";
import { speak, stopSpeaking, subscribeVoices, voiceAvailability, type VoiceAvailability } from "@/lib/voice";
import type { CompanionState } from "./companion/Companion";

/** Sends people without a profile to setup. */
export function useRequireProfile(data: AppData | null) {
  const router = useRouter();
  useEffect(() => {
    if (data && !data.profile) router.replace("/setup/");
  }, [data, router]);
  return !!data?.profile;
}

/** Whether this device has an on-device voice to read aloud with. */
export function useVoiceAvailability(): VoiceAvailability {
  return useSyncExternalStore(subscribeVoices, voiceAvailability, () => "checking" as const);
}

/** The companion's state (idle, speaking, listening) and a way to make it talk. */
export function useCompanionVoice() {
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const cancelRef = useRef<(() => void) | null>(null);

  const say = useCallback((text: string) => {
    cancelRef.current?.();
    setSpeaking(true);
    cancelRef.current = speak(text, { muted: readData().settings.muted, onEnd: () => setSpeaking(false) });
  }, []);

  const quiet = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    stopSpeaking();
    setSpeaking(false);
  }, []);

  useEffect(() => () => cancelRef.current?.(), []);

  const state: CompanionState = listening ? "listening" : speaking ? "speaking" : "idle";
  return { state, say, quiet, setListening };
}

/** Today's date, read once per mount on the client. */
export function useToday(): string {
  return useMemo(() => todayKey(), []);
}

/** Levels against the person's own baseline, and what the brain makes of them. */
export function useReflection(data: AppData | null) {
  const today = useToday();
  const levels = useMemo<Levels | null>(() => (data ? computeLevels(data, today) : null), [data, today]);
  const [result, setResult] = useState<{ for: Levels; out: BrainOutput } | null>(null);

  useEffect(() => {
    if (!levels || !data) return;
    let live = true;
    const since14 = addDays(today, -13);
    const since56 = addDays(today, -56);
    brain
      .reflect({
        today,
        profile: data.profile,
        recentDaily: data.daily.filter((e) => e.date >= since14),
        recentWeekly: data.weekly.filter((e) => e.date >= since56),
        levels,
      })
      .then((out) => {
        if (live) setResult({ for: levels, out });
      });
    return () => {
      live = false;
    };
  }, [levels, data, today]);

  return { levels, reflection: result && result.for === levels ? result.out : null };
}
