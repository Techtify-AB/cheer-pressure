// Unit tests for the ladder after "Not my best" (lib/ladder.ts), the routines it picks
// from (lib/settings.ts), the contact stand-in (lib/contact.ts) and the demo replay's
// made-up days (lib/replay.ts). Run: pnpm test:passive, which runs this file after its own tests.
import { addDays } from "../lib/dates.ts";
import {
  answerClinic,
  answerSmallThing,
  answerSomeone,
  clinicSummary,
  ladderDue,
  requestSomeone,
  shiftLadder,
  startAfterNotBest,
  type LadderInput,
} from "../lib/ladder.ts";
import { createLocalContact, SIMULATED_REPLY } from "../lib/contact.ts";
import { evaluatePassive } from "../lib/passive.ts";
import { firstAsk, makeReplayData, replayFrames, shiftReplay, STEADY_DAYS, REPLAY_DAYS, driftOn } from "../lib/replay.ts";
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

// The replay's made-up days, run through the real rule
for (const last of ["2026-11-14", "2027-03-29", "2026-06-30"]) {
  const r = makeReplayData(last);
  const frames = replayFrames(r, last);
  const askedSteady = frames.filter((f) => f.day <= STEADY_DAYS && f.evaluation.askNow).map((f) => f.day);
  check(`replay (${last}): the rule never asks in the first ${STEADY_DAYS} days`, askedSteady.length === 0, askedSteady.join());
  const a = firstAsk(frames);
  check(
    `replay (${last}): it asks in the last week, about at least two measures`,
    !!a && a.day > STEADY_DAYS && a.day <= REPLAY_DAYS && a.evaluation.changed.length >= 2,
    a ? `day ${a.day}: ${a.evaluation.changed.map((m) => m.key).join(", ")}` : "never",
  );
  check(`replay (${last}): still learning on days 1 to 6`, frames.slice(0, 6).every((f) => f.evaluation.learning && !f.evaluation.askNow));
}
{
  const last = "2026-11-14";
  const r = makeReplayData(last);
  const med = (v: number[]) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];
  const dayNo = (date: string) => REPLAY_DAYS - Math.round((Date.parse(last) - Date.parse(date)) / 86_400_000);
  const split = <T extends { date: string }>(list: T[], get: (t: T) => number) => {
    const steady = list.filter((x) => driftOn(dayNo(x.date)) === 0).map(get);
    const lastDays = list.filter((x) => dayNo(x.date) > REPLAY_DAYS - 3).map(get);
    return med(lastDays) - med(steady);
  };
  const moved = [
    ["typing evenness", split(r.typingSessions, (s) => s.spreadMs!), 25],
    ["longer pauses", split(r.typingSessions, (s) => s.p95PauseMs!), 100],
    ["first activity", split(r.activityDays, (d) => clockToDayMinutes(d.first)), 45],
    ["last activity", split(r.activityDays, (d) => clockToDayMinutes(d.last)), 30],
  ] as const;
  const drifting = moved.filter(([, delta, min]) => delta >= min);
  check("replay: at least three measures drift in the last week", drifting.length >= 3, moved.map(([n, d]) => `${n} +${Math.round(d)}`).join(", "));
  const shifted = shiftReplay(r, -5);
  const a1 = firstAsk(replayFrames(r, last));
  const a2 = firstAsk(replayFrames(shifted, addDays(last, -5)));
  check("replay: moving every date gives the same outcome", a1?.day === a2?.day);
  // The frame the replay stops on says the same as the app does with that data on that day.
  const e = evaluatePassive(a1!.data, a1!.date);
  check("replay: the stopping frame is exactly the rule's result", e.askNow && e.changed.length === a1!.evaluation.changed.length);
}

// The clinic text: what changed, since when, the person's answers, no raw numbers
{
  const last = "2026-11-14";
  const frames = replayFrames(makeReplayData(last), last);
  const a = firstAsk(frames)!;
  const text = clinicSummary({
    ladder: answerSomeone(answerSmallThing(startAfterNotBest(a.date, "walk", true), "try", a.date), "yes", a.date),
    passive: a.evaluation,
    checkIns: [
      { id: "c", date: a.date, at: "", answer: "not-best", triggeredBy: [], basedOn: { sessions: 3, days: 3 }, simulated: true },
    ],
  });
  const withoutDates = text.replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2}\b/g, "");
  check("clinic text: names what changed", text.includes("your typing has been more uneven"), text.split("\n")[1]);
  check("clinic text: the person's own answers", text.includes('"Not my best"') && text.includes("a walk in daylight") && text.includes("someone I trust"));
  check("clinic text: no numbers other than dates", !/\d/.test(withoutDates), withoutDates);
  check("clinic text: no risk or diagnosis words", !/(risk|depress|relapse|diagnos|score|%)/i.test(text));
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
