// Unit tests for the camera measures (lib/camera: movement, expression, posture) and the tone
// of voice (lib/voice/tone.ts), on made-up landmark, blendshape and sound sequences only.
// No camera, no microphone, no browser.
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
  EXAMPLE_CALIBRATION_MS,
  EXAMPLE_SHIFTS,
  EXAMPLE_SMILES,
  exampleFaceFrames,
  exampleFrames,
  moved,
  NEUTRAL,
  SITTING,
  synthesise,
  synthesiseFace,
  type FaceKey,
  type Key,
} from "../lib/camera/synthetic.ts";
import { createExpressionTracker, type ExpressionLive, type FaceFrame } from "../lib/camera/expression.ts";
import { CALIBRATION_MS, createPostureTracker, type PostureLive } from "../lib/camera/posture.ts";
import { createToneTracker, detectPitch, LEVEL_FLOOR_DB, toLevel, type AudioFrame, type ToneLive } from "../lib/voice/tone.ts";
import { bursts, signalFrames, voiceExampleFrames } from "../lib/voice/synthetic.ts";

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
  check("shoulders 0.02 of the picture apart is not someone", !isSeen({ t: 0, aspect: 1, points: { nose: { x: 0.5, y: 0.5 }, leftShoulder: { x: 0.51, y: 0.6 }, rightShoulder: { x: 0.49, y: 0.6 } } }), "");
  check("someone small and far away (shoulders 0.08 apart) is someone", isSeen({ t: 0, aspect: 1, points: { nose: { x: 0.5, y: 0.5 }, leftShoulder: { x: 0.54, y: 0.56 }, rightShoulder: { x: 0.46, y: 0.56 } } }), "");
  check("meter mapping", toDisplay(0) === 0 && toDisplay(DISPLAY_SCALE) === 63 && toDisplay(10) === 100, `${toDisplay(0)}, ${toDisplay(DISPLAY_SCALE)}, ${toDisplay(10)}`);
}

// ---------------------------------------------------------------------------------------
// Expression (lib/camera/expression.ts), on made-up blendshape sequences.
// ---------------------------------------------------------------------------------------

function runFace(frames: FaceFrame[]) {
  const tr = createExpressionTracker();
  const live: { t: number; l: ExpressionLive }[] = [];
  for (const f of frames) {
    tr.push(f);
    live.push({ t: f.t, l: tr.live() });
  }
  return { last: tr.live(), live, session: tr.end() };
}
const maxAnim = (r: ReturnType<typeof runFace>, a = 0, b = Infinity) =>
  Math.max(0, ...r.live.filter((x) => x.t >= a && x.t < b).map((x) => x.l.animationDisplay));

// E1. Neutral for a minute: no smiling, no lowered brows, little animation.
{
  const r = runFace(synthesiseFace([{ t: 0, face: NEUTRAL }], 60000, { seed: 21 }));
  check("face neutral: no smiling", r.last.smiles === 0 && r.last.smilingShare === 0, `${r.last.smiles} smiles, share ${r.last.smilingShare}`);
  check("face neutral: little animation", maxAnim(r) <= 10, `bar at most ${maxAnim(r)}`);
  check("face neutral: brows not lowered", r.last.browLoweredShare === 0, `share ${r.last.browLoweredShare}`);
}

// E2. One smile of 2 s in a minute.
{
  const keys: FaceKey[] = [
    { t: 0, face: NEUTRAL },
    { t: 20000, face: NEUTRAL },
    { t: 20300, face: { ...NEUTRAL, smile: 0.75 } },
    { t: 22000, face: { ...NEUTRAL, smile: 0.75 } },
    { t: 22300, face: NEUTRAL },
    { t: 60000, face: NEUTRAL },
  ];
  const r = runFace(synthesiseFace(keys, 60000, { seed: 22 }));
  check("one smile: counted once", r.last.smiles === 1, `${r.last.smiles} smiles`);
  check("one smile: about 2 s of a minute", Math.abs(r.last.smilingShare - 2 / 60) < 0.012, `share ${r.last.smilingShare.toFixed(3)}, expected about ${(2 / 60).toFixed(3)}`);
}

// E2b. A flicker of the mouth corners shorter than SMILE_MIN_MS is not a smile.
{
  const keys: FaceKey[] = [
    { t: 0, face: NEUTRAL },
    { t: 20000, face: NEUTRAL },
    { t: 20100, face: { ...NEUTRAL, smile: 0.75 } },
    { t: 20250, face: { ...NEUTRAL, smile: 0.75 } },
    { t: 20350, face: NEUTRAL },
    { t: 30000, face: NEUTRAL },
  ];
  const r = runFace(synthesiseFace(keys, 30000, { seed: 28, jitter: 0.005 }));
  check("a 0.25 s flicker: not a smile", r.last.smiles === 0, `${r.last.smiles} smiles`);
}

// E3. A sustained smile, 20 s of 60.
{
  const keys: FaceKey[] = [
    { t: 0, face: NEUTRAL },
    { t: 20000, face: NEUTRAL },
    { t: 20300, face: { ...NEUTRAL, smile: 0.7 } },
    { t: 40000, face: { ...NEUTRAL, smile: 0.7 } },
    { t: 40300, face: NEUTRAL },
    { t: 60000, face: NEUTRAL },
  ];
  const r = runFace(synthesiseFace(keys, 60000, { seed: 23 }));
  check("sustained smile: one smile, a third of the time", r.last.smiles === 1 && Math.abs(r.last.smilingShare - 1 / 3) < 0.02, `${r.last.smiles} smiles, share ${r.last.smilingShare.toFixed(3)}`);
  check("sustained smile: holding it still is not animation", maxAnim(r, 25000, 39000) <= 10, `bar at most ${maxAnim(r, 25000, 39000)} while holding`);
}

// E3b. A weak smile (corners at 0.3, below SMILE_ON): not counted.
{
  const r = runFace(synthesiseFace([{ t: 0, face: { ...NEUTRAL, smile: 0.3 } }], 60000, { seed: 29, jitter: 0.01 }));
  check("weak smile below the threshold: not counted", r.last.smiles === 0, `${r.last.smiles} smiles`);
}

// E4. Heavy jitter on a neutral face.
{
  const r = runFace(synthesiseFace([{ t: 0, face: NEUTRAL }], 60000, { seed: 24, jitter: 0.04 }));
  check("face jitter: no smiles, brows steady", r.last.smiles === 0 && r.last.browLoweredShare === 0, `${r.last.smiles} smiles, brow share ${r.last.browLoweredShare}`);
  check("face jitter: animation stays low", maxAnim(r) <= 20, `bar at most ${maxAnim(r)}`);
}

// E5. Talking moves the face.
{
  const keys: FaceKey[] = [
    { t: 0, face: NEUTRAL },
    { t: 10000, face: NEUTRAL },
    { t: 10500, face: { ...NEUTRAL, talk: 1 } },
    { t: 30000, face: { ...NEUTRAL, talk: 1 } },
  ];
  const r = runFace(synthesiseFace(keys, 30000, { seed: 25 }));
  check("talking: animation is high", maxAnim(r, 12000, 30000) >= 40 && maxAnim(r, 0, 10000) <= 10, `bar ${maxAnim(r, 0, 10000)} before, up to ${maxAnim(r, 12000, 30000)} while talking`);
}

// E6. The face leaves the view and comes back.
{
  const keys: FaceKey[] = [
    { t: 0, face: NEUTRAL },
    { t: 20000, face: { ...NEUTRAL, smile: 0.75 } },
    { t: 20001, face: null },
    { t: 40000, face: NEUTRAL },
    { t: 60000, face: NEUTRAL },
  ];
  const r = runFace(synthesiseFace(keys, 60000, { seed: 26 }));
  const at = (t: number) => r.live.find((x) => x.t >= t)!.l;
  check("face leaves: still in view within the grace", at(20500).present === true, "");
  check("face leaves: out of view after it", at(21500).present === false && at(39000).present === false, "");
  check("face leaves: not smiling while away", at(30000).smiling === false, "");
  check("face leaves: minutes count only time with a face", Math.abs(r.last.minutesWithFace - 40 / 60) < 0.04, `${r.last.minutesWithFace.toFixed(2)} min`);
  check("face returns: coming back is not animation", maxAnim(r, 40000, 43000) <= 10, `bar at most ${maxAnim(r, 40000, 43000)}`);
}

// E7. Lowered brows for 10 s of 60, and a session summary.
{
  const keys: FaceKey[] = [
    { t: 0, face: NEUTRAL },
    { t: 30000, face: NEUTRAL },
    { t: 30300, face: { ...NEUTRAL, brow: 0.6 } },
    { t: 40000, face: { ...NEUTRAL, brow: 0.6 } },
    { t: 40300, face: NEUTRAL },
    { t: 90000, face: NEUTRAL },
  ];
  const r = runFace(synthesiseFace(keys, 90000, { seed: 27 }));
  const s = r.session;
  check("brows lowered 10 s of 90: share about 0.11", !!s && Math.abs(s.browLoweredShare - 10 / 90) < 0.015, JSON.stringify(s));
  const short = runFace(synthesiseFace([{ t: 0, face: NEUTRAL }], 40000, { seed: 30 }));
  check("40 s with a face: not summarised", short.session === null, "null");
}

// E8. The example's face.
{
  const r = runFace(exampleFaceFrames());
  check("example face: two smiles", r.last.smiles === EXAMPLE_SMILES, `${r.last.smiles}`);
  check("example face: talking shows as animation", maxAnim(r, 12000, 15500) >= 40, `up to ${maxAnim(r, 12000, 15500)}`);
}

// ---------------------------------------------------------------------------------------
// Posture (lib/camera/posture.ts).
// ---------------------------------------------------------------------------------------

function runPosture(frames: PoseFrame[], calibrationMs?: number) {
  const tr = createPostureTracker({ calibrationMs });
  const live: { t: number; l: PostureLive }[] = [];
  for (const f of frames) {
    tr.push(f);
    live.push({ t: f.t, l: tr.live() });
  }
  return { last: tr.live(), live, session: tr.end() };
}
const states = (r: ReturnType<typeof runPosture>, a: number, b: number) =>
  [...new Set(r.live.filter((x) => x.t >= a && x.t < b).map((x) => x.l.state))].join(",");

// P1. Upright and steady for 4 minutes.
{
  const r = runPosture(synthesise([{ t: 0, pose: SITTING }], 240000, { seed: 31, fps: 6 }));
  check("posture: learning during the first two minutes", states(r, 1000, CALIBRATION_MS - 1000) === "learning", states(r, 1000, CALIBRATION_MS - 1000));
  check("posture steady: about the usual afterwards", states(r, CALIBRATION_MS + 1000, 240000) === "usual" && Math.abs((r.last.relative ?? 0) - 100) <= 2, `${states(r, CALIBRATION_MS + 1000, 240000)}, ${r.last.relative}`);
  check("posture: head height is about 0.75 shoulder widths", Math.abs((r.last.upright ?? 0) - 0.75) < 0.02, `${r.last.upright?.toFixed(3)}`);
}

// P2. Slumping gradually after the first two minutes.
{
  const slumped = moved(SITTING, { dhy: 0.2, dy: 0.02 });
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 150000, pose: SITTING },
    { t: 210000, pose: slumped },
    { t: 270000, pose: slumped },
  ];
  const r = runPosture(synthesise(keys, 270000, { seed: 32, fps: 6 }));
  const firstSlumped = r.live.find((x) => x.l.state === "slumped")?.t ?? null;
  check("gradual slump: reads as more slumped", r.last.state === "slumped" && (r.last.relative ?? 100) <= 80, `${r.last.state}, ${r.last.relative}`);
  check("gradual slump: only once it has gone on a while", firstSlumped !== null && firstSlumped > 160000, `from ${((firstSlumped ?? 0) / 1000).toFixed(0)} s`);
  check("gradual slump: summarised", !!r.session && r.session.slumpedShare > 0.3 && r.session.uprightShare === 0, JSON.stringify(r.session));
}

// P2b. Sitting more upright.
{
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 150000, pose: SITTING },
    { t: 155000, pose: moved(SITTING, { dhy: -0.15 }) },
    { t: 200000, pose: moved(SITTING, { dhy: -0.15 }) },
  ];
  const r = runPosture(synthesise(keys, 200000, { seed: 33, fps: 6 }));
  check("more upright: reads as more upright", r.last.state === "upright" && (r.last.relative ?? 0) >= 115, `${r.last.state}, ${r.last.relative}`);
}

// P3. Leaning in briefly does not change the reading.
{
  const lean = moved(SITTING, { dy: 0.04, closer: 1.3, dhy: 0.2 });
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 150000, pose: SITTING },
    { t: 150500, pose: lean },
    { t: 152000, pose: lean },
    { t: 152500, pose: SITTING },
    { t: 200000, pose: SITTING },
  ];
  const r = runPosture(synthesise(keys, 200000, { seed: 34, fps: 6 }));
  check("brief lean: stays about the usual", states(r, CALIBRATION_MS + 1000, 200000) === "usual", states(r, CALIBRATION_MS + 1000, 200000));
}

// P4. Different distances to the camera give the same reading.
{
  const near = runPosture(synthesise([{ t: 0, pose: { ...SITTING, w: 0.44 } }], 180000, { seed: 35, fps: 6 }));
  const far = runPosture(synthesise([{ t: 0, pose: { ...SITTING, w: 0.18, y: 0.6 } }], 180000, { seed: 35, fps: 6 }));
  check(
    "posture near and far: same head height",
    Math.abs((near.last.upright ?? 0) - (far.last.upright ?? 9)) < 0.03 && near.last.state === "usual" && far.last.state === "usual",
    `near ${near.last.upright?.toFixed(3)}, far ${far.last.upright?.toFixed(3)}`,
  );
  // Sitting further away than in the first minutes is not a change of posture.
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 150000, pose: SITTING },
    { t: 160000, pose: { ...SITTING, w: 0.22, y: 0.62 } },
    { t: 200000, pose: { ...SITTING, w: 0.22, y: 0.62 } },
  ];
  const r = runPosture(synthesise(keys, 200000, { seed: 36, fps: 6 }));
  check("moving back from the camera: still about the usual", r.last.state === "usual", `${r.last.state}, ${r.last.relative}`);
}

// P5. No one in frame.
{
  const keys: Key[] = [
    { t: 0, pose: SITTING },
    { t: 30000, pose: null },
    { t: 60000, pose: null },
  ];
  const r = runPosture(synthesise(keys, 60000, { seed: 37, fps: 6 }));
  check("posture with no one in frame: absent", r.last.state === "absent" && r.last.relative === null, `${r.last.state}`);
  check("posture: 30 s is not summarised", r.session === null, "null");
}

// P6. The example: learns from its first 8 s, reads more slumped while leaning in, then usual again.
{
  const r = runPosture(exampleFrames(), EXAMPLE_CALIBRATION_MS);
  check("example posture: more slumped while leaning in", states(r, 24000, 28000) === "slumped", states(r, 24000, 28000));
  check("example posture: about the usual at the end", r.last.state === "usual", `${r.last.state}, ${r.last.relative}`);
}

// ---------------------------------------------------------------------------------------
// Tone of voice (lib/voice/tone.ts), on made-up signals. Kept in this file because the file
// boundary for this work allows no new test script; it needs no camera or microphone either.
// ---------------------------------------------------------------------------------------

function runTone(frames: AudioFrame[]) {
  const tr = createToneTracker({ source: "demo", startedAt: Date.parse("2026-11-14T10:00:00") });
  let voiced = 0;
  const live: ToneLive[] = [];
  for (const f of frames) {
    if (tr.push(f).voiced) voiced++;
    live.push(tr.live());
  }
  return { voicedShare: voiced / frames.length, last: tr.live(), live, session: tr.end() };
}

// V1. A steady tone: voiced, a flat pitch, one stretch.
{
  const r = runTone(signalFrames(() => ({ f0: 200, db: -20 }), 40000));
  check("steady tone: heard as voice", r.voicedShare > 0.95, `${(r.voicedShare * 100).toFixed(0)}% of frames`);
  check("steady tone: the pitch hardly moves", (r.last.pitchVariability ?? 9) < 0.1, `${r.last.pitchVariability?.toFixed(3)} semitones`);
  const p = detectPitch(signalFrames(() => ({ f0: 200, db: -20 }), 200)[1].samples, 16000);
  check("steady tone: pitch found at 200 Hz", p !== null && Math.abs(p - 200) < 2, `${p?.toFixed(1)} Hz`);
  check("steady tone: one voiced stretch", !!r.session && r.session.segmentsPerMinute <= 2.5, JSON.stringify(r.session));
}

// V2. A varying tone: the pitch moves 3 semitones up and down.
{
  const r = runTone(signalFrames((ms) => ({ f0: 200 * 2 ** ((3 * Math.sin((2 * Math.PI * ms) / 2000)) / 12), db: -20 }), 40000));
  check("varying tone: the pitch moves", (r.last.pitchVariability ?? 0) > 1.5 && (r.session?.pitchVariability ?? 0) > 1.5, `${r.last.pitchVariability?.toFixed(2)} semitones now, ${r.session?.pitchVariability} in the session`);
}

// V3. Silence: nothing heard, nothing summarised, no crash.
{
  const r = runTone(signalFrames(() => ({ f0: null, db: -120 }), 20000));
  check("silence: no voice", r.voicedShare === 0 && r.last.pitchVariability === null && r.last.loudnessDb === null && r.last.level === 0, `${r.voicedShare}, level ${r.last.level}`);
  check("silence: no session", r.session === null, "null");
  const zero = runTone([{ t: 0, samples: new Float32Array(1024), sampleRate: 16000 }]);
  check("all-zero frame: no crash, no voice", zero.voicedShare === 0, "");
}

// V4. Noise is not a voice.
{
  const r = runTone(signalFrames(() => ({ f0: null, db: -120, noiseDb: -20 }), 20000));
  check("white noise: not heard as voice", r.voicedShare < 0.05, `${(r.voicedShare * 100).toFixed(1)}% of frames`);
  const hum = runTone(signalFrames(() => ({ f0: 200, db: -24, noiseDb: -40 }), 20000));
  check("a tone in some noise: still heard", hum.voicedShare > 0.9, `${(hum.voicedShare * 100).toFixed(0)}%`);
}

// V5. Too high or too quiet for a voice.
{
  const high = runTone(signalFrames(() => ({ f0: 1000, db: -20 }), 10000));
  check("a 1 kHz beep: not a voice", high.voicedShare < 0.05, `${(high.voicedShare * 100).toFixed(0)}%`);
  const low = runTone(signalFrames(() => ({ f0: 50, db: -20 }), 10000));
  check("a 50 Hz hum: not a voice", low.voicedShare < 0.05, `${(low.voicedShare * 100).toFixed(0)}%`);
  const quiet = runTone(signalFrames(() => ({ f0: 200, db: -60 }), 10000));
  check("a very quiet tone: not a voice", quiet.voicedShare === 0, `${(quiet.voicedShare * 100).toFixed(0)}%`);
}

// V6. Pace: syllable-like bursts.
{
  const fast = runTone(signalFrames(bursts(() => 200, 200, 150), 60000));
  const slow = runTone(signalFrames(bursts(() => 200, 300, 300), 60000));
  const f = fast.session?.segmentsPerMinute ?? 0;
  const sl = slow.session?.segmentsPerMinute ?? 0;
  check("bursts 200 on 150 off: about 171 a minute", Math.abs(f - 171) < 171 * 0.15, `${f} a minute of talking`);
  check("bursts 300 on 300 off: about 100 a minute", Math.abs(sl - 100) < 15, `${sl} a minute of talking`);
  check("pauses inside talking count as talking time", Math.abs((fast.session?.speakingMinutes ?? 0) - 1) < 0.05, `${fast.session?.speakingMinutes} min of 1`);
  // Long silences between bursts do not dilute pace: 10 s talk, 20 s silence, twice.
  const gappy = runTone(signalFrames((ms) => (ms % 30000 < 10000 ? bursts(() => 200, 200, 150)(ms) : { f0: null, db: -120 }), 60000));
  const g = gappy.last.segmentsPerMinute ?? 0;
  check("long silences do not lower the pace", Math.abs(g - f) < f * 0.15, `${g} with silences, ${f} without`);
  // Bursts with a 25 ms gap stay one stretch; with a 100 ms gap they are separate.
  const joined = runTone(signalFrames(bursts(() => 200, 400, 25), 30000, { frameSize: 512 }));
  const apart = runTone(signalFrames(bursts(() => 200, 400, 100), 30000, { frameSize: 512 }));
  check(
    "a gap shorter than MIN_GAP_MS does not split, a longer one does",
    (joined.last.segmentsPerMinute ?? 99) < 10 && Math.abs((apart.last.segmentsPerMinute ?? 0) - 120) < 15,
    `${joined.last.segmentsPerMinute?.toFixed(0)} and ${apart.last.segmentsPerMinute?.toFixed(0)} a minute`,
  );
  // Very short blips are not stretches.
  const blips = runTone(signalFrames(bursts(() => 200, 30, 300), 60000, { frameSize: 512 }));
  const blipCount = blips.last.segmentsPerMinute === null ? 0 : (blips.last.segmentsPerMinute * blips.last.speakingMinutes);
  check("blips shorter than MIN_SEGMENT_MS are not counted", blipCount < 10, `${blipCount.toFixed(0)} counted of 181 blips`);
}

// V7. Loudness follows the signal.
{
  const a = runTone(signalFrames(() => ({ f0: 200, db: -20 }), 20000));
  const b = runTone(signalFrames(() => ({ f0: 200, db: -32 }), 20000));
  const diff = (a.last.loudnessDb ?? 0) - (b.last.loudnessDb ?? 0);
  check("12 dB quieter reads about 12 dB quieter", Math.abs(diff - 12) < 1, `${diff.toFixed(1)} dB`);
  check("level bar follows", a.last.level > b.last.level && toLevel(-30) === 50 && toLevel(LEVEL_FLOOR_DB) === 0, `${a.last.level} vs ${b.last.level}`);
}

// V7b. Pitch movement is shown only after enough voice.
{
  const brief = runTone(signalFrames(() => ({ f0: 200, db: -20 }), 640));
  const longer = runTone(signalFrames(() => ({ f0: 200, db: -20 }), 2500));
  check(
    "pitch movement waits for MIN_VOICED_FRAMES",
    brief.last.pitchVariability === null && longer.last.pitchVariability !== null,
    `${brief.live.length} frames: ${brief.last.pitchVariability}, ${longer.live.length} frames: ${longer.last.pitchVariability}`,
  );
}

// V8. Session summary and its minimum.
{
  const short = runTone(signalFrames(() => ({ f0: 200, db: -20 }), 20000));
  check("20 s of talking: not summarised", short.session === null, "null");
  const r = runTone(signalFrames(() => ({ f0: 200, db: -20 }), 40000));
  check(
    "40 s of talking: summarised in the agreed shape",
    !!r.session && r.session.date === "2026-11-14" && r.session.source === "demo" && Math.abs(r.session.minutes - 40 / 60) < 0.05,
    JSON.stringify(r.session),
  );
}

// V9. The example: lively then flatter and slower.
{
  const frames = voiceExampleFrames();
  const tr = createToneTracker({ source: "demo", startedAt: Date.now() });
  let at11: ToneLive | null = null;
  let at26: ToneLive | null = null;
  for (const f of frames) {
    tr.push(f);
    if (!at11 && f.t >= 11500) at11 = tr.live();
    if (!at26 && f.t >= 26500) at26 = tr.live();
  }
  check(
    "example voice: the pitch moves more in the first part",
    (at11?.pitchVariability ?? 0) > 1.5 && (at26?.pitchVariability ?? 9) < 0.6,
    `${at11?.pitchVariability?.toFixed(2)} then ${at26?.pitchVariability?.toFixed(2)} semitones`,
  );
  check("example voice: quieter in the second part", (at11?.loudnessDb ?? 0) - (at26?.loudnessDb ?? 0) > 4, `${at11?.loudnessDb?.toFixed(1)} then ${at26?.loudnessDb?.toFixed(1)} dB`);
  check(
    "example voice: slower in the second part",
    Math.abs((at11?.segmentsPerMinute ?? 0) - 200) < 25 && (at26?.segmentsPerMinute ?? 999) < (at11?.segmentsPerMinute ?? 0) - 20,
    `${at11?.segmentsPerMinute?.toFixed(0)} a minute at 11.5 s, ${at26?.segmentsPerMinute?.toFixed(0)} by 26.5 s (the whole session so far)`,
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
