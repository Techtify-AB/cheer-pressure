"use client";

// The audio player the activities share, and the timer's chime.
//
// - One <audio> element per player, in the page, loaded ahead (preload="auto"), so a sound
//   already on screen plays without the network.
// - Fade-out: by the element's volume where the browser lets it change. iOS keeps an
//   element's volume at 1, so there the element is routed through a Web Audio gain instead.
//   On iOS 17 and later the page asks for "playback" audio, so the silent switch does not
//   mute it (older iOS: a Web Audio sound follows the silent switch; see the report).
// - It ALWAYS stops and goes back to the start when the view is left (unmount), when the page
//   is hidden (another app, the screen locked) and on "End".

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Ctx = AudioContext;
let sharedCtx: Ctx | null = null;

function audioContext(): Ctx | null {
  if (typeof window === "undefined") return null;
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return null;
  try {
    sharedCtx ??= new C();
  } catch {
    return null;
  }
  return sharedCtx;
}

/** On iOS 17+: let sound play with the silent switch on, like a music app. Elsewhere: nothing. */
function preferPlayback() {
  const nav = navigator as Navigator & { audioSession?: { type: string } };
  try {
    if (nav.audioSession && nav.audioSession.type !== "playback") nav.audioSession.type = "playback";
  } catch {
    // not supported here
  }
}

/** Some browsers (iOS) keep an element's volume at 1. */
function volumeWorks(el: HTMLAudioElement): boolean {
  const before = el.volume;
  try {
    el.volume = 0.5;
    const ok = Math.abs(el.volume - 0.5) < 0.01;
    el.volume = before;
    return ok;
  } catch {
    return false;
  }
}

export type PlayerState = "idle" | "playing" | "fading" | "failed";

export interface AudioPlayer {
  ref: React.RefObject<HTMLAudioElement | null>;
  state: PlayerState;
  /** Plays from `fromMs` for at most `maxMs`, fading out over the last `fadeMs`. */
  play: (opts: { maxMs: number; fadeMs: number; fromMs?: number; onEnd?: () => void }) => void;
  /** Fades out, then stops and resets. */
  fadeOut: (ms: number) => void;
  /** Stops at once and goes back to the start. */
  stop: () => void;
}

export function useAudioPlayer(): AudioPlayer {
  const ref = useRef<HTMLAudioElement | null>(null);
  const gain = useRef<GainNode | null>(null);
  const routed = useRef(false);
  const timers = useRef<number[]>([]);
  const ramp = useRef<number | null>(null);
  const onEnd = useRef<(() => void) | null>(null);
  const [state, setState] = useState<PlayerState>("idle");

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
    if (ramp.current !== null) window.clearInterval(ramp.current);
    ramp.current = null;
  }, []);

  const setLevel = useCallback((v: number) => {
    const el = ref.current;
    if (!el) return;
    if (gain.current) {
      const ctx = gain.current.context;
      gain.current.gain.cancelScheduledValues(ctx.currentTime);
      gain.current.gain.setValueAtTime(v, ctx.currentTime);
    } else {
      el.volume = Math.max(0, Math.min(1, v));
    }
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    const el = ref.current;
    if (el) {
      el.pause();
      try {
        el.currentTime = 0;
      } catch {
        // not loaded yet
      }
    }
    setLevel(1);
    onEnd.current = null;
    setState("idle");
  }, [clearTimers, setLevel]);

  const fadeOut = useCallback(
    (ms: number) => {
      const el = ref.current;
      if (!el || el.paused) {
        stop();
        return;
      }
      clearTimers();
      setState("fading");
      const done = () => {
        const cb = onEnd.current;
        stop();
        cb?.();
      };
      if (gain.current) {
        const ctx = gain.current.context;
        const g = gain.current.gain;
        g.cancelScheduledValues(ctx.currentTime);
        g.setValueAtTime(g.value, ctx.currentTime);
        g.linearRampToValueAtTime(0, ctx.currentTime + ms / 1000);
      } else {
        const start = el.volume;
        const t0 = performance.now();
        ramp.current = window.setInterval(() => {
          const k = Math.min(1, (performance.now() - t0) / ms);
          el.volume = Math.max(0, start * (1 - k));
        }, 50);
      }
      timers.current.push(window.setTimeout(done, ms));
    },
    [clearTimers, stop],
  );

  const play = useCallback(
    ({ maxMs, fadeMs, fromMs = 0, onEnd: cb }: { maxMs: number; fadeMs: number; fromMs?: number; onEnd?: () => void }) => {
      const el = ref.current;
      if (!el) return;
      clearTimers();
      preferPlayback();
      if (!routed.current) {
        routed.current = true;
        if (!volumeWorks(el)) {
          const ctx = audioContext();
          if (ctx) {
            try {
              const source = ctx.createMediaElementSource(el);
              const g = ctx.createGain();
              source.connect(g).connect(ctx.destination);
              gain.current = g;
            } catch {
              gain.current = null;
            }
          }
        }
      }
      if (gain.current && gain.current.context.state === "suspended") void (gain.current.context as AudioContext).resume();
      setLevel(1);
      try {
        el.currentTime = fromMs / 1000;
      } catch {
        // not loaded yet: starts from the beginning
      }
      onEnd.current = cb ?? null;
      const left = Math.max(0, maxMs - fromMs);
      setState("playing");
      el.play().then(
        () => {
          timers.current.push(window.setTimeout(() => fadeOut(Math.min(fadeMs, left)), Math.max(0, left - fadeMs)));
        },
        () => {
          // Blocked or could not load: the activity goes on without sound.
          setState("failed");
        },
      );
    },
    [clearTimers, setLevel, fadeOut],
  );

  // Hidden (another app, screen locked) or left: stop and reset, always.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") stop();
    };
    const onPageHide = () => stop();
    const el = ref.current;
    const onEnded = () => {
      const cb = onEnd.current;
      stop();
      cb?.();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    el?.addEventListener("ended", onEnded);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      el?.removeEventListener("ended", onEnded);
      stop();
      // On unmount the ref is already detached, so the element is stopped and reset directly.
      if (el) {
        el.pause();
        try {
          el.currentTime = 0;
        } catch {
          // not loaded
        }
      }
    };
  }, [stop]);

  return useMemo(() => ({ ref, state, play, fadeOut, stop }), [state, play, fadeOut, stop]);
}

/** The <audio> element a player drives. Not shown; the activity has its own controls. */
export function audioProps(src: string) {
  return { src, preload: "auto" as const, playsInline: true, "data-activity-audio": "" };
}

/**
 * A soft two-note chime for the end of a timer, made on the spot with Web Audio, and a short
 * vibration where the device has one. `unlock` must be called from a tap first (browsers only
 * allow sound after one): the timer's start button does that.
 */
export const chime = {
  unlock() {
    const ctx = audioContext();
    if (ctx && ctx.state === "suspended") void ctx.resume();
    preferPlayback();
  },
  ring() {
    try {
      navigator.vibrate?.([120, 80, 120]);
    } catch {
      // no vibration here
    }
    const ctx = audioContext();
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    for (const [freq, at] of [
      [660, 0],
      [880, 0.35],
    ] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t + at);
      g.gain.linearRampToValueAtTime(0.25, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + 1.4);
      o.connect(g).connect(ctx.destination);
      o.start(t + at);
      o.stop(t + at + 1.5);
    }
  },
};
