// Unit tests for the movement calculation (lib/camera/movement.ts), on made-up landmark
// sequences only. No camera, no browser.
//
//   npx tsx scripts/test-camera.mts

import {
  createTracker,
  DISPLAY_SCALE,
  HOLD_MS,
  isSeen,
  positionDistance,
  positionOf,
  SAMPLE_MS,
  STILL_RADIUS,
  toDisplay,
  type PoseFrame,
  type TrackerEvent,
} from "../lib/camera/movement.ts";

function positionOfFrame(f: PoseFrame) {
  const p = f.points!;
  const a = f.aspect;
  return positionOf({
    nx: p.nose.x * a,
    ny: p.nose.y,
    lx: p.leftShoulder.x * a,
    ly: p.leftShoulder.y,
    rx: p.rightShoulder.x * a,
    ry: p.rightShoulder.y,
  });
}
import {
  EXAMPLE_SHIFTS,
  exampleFrames,
  moved,
  SITTING,
  synthesise,
  type Key,
} from "../lib/camera/synthetic.ts";

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail: string) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}  (${detail})`);
}

interface Run {
  shifts: number;
  shiftTimes: number[];
  seconds: { t: number; raw: number; display: number }[];
  presence: { t: number; present: boolean }[];
  meanRaw: number;
  minutes: number;
}

function run(frames: PoseFrame[]): Run {
  const tr = createTracker({ source: "demo", startedAt: Date.parse("2026-11-14T10:00:00") });
  const shiftTimes: number[] = [];
  const seconds: Run["seconds"] = [];
  const presence: Run["presence"] = [];
  for (const f of frames) {
    const ev: TrackerEvent[] = tr.push(f);
    for (const e of ev) {
      if (e.type === "shift") shiftTimes.push(f.t);
      if (e.type === "second") seconds.push({ t: f.t, raw: e.raw, display: e.display });
    }
    presence.push({ t: f.t, present: tr.live().present });
  }
  const live = tr.live();
  const present = seconds.filter((s, i) => i > 0);
  const meanRaw = present.length ? present.reduce((a, s) => a + s.raw, 0) / present.length : 0;
  return { shifts: live.shifts, shiftTimes, seconds, presence, meanRaw, minutes: live.minutesInFrame };
}

const maxDisplay = (r: Run, from = 0, to = Infinity) =>
  Math.max(0, ...r.seconds.filter((s) => s.t >= from && s.t < to).map((s) => s.display));

// 1. Sitting still for a minute: no changes, low movement.
{
  const r = run(synthesise([{ t: 0, pose: SITTING }], 60000, { jitter: 0.002, seed: 1 }));
  check("still: no position changes", r.shifts === 0, `${r.shifts} changes`);
  check("still: movement stays low", maxDisplay(r) <= 10, `meter at most ${maxDisplay(r)} of 100, mean ${r.meanRaw.toFixed(3)} widths/s`);
}

// 2. A slow lean (3 s), then held: exactly one change, counted only after 3 s held.
{
  const leaned = moved(SITTING, { dy: 0.04, closer: 1.25, dhy: 0.12 });
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 10000, pose: SITTING },
    { t: 13000, pose: leaned },
    { t: 30000, pose: leaned },
  ];
  const r = run(synthesise(keys, 30000, { seed: 2 }));
  check("slow lean held: exactly one change", r.shifts === 1, `${r.shifts} changes at ${r.shiftTimes.map((t) => (t / 1000).toFixed(1) + " s").join(", ")}`);
  // When the eased lean has come to rest (within STILL_RADIUS of where it ends), from the clean sequence.
  const clean = synthesise(keys, 30000, { jitter: 0 });
  const end = positionOfFrame(clean[clean.length - 1]);
  const settled = clean.find((f) => f.t >= 10000 && positionDistance(positionOfFrame(f), end) <= STILL_RADIUS)!.t;
  const at = r.shiftTimes[0] ?? 0;
  check(
    "slow lean held: counted only once held 3 s",
    at >= settled + HOLD_MS - SAMPLE_MS && at <= settled + HOLD_MS + 1000,
    `at rest from ${(settled / 1000).toFixed(2)} s, counted at ${(at / 1000).toFixed(2)} s`,
  );
}

// 2b. A lean held only 2 s, then back: none.
{
  const leaned = moved(SITTING, { dy: 0.04, closer: 1.25, dhy: 0.12 });
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 10000, pose: SITTING },
    { t: 11000, pose: leaned },
    { t: 13000, pose: leaned },
    { t: 14000, pose: SITTING },
    { t: 30000, pose: SITTING },
  ];
  const r = run(synthesise(keys, 30000, { seed: 3 }));
  check("lean held 2 s and back: no change", r.shifts === 0, `${r.shifts} changes`);
}

// 2c. A small settle, held: smaller than SHIFT_THRESHOLD, so not a new position.
{
  const settled = moved(SITTING, { dx: 0.03, dhx: 0.03 });
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 10000, pose: SITTING },
    { t: 11000, pose: settled },
    { t: 30000, pose: settled },
  ];
  const clean = synthesise(keys, 30000, { jitter: 0 });
  const d = positionDistance(positionOfFrame(clean[0]), positionOfFrame(clean[clean.length - 1]));
  const r = run(synthesise(keys, 30000, { seed: 14 }));
  check("small settle held: no change", r.shifts === 0, `${r.shifts} changes, moved ${d.toFixed(2)} shoulder widths`);
}

// 3. A quick lean of 1 s that returns: none.
{
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 10000, pose: SITTING },
    { t: 10500, pose: moved(SITTING, { dy: 0.04, closer: 1.3, dhy: 0.15 }) },
    { t: 11000, pose: SITTING },
    { t: 30000, pose: SITTING },
  ];
  const r = run(synthesise(keys, 30000, { seed: 4 }));
  check("1 s lean that returns: no change", r.shifts === 0, `${r.shifts} changes`);
  check("1 s lean: the meter moved", maxDisplay(r, 10000, 13000) >= 15, `meter up to ${maxDisplay(r, 10000, 13000)}`);
}

// 4. Heavy jitter, with now and then a point jumping: none, and the meter stays low.
{
  const frames = synthesise([{ t: 0, pose: SITTING }], 60000, { jitter: 0.004, seed: 5 });
  // Every 40th frame, one shoulder jumps (a detection glitch).
  frames.forEach((f, i) => {
    if (i % 40 === 20 && f.points) f.points.leftShoulder.x += 0.03;
  });
  const r = run(frames);
  check("jitter and glitches: no change", r.shifts === 0, `${r.shifts} changes`);
  check("jitter: movement stays low", maxDisplay(r) <= 25, `meter at most ${maxDisplay(r)}`);
}

// 5. Leaving the frame and coming back to the same place: presence follows, no false change.
{
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 20000, pose: SITTING },
    { t: 20001, pose: null },
    { t: 35000, pose: moved(SITTING, { dx: 0.02 }) },
    { t: 60000, pose: moved(SITTING, { dx: 0.02 }) },
  ];
  const r = run(synthesise(keys, 60000, { seed: 6 }));
  const at = (t: number) => r.presence.find((p) => p.t >= t)?.present;
  check("leave and return: in frame before", at(15000) === true, `at 15 s: ${at(15000)}`);
  check("leave and return: still in frame within the grace period", at(21000) === true, `at 21 s: ${at(21000)}`);
  check("leave and return: out of frame after the grace period", at(23000) === false && at(34000) === false, `at 23 s: ${at(23000)}, 34 s: ${at(34000)}`);
  check("leave and return: in frame again", at(36000) === true, `at 36 s: ${at(36000)}`);
  check("leave and return: no position change", r.shifts === 0, `${r.shifts} changes`);
  check("leave and return: the return is not movement", maxDisplay(r, 34000, 40000) <= 10, `meter at most ${maxDisplay(r, 34000, 40000)} on return`);
  check("leave and return: minutes count only time in frame", Math.abs(r.minutes - 47 / 60) < 0.06, `${r.minutes.toFixed(2)} min, expected about ${(47 / 60).toFixed(2)}`);
}

// 5b. Leaving and coming back in a different place is a new reference, not a change.
{
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 20000, pose: SITTING },
    { t: 20001, pose: null },
    { t: 30000, pose: moved(SITTING, { dx: -0.15 }) },
    { t: 50000, pose: moved(SITTING, { dx: -0.15 }) },
  ];
  const r = run(synthesise(keys, 50000, { seed: 8 }));
  check("return in another place: no change", r.shifts === 0, `${r.shifts} changes`);
}

// 6. The same movement near and far from the camera gives similar values.
{
  const sway = (base: typeof SITTING): Key[] => {
    const keys: Key[] = [{ t: 0, pose: base }];
    // Sway a third of a shoulder width to the side and back, every 2 s, for 30 s.
    for (let i = 1; i <= 15; i++) {
      keys.push({ t: i * 2000 - 1000, pose: moved(base, { dx: (base.w / 3) * (i % 2 ? 1 : -1) }) });
      keys.push({ t: i * 2000, pose: base });
    }
    return keys;
  };
  const near = { ...SITTING, w: 0.42 };
  const far = { ...SITTING, w: 0.18, y: 0.6 };
  const rn = run(synthesise(sway(near), 30000, { jitter: 0.002, seed: 9 }));
  const rf = run(synthesise(sway(far), 30000, { jitter: 0.002, seed: 9 }));
  const ratio = rf.meanRaw / rn.meanRaw;
  check(
    "near and far: similar movement",
    ratio > 0.8 && ratio < 1.25,
    `near ${rn.meanRaw.toFixed(3)}, far ${rf.meanRaw.toFixed(3)} widths/s, far/near ${ratio.toFixed(2)}`,
  );
  check("near and far: neither counts swaying as a change", rn.shifts === 0 && rf.shifts === 0, `near ${rn.shifts}, far ${rf.shifts}`);
  // Far away, the same jitter in the picture is larger compared with the shoulders.
  const still = run(synthesise([{ t: 0, pose: far }], 60000, { jitter: 0.002, seed: 13 }));
  check("far away and still: movement stays low", maxDisplay(still) <= 20 && still.shifts === 0, `meter at most ${maxDisplay(still)}, ${still.shifts} changes`);
}

// 7. The recorded example on the screen counts what its script says.
{
  const r = run(exampleFrames());
  check("example: counts the two held positions", r.shifts === EXAMPLE_SHIFTS, `${r.shifts} changes at ${r.shiftTimes.map((t) => (t / 1000).toFixed(1) + " s").join(", ")}`);
  check("example: quiet at the start", maxDisplay(r, 0, 8000) <= 10, `meter at most ${maxDisplay(r, 0, 8000)} in the first 8 s`);
  check("example: the brief lean shows on the meter", maxDisplay(r, 8000, 11000) >= 20, `meter up to ${maxDisplay(r, 8000, 11000)}`);
}

// 8. A session is summarised when it is long enough, in the agreed shape.
{
  const leaned = moved(SITTING, { dx: 0.1, closer: 1.2 });
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 60000, pose: SITTING },
    { t: 62000, pose: leaned },
    { t: 180000, pose: leaned },
  ];
  const frames = synthesise(keys, 180000, { seed: 10 });
  const tr = createTracker({ source: "computer", startedAt: Date.parse("2026-11-14T10:00:00") });
  for (const f of frames) tr.push(f);
  const s = tr.end();
  check(
    "session summary on stop",
    !!s && s.date === "2026-11-14" && Math.abs(s.minutes - 3) < 0.1 && s.source === "computer" && Math.abs(s.shiftsPerHour - 20) < 1,
    JSON.stringify(s),
  );
  // A minute is too short to say anything.
  const tr2 = createTracker({ source: "computer", startedAt: Date.now() });
  for (const f of synthesise([{ t: 0, pose: SITTING }], 60000, { seed: 11 })) tr2.push(f);
  check("a 1 minute session is not summarised", tr2.end() === null, "null");
}

// 9. Five minutes out of frame ends the session by itself.
{
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 150000, pose: SITTING },
    { t: 150001, pose: null },
    { t: 500000, pose: null },
  ];
  const tr = createTracker({ source: "computer", startedAt: Date.parse("2026-11-14T10:00:00") });
  let session: unknown = null;
  let at = 0;
  for (const f of synthesise(keys, 500000, { seed: 12, fps: 4 })) {
    for (const e of tr.push(f)) if (e.type === "session") {
      session = e.session;
      at = f.t;
    }
  }
  check("5 minutes without anyone: session ends", !!session && at >= 450000 && at < 452000, `ended at ${(at / 1000).toFixed(0)} s: ${JSON.stringify(session)}`);
}

// 10. Odd input does not count as someone.
{
  check("low visibility is not someone", !isSeen({ t: 0, aspect: 1, points: { nose: { x: 0.5, y: 0.3, visibility: 0.2 }, leftShoulder: { x: 0.6, y: 0.6 }, rightShoulder: { x: 0.4, y: 0.6 } } }), "");
  check("shoulders on top of each other is not someone", !isSeen({ t: 0, aspect: 1, points: { nose: { x: 0.5, y: 0.3 }, leftShoulder: { x: 0.5, y: 0.6 }, rightShoulder: { x: 0.505, y: 0.6 } } }), "");
  check("meter mapping", toDisplay(0) === 0 && toDisplay(DISPLAY_SCALE) === 63 && toDisplay(10) === 100, `${toDisplay(0)}, ${toDisplay(DISPLAY_SCALE)}, ${toDisplay(10)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
