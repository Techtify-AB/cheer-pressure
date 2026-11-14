"use client";

// "Listen for a while, then the step": the shared part of One song, one first step and Wind
// down the evening. A clock runs for up to `maxMs`; the sound plays along if it is on, the
// screen light glows if it is on, and either can be switched at any moment. Both off still
// works: then it is a quiet minute. When the clock (or the sound) ends, or the page is hidden,
// it moves on to the step.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAudioPlayer, type AudioPlayer } from "./audio";
import { useStopOnEnd, type ActivityRun } from "./useActivity";

export type ListenPhase = "ready" | "listening" | "after";

export interface Listen {
  phase: ListenPhase;
  elapsedMs: number;
  maxMs: number;
  sound: boolean;
  light: boolean;
  setSound: (on: boolean) => void;
  setLight: (on: boolean) => void;
  start: () => void;
  skip: () => void;
  /** For the <audio> element: ref={audioRef}. */
  audioRef: AudioPlayer["ref"];
  /** True when the sound could not play here (the session goes on without it). */
  soundFailed: boolean;
}

export function useListen(run: ActivityRun, opts: { maxMs: number; fadeMs: number }): Listen {
  const { maxMs, fadeMs } = opts;
  const player = useAudioPlayer();
  const { markStarted } = run;
  const [phase, setPhase] = useState<ListenPhase>("ready");
  const [sound, setSoundState] = useState(true);
  const [light, setLight] = useState(true);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  });

  const finish = useCallback(() => {
    player.stop();
    setPhase((p) => (p === "listening" ? "after" : p));
  }, [player]);

  /** "Go straight to the step", from before or during the listening. */
  const skip = useCallback(() => {
    markStarted();
    player.stop();
    setPhase("after");
  }, [player, markStarted]);

  const start = useCallback(() => {
    markStarted();
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    setPhase("listening");
    if (sound) player.play({ maxMs, fadeMs, onEnd: finish });
  }, [markStarted, sound, player, maxMs, fadeMs, finish]);

  const setSound = useCallback(
    (on: boolean) => {
      setSoundState(on);
      if (phaseRef.current !== "listening") return;
      if (!on) player.stop();
      else if (startedAt !== null) player.play({ maxMs, fadeMs, fromMs: Date.now() - startedAt, onEnd: finish });
    },
    [player, startedAt, maxMs, fadeMs, finish],
  );

  // The clock: ends the listening at maxMs, sound or not.
  useEffect(() => {
    if (phase !== "listening" || startedAt === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t - startedAt >= maxMs) finish();
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, startedAt, maxMs, finish]);

  // Hidden while listening: the sound has stopped (the player does that); go on to the step.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden" && phaseRef.current === "listening") finish();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [finish]);

  useStopOnEnd(run, () => {
    player.stop();
    setLight(false);
  });

  return {
    phase,
    elapsedMs: startedAt === null ? 0 : Math.min(maxMs, Math.max(0, now - startedAt)),
    maxMs,
    sound,
    light,
    setSound,
    setLight,
    start,
    skip,
    audioRef: player.ref,
    soundFailed: player.state === "failed",
  };
}
