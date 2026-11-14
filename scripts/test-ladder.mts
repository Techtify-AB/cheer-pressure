// Unit tests for the ladder after "Not my best" (lib/ladder.ts), the routines it picks
// from (lib/settings.ts), the contact stand-in (lib/contact.ts) and the demo replay's
// made-up days (lib/replay.ts). Run: pnpm test:passive, which runs this file after its own tests.
import { addDays } from "../lib/dates.ts";
import {
  answerClinic,
  answerSmallThing,
  answerSomeone,
  ladderDue,
  requestSomeone,
  shiftLadder,
  startAfterNotBest,
  type LadderInput,
} from "../lib/ladder.ts";
import { createLocalContact, SIMULATED_REPLY } from "../lib/contact.ts";
import { enoughToAsk, evaluatePassive } from "../lib/passive.ts";
import { firstAsk, makeReplayData, movementDriftOn, replayEndingOn, replayFrames, shiftReplay, sleepDriftOn, STEADY_DAYS, REPLAY_DAYS, REPLAY_MS_PER_DAY, REPLAY_RUN_MS, REPLAY_SEED, driftOn } from "../lib/replay.ts";
import { inQuietHours, pickSmallThing, ROUTINES, DEFAULT_QUIET_HOURS } from "../lib/settings.ts";
import { clockToDayMinutes } from "../lib/passive.ts";
import type { LadderState, RoutineId } from "../lib/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const DAY0 = "2026-11-14";
const NOON = 12 * 60;
// The rule's result, reduced to what the ladder reads: two measures changed, or none.
const CHANGED = { askNow: true, changed: [{ key: "spread" }, { key: "firstActivity" }] } as unknown as LadderInput["passive"];
const BACK = { askNow: false, changed: [] } as unknown as LadderInput["passive"];
const ONE = { askNow: false, changed: [{ key: "spread" }] } as unknown as LadderInput["passive"];

function due(ladder: LadderState | null, dayOffset: number, passive = CHANGED, minutesNow = NOON, pausedAll = false) {
  return ladderDue({
    ladder,
    today: addDays(DAY0, dayOffset),
    minutesNow,
    quietHours: DEFAULT_QUIET_HOURS,
    pausedAll,
    passive,
  });
}

// Quiet hours
check("quiet hours: 23:00 is quiet", inQuietHours(23 * 60, DEFAULT_QUIET_HOURS));
check("quiet hours: 07:59 is quiet", inQuietHours(7 * 60 + 59, DEFAULT_QUIET_HOURS));
check("quiet hours: 08:00 is not", !inQuietHours(8 * 60, DEFAULT_QUIET_HOURS));
check("quiet hours: 21:59 is not", !inQuietHours(22 * 60 - 1, DEFAULT_QUIET_HOURS));
check("quiet hours: a daytime span works too", inQuietHours(13 * 60, { from: "12:00", to: "14:00" }) && !inQuietHours(15 * 60, { from: "12:00", to: "14:00" }));

// Before any ladder: the rule's own ask
check("no ladder, the rule asks: ask, and it speaks up", due(null, 0).due === "ask" && due(null, 0).speakUp);
check("no ladder, nothing stands out: none", due(null, 0, BACK).due === "none" && !due(null, 0, BACK).speakUp);
const night = due(null, 0, CHANGED, 23 * 60);
check("quiet hours suppress the ask", night.due === "ask" && !night.speakUp && night.quiet);
const early = due(null, 0, CHANGED, 6 * 60);
check("quiet hours suppress the ask in the morning too", !early.speakUp);
check("pause everything: never speaks up", !due(null, 0, CHANGED, NOON, true).speakUp);

// Step 1
const started = startAfterNotBest(DAY0, "walk", false);
check("Not my best: step 1 is due right away", due(started, 0).due === "small-thing");
const tried = answerSmallThing(started, "try", DAY0);
check("after step 1: nothing on day 0 and day 1", due(tried, 0).due === "none" && due(tried, 1).due === "none", due(tried, 1).reason);

// Step 2 after two days, only while the measures still stand out
check("step 2 after two days when the measures have not come back", due(tried, 2).due === "someone" && due(tried, 2).speakUp);
const back = due(tried, 2, BACK);
check("measures back in the usual range: nothing escalates, and the ladder may close", back.due === "none" && back.close, back.reason);
check("one measure left changed does not escalate either (the rule needs two)", due(tried, 2, ONE).due === "none");
const TYPING_ONLY = { askNow: false, changed: [{ key: "spread" }, { key: "hold" }] } as unknown as LadderInput["passive"];
const typingLeft = due(tried, 2, TYPING_ONLY);
check("only typing still changed counts as come back, the same test as asking", typingLeft.due === "none" && typingLeft.close, typingLeft.reason);
const SLEEP_TWO = { askNow: true, changed: [{ key: "firstActivity" }, { key: "quietNight" }] } as unknown as LadderInput["passive"];
check("Sleep alone still changed counts as come back, the same test as asking", due(tried, 2, SLEEP_TWO).due === "none" && due(tried, 2, SLEEP_TWO).close);
let escalated = false;
for (let d = 0; d <= 14; d++) for (const l of [tried, answerSomeone(tried, "yes", addDays(DAY0, 2))]) {
  const r = due(l, d, BACK);
  if (r.due === "someone" || r.due === "clinic") escalated = true;
}
check("nothing escalates on any of 14 days while the measures are back", !escalated);
check("quiet hours suppress step 2 as a prompt", !due(tried, 2, CHANGED, 22 * 60 + 30).speakUp && due(tried, 2, CHANGED, 22 * 60 + 30).due === "someone");

// Declines are respected for three days, at every step
const declined1 = answerSmallThing(started, "not-now", DAY0);
check(
  "Not now at step 1: nothing for three days, then step 2",
  due(declined1, 1).due === "none" && due(declined1, 2).due === "none" && due(declined1, 3).due === "someone",
  `${due(declined1, 2).reason}`,
);
const declined2 = answerSomeone(tried, "not-now", addDays(DAY0, 2));
check(
  "Not now at step 2: nothing on days 3 and 4, offered again on day 5",
  due(declined2, 3).due === "none" && due(declined2, 4).due === "none" && due(declined2, 5).due === "someone",
);
const yes2 = answerSomeone(tried, "yes", addDays(DAY0, 2));
check("Yes at step 2: nothing more until day 7", [3, 4, 5, 6].every((d) => due(yes2, d).due === "none"));
check("step 3 after seven days when the measures have not come back", due(yes2, 7).due === "clinic");
check("step 3 never comes before step 2 has been offered", due(tried, 8).due === "someone");
const declined3 = answerClinic(yes2, "not-now", addDays(DAY0, 7));
check(
  "Not now at step 3: nothing on days 8 and 9, offered again on day 10",
  due(declined3, 8).due === "none" && due(declined3, 9).due === "none" && due(declined3, 10).due === "clinic",
);
const approved = answerClinic(yes2, "approve", addDays(DAY0, 7));
check("approved: the ladder is done", due(approved, 9).due === "none" && due(approved, 9).reason === "done");

// "I'd like someone to check in on me" jumps to step 2
const asked = requestSomeone(null, DAY0, false);
check("asking for someone: step 2 right away", due(asked, 0).due === "someone");
check("asking for someone: step 2 even when the measures are steady", due(asked, 0, BACK).due === "someone");
const askedThenNo = answerSomeone(asked, "not-now", DAY0);
check("asking for someone, then Not now: respected", due(askedThenNo, 1).due === "none" && due(askedThenNo, 2).due === "none");

// Demo: skip ahead
const skipped = shiftLadder(tried, 2);
check("skip ahead two days: step 2 is due today", due(skipped, 0).due === "someone" && skipped.startedOn === addDays(DAY0, -2));

// Routines: never one that is switched off
const ids = ROUTINES.map((r) => r.id);
let offPicked = 0;
let missed = 0;
for (let mask = 0; mask < 1 << ids.length; mask++) {
  const on = Object.fromEntries(ids.map((id, i) => [id, !!(mask & (1 << i))])) as Record<RoutineId, boolean>;
  for (const preferred of ids) {
    const p = pickSmallThing(preferred, on);
    if (p !== null && !on[p]) offPicked++;
    if (p === null && mask !== 0) missed++;
    if (on[preferred] && p !== preferred) missed++;
  }
}
check("small thing: never a routine that is off (all 32 on/off combinations x 5)", offPicked === 0 && missed === 0, `${offPicked} off, ${missed} missed`);
check("small thing: none when every routine is off", pickSmallThing("walk", Object.fromEntries(ids.map((i) => [i, false])) as Record<RoutineId, boolean>) === null);

// The contact stand-in
{
  let fetched = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetched++;
    throw new Error("no network");
  }) as typeof fetch;
  const quiet = createLocalContact({ demo: false, replyAfterMs: 10 });
  let quietReplies = 0;
  quiet.onReply(() => quietReplies++);
  await quiet.requestContact();
  const demo = createLocalContact({ demo: true, replyAfterMs: 10 });
  let reply = "";
  demo.onReply((r) => (reply = r.simulated ? r.text : "real?"));
  await demo.requestContact();
  await new Promise((r) => setTimeout(r, 40));
  globalThis.fetch = realFetch;
  check("contact stand-in: not connected, and no reply outside demo mode", !quiet.connected && quietReplies === 0 && quiet.status() === "not-connected");
  check("contact stand-in: a simulated reply in demo mode, marked simulated", reply === SIMULATED_REPLY && demo.status() === "replied" && demo.simulated);
  check("contact stand-in: no network call", fetched === 0);
}

// The replay's made-up days, run through the real rule, ending on every day of the week (the
// replay is placed so that the day it asks is today, so any weekday can be the last one).
const WEEK = ["2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
const stopDays: number[] = [];
for (const last of WEEK) {
  const r = makeReplayData(last);
  const frames = replayFrames(r, last);
  const askedSteady = frames.filter((f) => f.day <= STEADY_DAYS && f.evaluation.askNow).map((f) => f.day);
  check(`replay (${last}): the rule never asks in the first ${STEADY_DAYS} days`, askedSteady.length === 0, askedSteady.join());
  const a = firstAsk(frames);
  const cats = a ? [...new Set(a.evaluation.changed.map((m) => m.source))].sort().join("+") : "";
  check(
    `replay (${last}): it asks after the drift began, with days to spare, on Sleep and Energy`,
    !!a && a.day > STEADY_DAYS + 3 && a.day <= REPLAY_DAYS - 5 && enoughToAsk(a.evaluation.changed) && cats === "energy+sleep",
    a ? `day ${a.day}: ${a.evaluation.changed.map((m) => m.key).join(", ")}` : "never",
  );
  check(
    `replay (${last}): Energy changed through movement from the camera, not typing`,
    !!a && a.evaluation.changed.some((m) => m.key === "movementLevel" || m.key === "positionChanges") && !a.evaluation.changed.some((m) => m.key === "spread" || m.key === "hold"),
  );
  const firstOf = (src: string) => frames.find((f) => f.day > STEADY_DAYS && f.evaluation.changed.some((m) => m.source === src))?.day ?? Infinity;
  check(`replay (${last}): sleep slips first, then movement`, firstOf("sleep") < firstOf("energy"), `sleep ${firstOf("sleep")}, energy ${firstOf("energy")}`);
  const lowLastWeek = r.dailyAnswers.filter((d) => d.answer === "not-so-good" && d.date > addDays(last, -7)).length;
  const lowSteadyWeeks = r.dailyAnswers.filter((d) => d.answer === "not-so-good" && d.date <= addDays(last, -(REPLAY_DAYS - STEADY_DAYS))).length;
  check(`replay (${last}): the daily answers lean towards "Not so good" in the last days`, lowLastWeek >= 3 && lowLastWeek / 7 > lowSteadyWeeks / STEADY_DAYS, `${lowLastWeek} in the last week, ${lowSteadyWeeks} in six steady weeks`);
  check(`replay (${last}): still learning on days 1 to 13`, frames.slice(0, 13).every((f) => f.evaluation.learning && !f.evaluation.askNow));
  check(`replay (${last}): it can be placed so the day it asks is today`, firstAsk(replayFrames(replayEndingOn(last)?.data ?? r, replayEndingOn(last)?.lastDay ?? last))?.date === last);
  if (a) stopDays.push(a.day);
}
console.log(`  replay seed ${REPLAY_SEED}: stops on day ${[...new Set(stopDays)].join(" or ")} of ${REPLAY_DAYS}, about ${((Math.max(...stopDays) * REPLAY_MS_PER_DAY) / 1000).toFixed(1)} of ${REPLAY_RUN_MS / 1000} seconds`);
{
  const last = "2026-11-14";
  const r = makeReplayData(last);
  const med = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];
  const dayNo = (date: string) => REPLAY_DAYS - Math.round((Date.parse(last) - Date.parse(date)) / 86_400_000);
  const split = <T extends { date: string }>(list: T[], get: (t: T) => number) => {
    const steady = list.filter((x) => driftOn(dayNo(x.date)) === 0).map(get);
    const lastDays = list.filter((x) => dayNo(x.date) > REPLAY_DAYS - 5).map(get);
    return med(lastDays) - med(steady);
  };
  const lateEvening = split(r.activityDays, (d) => clockToDayMinutes(d.last));
  const morning = split(r.activityDays, (d) => clockToDayMinutes(d.first));
  const movement = split(r.movementSessions, (s) => s.movementMean);
  const spread = split(r.typingDays.filter((t) => t.spreadMs !== null), (t) => t.spreadMs!);
  check("replay: the evenings run later and the mornings do not, so the nights get shorter", lateEvening >= 60 && morning < 30, `evening +${Math.round(lateEvening)} min, morning ${Math.round(morning)} min`);
  check("replay: movement drops", movement <= -0.015, movement.toFixed(3));
  check("replay: typing drifts only a little", Math.abs(spread) < 12, `${spread.toFixed(1)} ms`);
  check("replay: sleep slips first (on the drift's first day it has moved more than a third), movement two days later", sleepDriftOn(STEADY_DAYS + 1) > 0.35 && movementDriftOn(STEADY_DAYS + 2) === 0 && movementDriftOn(STEADY_DAYS + 3) > 0.35);
  const shifted = shiftReplay(r, -14);
  const a1 = firstAsk(replayFrames(r, last));
  const a2 = firstAsk(replayFrames(shifted, addDays(last, -14)));
  check("replay: moving every date by whole weeks gives the same outcome", a1?.day === a2?.day);
  // The frame the replay stops on says the same as the app does with that data on that day.
  const e = evaluatePassive(a1!.data, a1!.date);
  check("replay: the stopping frame is exactly the rule's result", e.askNow && e.changed.length === a1!.evaluation.changed.length);
}

// --- The phone flow: several people at step 2, the clinic step as the person chose ---------
{
  const { approveClinic, seenClinic, tellClinicAutomatically, startWithHelp } = await import("../lib/ladder.ts");
  const { alwaysShareDue } = await import("../lib/report.ts");
  const dueWith = (l: LadderState | null, day: number, clinic?: LadderInput["clinic"], passive = CHANGED) =>
    ladderDue({ ladder: l, today: addDays(DAY0, day), minutesNow: NOON, quietHours: DEFAULT_QUIET_HOURS, pausedAll: false, passive, clinic });

  let l: LadderState = startWithHelp(DAY0, { item: "music", label: "Music", learned: false }, false);
  l = answerSmallThing(l, "try", DAY0);
  check("step 2 after two days, with several people picked", dueWith(l, 2).due === "someone");
  l = answerSomeone(l, "yes", addDays(DAY0, 2), ["anna", "sami"]);
  check("step 2: both people picked are kept", l.someone?.answer === "yes" && l.someone.asked?.join() === "anna,sami");
  const replied = (await import("../lib/ladder.ts")).answerReply(l, "yes", "sami");
  check("step 2: whose reply was answered is kept", replied.someone?.reply === "yes" && replied.someone.personId === "sami");
  check("step 2: not-now keeps no list", answerSomeone(l, "not-now", addDays(DAY0, 2)).someone?.asked === undefined);

  const AUTO = { share: "when-i-say" as const, tellAfterDays: true };
  const ASK = { share: "when-i-say" as const, tellAfterDays: false };
  const NEVER = { share: "never" as const, tellAfterDays: false };
  check("clinic: day 6 is too early, even with the automatic yes", dueWith(l, 6, AUTO).due === "none");
  check("clinic: day 7 with the automatic yes tells the clinic", dueWith(l, 7, AUTO).reason === "clinic-auto");
  check("clinic: day 7 without it asks first", dueWith(l, 7, ASK).reason === "clinic-due");
  check("clinic: no choice stored asks first", dueWith(l, 7).reason === "clinic-due");
  check("clinic: Never never brings step 3", dueWith(l, 7, NEVER).due === "none" && dueWith(l, 30, NEVER).reason === "clinic-never");
  check("clinic: values back by day 7: nothing told, the ladder closes", dueWith(l, 7, AUTO, BACK).close && dueWith(l, 7, AUTO, BACK).due === "none");
  const lonely = answerSmallThing(startWithHelp(DAY0, null, false), "not-now", DAY0);
  check("clinic: automatic yes does not wait for step 2 to be answered", dueWith(lonely, 7, AUTO).reason === "clinic-auto");

  const told = tellClinicAutomatically(l, addDays(DAY0, 7), "entry-1");
  check("clinic: after telling, Cheri says so until it is seen", dueWith(told, 7, AUTO).reason === "clinic-told" && dueWith(told, 7, AUTO).speakUp);
  check("clinic: shown even when values came back meanwhile", dueWith(told, 8, AUTO, BACK).reason === "clinic-told");
  const seen = seenClinic(told, addDays(DAY0, 7));
  check("clinic: once seen, nothing more (told once)", dueWith(seen, 8, AUTO).due === "none" && dueWith(seen, 20, AUTO).reason === "done");
  check("clinic: told entry is kept on the ladder", told.clinic?.sharedId === "entry-1" && told.clinic.auto === true);
  const approved = approveClinic(l, addDays(DAY0, 7), "entry-2");
  check("clinic: approved when asked: done, never again", dueWith(approved, 9, ASK).reason === "done" && approved.clinic?.sharedId === "entry-2");
  check("clinic: Not now at step 3 is respected for 3 days", dueWith(answerClinic(l, "not-now", addDays(DAY0, 7)), 9, ASK).reason === "declined-recently");

  // "Always": weekly, and a note when two categories stand out
  const base = { profile: { createdAt: "2026-10-01T10:00:00Z", earlySigns: [] }, settings: {}, clinicShared: [] } as unknown as Parameters<typeof alwaysShareDue>[0];
  check("always: the first weekly summary is due", alwaysShareDue(base, DAY0, false, "always") === "weekly");
  check("always: nothing when only when I say", alwaysShareDue(base, DAY0, true, "when-i-say") === null);
  const week = { ...base, clinicShared: [{ id: "w", date: addDays(DAY0, -3), kind: "weekly" }] } as unknown as typeof base;
  check("always: not again within seven days", alwaysShareDue(week, DAY0, false, "always") === null);
  check("always: again after seven days", alwaysShareDue(week, addDays(DAY0, 4), false, "always") === "weekly");
  check("always: a note when two categories stand out", alwaysShareDue(week, DAY0, true, "always") === "note");
  const noted = { ...base, clinicShared: [{ id: "w", date: DAY0, kind: "weekly" }, { id: "n", date: DAY0, kind: "note" }] } as unknown as typeof base;
  check("always: at most one note a week", alwaysShareDue(noted, addDays(DAY0, 3), true, "always") === null);
  check("always: nothing while paused", alwaysShareDue({ ...base, settings: { pausedAll: true } } as typeof base, DAY0, true, "always") === null);
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
