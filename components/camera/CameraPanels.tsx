"use client";

// The three small panels under the picture: movement, face and posture. Each number has one
// plain line saying what it means. Behaviour only: never a feeling, never a verdict.

import type { ExpressionLive, LiveMovement, PostureLive } from "@/lib/camera";
import s from "./camera.module.css";

function movementWords(v: number): string {
  if (v < 8) return "Still";
  if (v < 35) return "A little";
  if (v < 70) return "Some";
  return "A lot";
}

function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return m ? `${m}:${String(r).padStart(2, "0")}` : `${r} s`;
}

function postureWords(p: PostureLive): string {
  switch (p.state) {
    case "learning":
      return `Learning how you usually sit, ${clock(p.learningLeftSec)} left`;
    case "upright":
      return "More upright than your usual";
    case "slumped":
      return "More slumped than your usual";
    case "usual":
      return "About your usual";
    default:
      return "No one in frame";
  }
}

function Bar({ value, label, words, data }: { value: number; label: string; words: string; data: string }) {
  return (
    <div
      className={s.meter}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={words}
      data-meter={data}
      data-value={value}
    >
      <span className={s.meterFill} style={{ width: `${value}%` }} />
    </div>
  );
}

export function CameraPanels({
  movement,
  expression,
  posture,
  active,
  faceAvailable,
  usualWords,
}: {
  movement: LiveMovement;
  expression: ExpressionLive;
  posture: PostureLive;
  /** The camera or the example is running. */
  active: boolean;
  faceAvailable: boolean;
  /** What 100 is: "how you sat in your first two minutes", or for the example its own words. */
  usualWords: string;
}) {
  const mv = active ? movement.display : 0;
  const face = active ? expression.animationDisplay : 0;
  const share = Math.round(expression.smilingShare * 100);
  let faceLine: string;
  if (!active) faceLine = "Off";
  else if (!faceAvailable) faceLine = "Not available here";
  else if (!expression.present) faceLine = "No face in view";
  else faceLine = `Smiling ${share}% of the time`;

  return (
    <div className={s.panels} data-active={active || undefined}>
      <section className={`card ${s.panel}`} aria-label="Movement">
        <h2 className={s.panelLabel}>Movement</h2>
        <Bar value={mv} label="Movement" words={active ? movementWords(mv) : "Off"} data="movement" />
        <p className={s.panelValue}>
          {active ? movementWords(mv) : "Off"}
          <span className={s.panelSub}>
            <span data-shifts={movement.shifts}>{movement.shifts}</span> position{" "}
            {movement.shifts === 1 ? "change" : "changes"}
          </span>
        </p>
        <p className={s.meaning}>
          The bar is how much you move right now. A new position counts when you hold it for three seconds.
        </p>
      </section>

      <section className={`card ${s.panel}`} aria-label="Face">
        <h2 className={s.panelLabel}>Face</h2>
        <Bar value={face} label="How much the face moves" words={active ? `${face} of 100` : "Off"} data="face" />
        <p className={s.panelValue} data-smiling-share={active ? share : undefined} data-face={faceLine}>
          {faceLine}
        </p>
        <p className={s.meaning}>The bar is how much your face moves. Smiling means the mouth corners are raised.</p>
      </section>

      <section className={`card ${s.panel}`} aria-label="Posture">
        <h2 className={s.panelLabel}>Posture</h2>
        <p className={s.panelNumber} data-posture={active ? posture.state : "off"} data-relative={posture.relative ?? undefined}>
          {active && posture.relative !== null ? posture.relative : " "}
        </p>
        <p className={s.panelValue}>{active ? postureWords(posture) : "Off"}</p>
        <p className={s.meaning}>
          Head height above the shoulders. 100 is {usualWords}.
        </p>
      </section>
    </div>
  );
}
