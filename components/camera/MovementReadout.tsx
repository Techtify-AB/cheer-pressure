"use client";

import s from "./camera.module.css";

function meterWords(v: number): string {
  if (v < 8) return "Still";
  if (v < 35) return "A little movement";
  if (v < 70) return "Some movement";
  return "A lot of movement";
}

/** The movement meter and the count of position changes, each with one line saying what it means. */
export function MovementReadout({ display, shifts, active }: { display: number; shifts: number; active: boolean }) {
  return (
    <div className={s.readout} data-active={active || undefined}>
      <div className={`card ${s.tile}`}>
        <div className={s.tileHead}>
          <span className={s.tileLabel}>Movement</span>
          <span className={s.tileState}>{active ? meterWords(display) : "Off"}</span>
        </div>
        <div
          className={s.meter}
          role="meter"
          aria-label="Movement"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={display}
          aria-valuetext={active ? meterWords(display) : "Off"}
          data-value={display}
        >
          <span className={s.meterFill} style={{ width: `${active ? display : 0}%` }} />
        </div>
        <p className={s.meaning}>How much you are moving right now</p>
      </div>
      <div className={`card ${s.tile}`}>
        <div className={s.tileHead}>
          <span className={s.tileLabel}>Position changes</span>
        </div>
        <p className={s.count} data-shifts={shifts} aria-live="polite">
          {shifts}
        </p>
        <p className={s.meaning}>A new position counts when you hold it for three seconds</p>
      </div>
    </div>
  );
}
