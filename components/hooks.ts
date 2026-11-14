"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { brain, passiveInput, type BrainOutput } from "@/lib/brain";
import { addDays, todayKey } from "@/lib/dates";
import { computeLevels, type Levels } from "@/lib/levels";
import { judgeSuggestions } from "@/lib/helps";
import { closeLadder, isActive, ladderDue, type LadderOutcome } from "@/lib/ladder";
import { evaluatePassive, type Evaluation } from "@/lib/passive";
import { forRule, quietHoursOf } from "@/lib/settings";
import { containsCrisisWords, containsCrisisWordsWhileTyping } from "@/lib/crisis";
import { readData, saveLadder, saveSuggestions } from "@/lib/storage";
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

/**
 * Levels against the person's own baseline, the passive measures, and what the brain
 * makes of them. Pass `fixed` to word an evaluation judged earlier (the proposed
 * check-in keeps the one it opened with). Until the brain has answered the first time,
 * `reflection` is null; after that it keeps the last answer while a new one is on its way.
 */
export function useReflection(data: AppData | null, fixed?: Evaluation) {
  const today = useToday();
  const levels = useMemo<Levels | null>(() => (data ? computeLevels(data, today) : null), [data, today]);
  const live = useMemo<Evaluation | null>(() => (data ? evaluatePassive(forRule(data), today) : null), [data, today]);
  const passive = fixed ?? live;
  const [result, setResult] = useState<BrainOutput | null>(null);

  useEffect(() => {
    if (!levels || !data || !passive) return;
    let current = true;
    const since14 = addDays(today, -13);
    const since56 = addDays(today, -56);
    brain
      .reflect({
        today,
        profile: data.profile,
        recentDaily: data.daily.filter((e) => e.date >= since14),
        recentWeekly: data.weekly.filter((e) => e.date >= since56),
        levels,
        passive: passiveInput(passive),
      })
      .then((out) => {
        if (current) setResult(out);
      });
    return () => {
      current = false;
    };
  }, [levels, passive, data, today]);

  return { levels, passive, reflection: result };
}

/** The passive measures against the person's own range, and whether to ask. Sources switched off are left out. */
export function usePassive(data: AppData | null): Evaluation | null {
  const today = useToday();
  return useMemo(() => (data ? evaluatePassive(forRule(data), today) : null), [data, today]);
}

function minutesNow(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Minutes after midnight, updated every half minute. */
export function useClockMinutes(): number {
  const [m, setM] = useState(minutesNow);
  useEffect(() => {
    const id = window.setInterval(() => setM(minutesNow()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return m;
}

/**
 * What the companion would bring up now (lib/ladder.ts) and whether it may speak up,
 * given the rule's result, the ladder, quiet hours and Pause everything. When the
 * measures are back in the usual range, a running ladder is closed here.
 */
export function useCompanionStatus(data: AppData | null): {
  evaluation: Evaluation | null;
  outcome: LadderOutcome | null;
} {
  const today = useToday();
  const minutes = useClockMinutes();
  const evaluation = usePassive(data);
  const outcome = useMemo(() => {
    if (!data || !evaluation) return null;
    return ladderDue({
      ladder: data.ladder,
      today,
      minutesNow: minutes,
      quietHours: quietHoursOf(data.settings),
      pausedAll: !!data.settings.pausedAll,
      passive: evaluation,
    });
  }, [data, evaluation, today, minutes]);
  const ladder = data?.ladder;
  useEffect(() => {
    if (outcome?.close && isActive(ladder)) saveLadder(closeLadder(ladder, today));
  }, [outcome?.close, ladder, today]);
  // Step one's suggestions are judged once their days have passed, or the values came back
  // (lib/helps.ts): that is what orders the list next time.
  const suggestions = data?.suggestions;
  useEffect(() => {
    if (!suggestions?.length) return;
    const j = judgeSuggestions(suggestions, ladder, today);
    if (j.changed) saveSuggestions(j.history);
  }, [suggestions, ladder, today]);
  return { evaluation, outcome };
}

/** How long typing has to pause before the full crisis check runs, last word included. */
export const CRISIS_PAUSE_MS = 800;

/**
 * Crisis wording in free text (lib/crisis.ts). `typed` runs on every change and skips
 * the word still being typed, so "want to diet" does not match half-way; when typing
 * pauses for CRISIS_PAUSE_MS the whole text is checked. `full` checks the whole text
 * now (on blur, Next, Back or Save).
 *
 * A blur often comes from pressing a button or link. If that blur shows the card, the
 * click that follows is swallowed, so the card is not replaced by wherever the click
 * was going. With `leaving`, any link click is also checked first, so leaving the page
 * by a link shows the card instead.
 */
export function useCrisisCheck(onCrisis: (text: string) => void, leaving?: () => string) {
  const timer = useRef<number | null>(null);
  const callback = useRef(onCrisis);
  const leavingText = useRef(leaving);
  const gesture = useRef({ down: false, swallow: false });
  useEffect(() => {
    callback.current = onCrisis;
    leavingText.current = leaving;
  });

  const cancel = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const hit = useCallback((text: string) => {
    if (gesture.current.down) gesture.current.swallow = true;
    callback.current(text);
  }, []);

  const full = useCallback(
    (text: string): boolean => {
      cancel();
      if (!containsCrisisWords(text)) return false;
      hit(text);
      return true;
    },
    [cancel, hit],
  );

  const typed = useCallback(
    (text: string): boolean => {
      cancel();
      if (containsCrisisWordsWhileTyping(text)) {
        hit(text);
        return true;
      }
      timer.current = window.setTimeout(() => {
        timer.current = null;
        if (containsCrisisWords(text)) hit(text);
      }, CRISIS_PAUSE_MS);
      return false;
    },
    [cancel, hit],
  );

  useEffect(() => {
    const down = () => {
      gesture.current = { down: true, swallow: false };
    };
    const click = (e: MouseEvent) => {
      const swallow = gesture.current.swallow;
      gesture.current = { down: false, swallow: false };
      const link = e.target instanceof Element ? e.target.closest("a[href]") : null;
      const text = leavingText.current?.();
      if (swallow || (link && text && containsCrisisWords(text))) {
        e.preventDefault();
        e.stopPropagation();
        if (!swallow && text) {
          cancel();
          callback.current(text);
        }
      }
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click, true);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("click", click, true);
    };
  }, [cancel]);

  return { typed, full, cancel };
}
