// The companion character. A placeholder: the final look is not decided.
//
// To swap the character, replace this file (and Companion.module.css) with any
// component that takes the same props. Nothing else in the app needs to change.
// Colours come from the --companion-* tokens in styles/tokens.css.

import styles from "./Companion.module.css";

export type CompanionState = "idle" | "speaking" | "listening";

export interface CompanionProps {
  state: CompanionState;
  /** Width in px. Height follows. */
  size?: number;
}

const STATE_LABEL: Record<CompanionState, string> = {
  idle: "The companion is resting",
  speaking: "The companion is speaking",
  listening: "The companion is listening",
};

export function Companion({ state, size = 160 }: CompanionProps) {
  return (
    <div className={styles.wrap} data-state={state} style={{ width: size }}>
      <svg viewBox="0 0 160 140" role="img" aria-label={STATE_LABEL[state]} className={styles.svg}>
        <ellipse cx="80" cy="132" rx="38" ry="5" className={styles.shadow} />

        {/* listening: sound coming in from both sides */}
        <g className={styles.waves} aria-hidden="true">
          <path d="M18 64 q-8 14 0 28" />
          <path d="M8 56 q-12 22 0 44" />
          <path d="M142 64 q8 14 0 28" />
          <path d="M152 56 q12 22 0 44" />
        </g>

        <g className={styles.body}>
          <path
            d="M80 24 C112 24 128 48 128 80 C128 110 108 126 80 126 C52 126 32 110 32 80 C32 48 48 24 80 24 Z"
            className={styles.skin}
          />
          <path d="M80 24 C96 24 104 18 102 10 C98 16 90 20 80 24 Z" className={styles.leaf} />
          <ellipse cx="56" cy="92" rx="8" ry="5" className={styles.cheek} />
          <ellipse cx="104" cy="92" rx="8" ry="5" className={styles.cheek} />

          <g className={styles.eyes}>
            <ellipse cx="63" cy="76" rx="5" ry="7" />
            <ellipse cx="97" cy="76" rx="5" ry="7" />
          </g>

          {state === "speaking" ? (
            <ellipse cx="80" cy="99" rx="8" ry="6" className={styles.mouthTalk} />
          ) : state === "listening" ? (
            <circle cx="80" cy="99" r="3.5" className={styles.mouthListen} />
          ) : (
            <path d="M71 96 q9 8 18 0" className={styles.mouthIdle} />
          )}
        </g>

        {/* speaking: little lines next to the mouth */}
        <g className={styles.talkLines} aria-hidden="true">
          <path d="M132 40 l10 -8" />
          <path d="M136 54 l13 -2" />
        </g>
      </svg>
    </div>
  );
}
