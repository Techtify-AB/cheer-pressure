"use client";

// The companion character: "Dot", the designer's real-time three.js model (dot.js).
//
// To change the character, replace dot.js (same createCompanion API) or this file.
// Nothing else in the app needs to change: pages only pass `state` and `size`.
// If WebGL is not available, a plain drawn stand-in is shown instead.

import { useEffect, useRef, useState } from "react";
import styles from "./Companion.module.css";
import type { DotHandle } from "./dot";

export type CompanionState =
  | "idle"
  | "speaking"
  | "listening"
  | "thinking"
  | "attention"
  | "joy"
  | "concern"
  | "sleeping"
  | "celebrate";

export interface CompanionProps {
  state: CompanionState;
  /** Width and height in px. */
  size?: number;
  /** A palette name from dot.js (peach, butter, mint, sky, lilac, offwhite) or any CSS colour. */
  color?: string;
}

const STATE_LABEL: Record<CompanionState, string> = {
  idle: "Cheri is resting",
  speaking: "Cheri is speaking",
  listening: "Cheri is listening",
  thinking: "Cheri is thinking",
  attention: "Cheri would like your attention",
  joy: "Cheri is glad",
  concern: "Cheri is concerned",
  sleeping: "Cheri is sleeping",
  celebrate: "Cheri is celebrating",
};

/** Below this size the extra effects (rings, sparkles) do not fit, so only the dot is drawn. */
const COMPACT_BELOW_PX = 200;

export function Companion({ state, size = 160, color = "peach" }: CompanionProps) {
  const holder = useRef<HTMLDivElement>(null);
  const dot = useRef<DotHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const compact = size < COMPACT_BELOW_PX;

  useEffect(() => {
    let cancelled = false;
    const el = holder.current;
    if (!el) return;
    import("./dot")
      .then(({ createCompanion }) => {
        if (cancelled) return;
        try {
          dot.current = createCompanion(el, {
            mood: state,
            color,
            rings: !compact,
            effects: !compact,
            zoom: compact ? 1.6 : 1,
          });
        } catch {
          setFailed(true);
        }
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      dot.current?.destroy();
      dot.current = null;
    };
    // The model is created once; mood, colour and framing are updated below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    dot.current?.setMood(state);
  }, [state]);

  useEffect(() => {
    dot.current?.setColor(color);
  }, [color]);

  useEffect(() => {
    dot.current?.setOptions({ rings: !compact, effects: !compact, zoom: compact ? 1.6 : 1 });
  }, [compact]);

  return (
    <div
      className={styles.wrap}
      data-state={state}
      role="img"
      aria-label={STATE_LABEL[state]}
      style={{ width: size, height: size }}
    >
      {failed ? <StandIn state={state} /> : <div ref={holder} className={styles.canvas} />}
    </div>
  );
}

/** Shown only when the 3D model cannot start (no WebGL). */
function StandIn({ state }: { state: CompanionState }) {
  return (
    <svg viewBox="0 0 160 160" aria-hidden="true" className={styles.svg}>
      <g className={styles.body}>
        <circle cx="80" cy="84" r="50" className={styles.skin} />
        <g className={styles.eyes}>
          <ellipse cx="64" cy="80" rx="5" ry="7" />
          <ellipse cx="96" cy="80" rx="5" ry="7" />
        </g>
        {state === "speaking" && <ellipse cx="80" cy="104" rx="7" ry="5" className={styles.mouthTalk} />}
      </g>
    </svg>
  );
}
