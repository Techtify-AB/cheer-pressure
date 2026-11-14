// Unit tests for the phone app's part of the web code: raw sleep samples to nights
// (mobile/src/health/nights.ts), the phone's inputs in the categories and the rule (lib/passive.ts,
// lib/categories.ts), the notification planner (lib/phone.ts), and that both sides of the bridge
// speak the same protocol. Run: npx tsx scripts/test-phone.mts
import { readFileSync } from "node:fs";
import path from "node:path";
import { addDays } from "../lib/dates.ts";
import { evaluatePassive, PASSIVE_DEFS, phoneSleepPoints, reactionPoints, SOURCES, stepPoints, sourceOf } from "../lib/passive.ts";
import { categoryLine, categoryOpening, inputViews } from "../lib/categories.ts";
import { HELLO_PATH, planNotifications, PHONE_BRIDGE_VERSION, PHONE_EVENTS, PHONE_REQUESTS, wordDue } from "../lib/phone.ts";
import type { AppData, HealthNight, StepsDay } from "../lib/types.ts";
import { localDay, reduceNights, reduceSteps, type RawSleepSample } from "../mobile/src/health/nights.ts";
import { demoWeeks } from "../mobile/src/health/demoWeeks.ts";
import * as nativeProtocol from "../mobile/src/protocol.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const ROOT = path.resolve(import.meta.dirname, "..");

// --- Raw samples to nights ---------------------------------------------------------------

/** Local time on a day of November 2026. */
const at = (day: number, h: number, m = 0) => new Date(2026, 10, day, h, m).getTime();
const s = (source: string, stage: RawSleepSample["stage"], d1: number, h1: number, m1: number, d2: number, h2: number, m2: number): RawSleepSample => ({
  source,
  stage,
  start: at(d1, h1, m1),
  end: at(d2, h2, m2),
});
const NOW = at(20, 18);

{
  // A night crossing midnight, one source with stages and an awake stretch in the middle.
  const n = reduceNights(
    [
      s("watch", "inBed", 9, 23, 0, 10, 7, 0),
      s("watch", "asleep", 9, 23, 20, 10, 2, 0),
      s("watch", "awake", 10, 2, 0, 10, 2, 20),
      s("watch", "asleep", 10, 2, 20, 10, 6, 40),
    ],
    { now: NOW },
  );
  check("a night crossing midnight is one night, on the morning it ends", n.length === 1 && n[0].date === "2026-11-10", JSON.stringify(n));
  check("bedtime is when the night began (in bed), wake the end of the last sleep", n[0]?.bedtime === "23:00" && n[0]?.wake === "06:40");
  check("asleep minutes leave out the time awake", n[0]?.asleepMinutes === 160 + 260, String(n[0]?.asleepMinutes));
  check("in bed minutes when recorded", n[0]?.inBedMinutes === 480);
  check("times awake when the source records them", n[0]?.awakenings === 1);
  check("no source app in the record", n[0] !== undefined && !("sourceName" in n[0]) && !Object.values(n[0]).includes("watch"));
}

{
  // Overlapping samples from two sources on the same night: one source wins, never counted twice.
  const n = reduceNights(
    [
      s("watch", "asleep", 11, 23, 30, 12, 6, 30),
      s("phone-app", "asleep", 11, 23, 0, 12, 5, 0),
      s("phone-app", "asleep", 12, 5, 0, 12, 5, 30),
    ],
    { now: NOW },
  );
  check("two sources on one night give one night", n.length === 1, JSON.stringify(n));
  check("the source with the most time asleep wins, not the sum", n[0]?.asleepMinutes === 420, String(n[0]?.asleepMinutes));
  check("the winner's own times are used", n[0]?.bedtime === "23:30" && n[0]?.wake === "06:30");
  check("times awake unknown when the winner records none", n[0]?.awakenings === null);
}

{
  // The same source writing overlapping samples (stages on top of a plain asleep) counts once.
  const n = reduceNights([s("watch", "asleep", 12, 23, 0, 13, 7, 0), s("watch", "asleep", 13, 1, 0, 13, 3, 0)], { now: NOW });
  check("overlapping samples of one source are counted once", n[0]?.asleepMinutes === 480, String(n[0]?.asleepMinutes));
}

{
  // Naps: an afternoon nap and an evening doze far from the night are left out; a short wake joins.
  const n = reduceNights(
    [
      s("watch", "asleep", 13, 14, 0, 13, 15, 0), // nap, afternoon of the 13th
      s("watch", "asleep", 13, 19, 0, 13, 19, 40), // dozing in the evening, 3h before bed
      s("watch", "asleep", 13, 23, 0, 14, 3, 0),
      s("watch", "asleep", 14, 4, 0, 14, 7, 0), // back to sleep after an hour awake
    ],
    { now: NOW },
  );
  check("naps and an evening doze far from the night are not nights", n.length === 1 && n[0].date === "2026-11-14", JSON.stringify(n.map((x) => x.date)));
  const night = n.find((x) => x.date === "2026-11-14");
  check("an afternoon nap does not join the next night", night?.bedtime === "23:00", night?.bedtime);
  check("an hour awake in the night joins both halves", night?.asleepMinutes === 420 && night?.wake === "07:00", JSON.stringify(night));
}

{
  // A day with only a nap has no night; nights around a missing night are kept as they are.
  const n = reduceNights(
    [s("watch", "asleep", 15, 23, 0, 16, 7, 0), s("watch", "asleep", 17, 13, 0, 17, 14, 0), s("watch", "asleep", 17, 23, 30, 18, 6, 30)],
    { now: NOW },
  );
  check("a missing night is missing, not zero", n.map((x) => x.date).join() === "2026-11-16,2026-11-18", n.map((x) => x.date).join());
}

{
  // In bed only (the phone's own sleep schedule): no asleep minutes, bedtime and wake still there.
  const n = reduceNights([s("phone", "inBed", 18, 22, 45, 19, 6, 15)], { now: NOW });
  check("in bed only: asleep minutes are null, times kept", n[0]?.asleepMinutes === null && n[0]?.bedtime === "22:45" && n[0]?.wake === "06:15");
  const still = reduceNights([s("watch", "asleep", 20, 1, 0, 20, 23, 0)], { now: NOW });
  check("a night still going is left out", still.length === 0);
  const since = reduceNights([s("w", "asleep", 9, 23, 0, 10, 7, 0), s("w", "asleep", 15, 23, 0, 16, 7, 0)], { now: NOW, since: "2026-11-12" });
  check("since leaves out older nights", since.length === 1 && since[0].date === "2026-11-16");
  const made = reduceNights([{ ...s("w", "asleep", 15, 23, 0, 16, 7, 0), madeUp: true }], { now: NOW });
  check("made-up samples give a made-up night", made[0]?.source === "demo");
}

{
  const steps = reduceSteps(
    [
      { start: at(10, 0), steps: 6000 },
      { start: at(11, 0), steps: 0 },
      { start: at(12, 0), steps: 4200.4 },
      { start: at(20, 0), steps: 300 },
    ],
    { today: "2026-11-20", madeUpDays: new Set(["2026-11-12"]) },
  );
  check("steps: one number per full day, no empty days, today left out", steps.map((x) => `${x.date}:${x.steps}`).join() === "2026-11-10:6000,2026-11-12:4200", JSON.stringify(steps));
  check("steps: made-up days are marked", steps[1]?.source === "demo" && steps[0]?.source === "user");
}

// --- The phone's inputs in the categories and the rule -----------------------------------

const TODAY = "2026-11-14";

function empty(): AppData {
  return {
    version: 1,
    profile: { createdAt: "2026-09-01T10:00:00.000Z", earlySigns: [] },
    daily: [],
    weekly: [],
    reaction: [],
    typingSessions: [],
    typingDays: [],
    activityDays: [],
    movementSessions: [],
    checkIns: [],
    settings: { muted: false },
  };
}

/** n nights ending today; in the last 7, `drift` shortens the night and moves bedtime later. */
function nights(n: number, drift = 0): HealthNight[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(TODAY, i - (n - 1));
    const recent = i >= n - 7;
    const wobble = (i * 7) % 5; // 0..4
    const bedMin = 23 * 60 + wobble * 6 + (recent ? drift * 20 : 0); // 23:00 to 23:24, later in the drift
    const asleep = 450 - wobble * 6 - (recent ? drift * 25 : 0);
    const bed = `${String(Math.floor(bedMin / 60) % 24).padStart(2, "0")}:${String(bedMin % 60).padStart(2, "0")}`;
    return { date, bedtime: bed, wake: "07:00", asleepMinutes: asleep, inBedMinutes: null, awakenings: null, source: "user" as const };
  });
}
function stepDays(n: number, drift = 0): StepsDay[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(TODAY, i - n);
    const recent = i >= n - 7;
    return { date, steps: 7000 + ((i * 13) % 7) * 150 - (recent ? drift * 900 : 0), source: "user" as const };
  });
}

{
  check("Sleep has the input \"From the phone's health data\" with its three measures", SOURCES[0].inputs.some((i) => i.label === "From the phone's health data" && i.measures.join() === "phoneAsleep,phoneBedtime,phoneWake"));
  check("Energy has the input \"Steps\"", SOURCES[1].inputs.some((i) => i.label === "Steps" && i.measures.join() === "steps"));
  check("the new measures sit in their categories", sourceOf("phoneAsleep") === "sleep" && sourceOf("phoneBedtime") === "sleep" && sourceOf("steps") === "energy");

  const d = { ...empty(), healthNights: nights(40), stepDays: stepDays(40), phoneHealth: { askedAt: "2026-10-01T09:00:00Z" } };
  const pts = phoneSleepPoints(d, "phoneBedtime", TODAY);
  check("bedtime after midnight sorts after the evening", phoneSleepPoints({ ...empty(), healthNights: [{ ...nights(1)[0], bedtime: "00:30" }] }, "phoneBedtime", TODAY)[0].value > pts[0].value);
  check("steps leave out today", stepPoints({ ...empty(), stepDays: [{ date: TODAY, steps: 100, source: "user" }] }, TODAY).length === 0);

  const e = evaluatePassive(d, TODAY);
  check("steady phone data: still within the usual, no asking", !e.learning && e.changed.length === 0 && !e.askNow, e.reason);
  const views = inputViews("sleep", d, e, false);
  check("Sleep from the phone shows values", views.find((v) => v.input.id === "phone-health")?.kind === "values");
  check("Energy steps show values", inputViews("energy", d, e, false).find((v) => v.input.id === "steps")?.kind === "values");
  check("Sleep's line names the phone", categoryLine("sleep", d, e, TODAY, false).startsWith("Your phone's health data"), categoryLine("sleep", d, e, TODAY, false));

  // With the phone's nights, the computer's estimate is not Sleep's source any more.
  const both = { ...d, activityDays: Array.from({ length: 40 }, (_, i) => ({ date: addDays(TODAY, i - 39), first: i > 33 ? "11:30" : "08:00", last: "23:00", source: "user" as const })) };
  const eb = evaluatePassive(both, TODAY);
  check("the phone's nights replace the computer's estimate in the rule", eb.metrics.filter((m) => ["quietNight", "firstActivity", "lastActivity"].includes(m.key)).every((m) => m.points.length === 0 && m.status !== "changed"));
  check("the estimate shows as not connected on the phone", inputViews("sleep", both, eb, false).find((v) => v.input.id === "computer-use")?.kind === "not-connected");
  const computerOnly = { ...empty(), activityDays: both.activityDays };
  const ec = evaluatePassive(computerOnly, TODAY);
  check("without phone nights the computer's estimate is used as before", ec.metrics.find((m) => m.key === "firstActivity")!.points.length > 0);
  check("on the computer the phone's inputs say not connected yet", inputViews("sleep", computerOnly, ec, false).find((v) => v.input.id === "phone-health")?.kind === "not-connected" && inputViews("energy", computerOnly, ec, false).find((v) => v.input.id === "steps")?.kind === "not-connected");

  // Asked, but nothing read yet: on, still learning.
  const asked = { ...empty(), phoneHealth: { askedAt: "2026-11-13T09:00:00Z" } };
  check("asked but no nights yet: on, still learning", inputViews("sleep", asked, evaluatePassive(asked, TODAY), false).find((v) => v.input.id === "phone-health")?.kind === "learning");
  const paused = { ...d, settings: { muted: false, pausedAll: true } };
  check("paused: steps are off", inputViews("energy", { ...empty(), phoneHealth: d.phoneHealth, settings: paused.settings }, evaluatePassive({ ...empty(), settings: paused.settings }, TODAY), false).find((v) => v.input.id === "steps")?.kind === "off");

  // The rule itself is unchanged: two different categories.
  const sleepOnly = { ...d, healthNights: nights(40, 3) };
  const es = evaluatePassive(sleepOnly, TODAY);
  check("shorter, later nights from the phone make Sleep changed", es.changed.some((m) => m.key === "phoneAsleep" && m.direction === "down") && es.changed.some((m) => m.key === "phoneBedtime" && m.direction === "up"), es.changed.map((m) => `${m.key}:${m.direction}`).join());
  check("Sleep alone never asks, however many of its measures changed", !es.askNow && es.reason !== "changed", es.reason);
  const stepsOnly = { ...d, stepDays: stepDays(40, 3) };
  const est = evaluatePassive(stepsOnly, TODAY);
  check("fewer steps make Energy changed, alone it never asks", est.changed.some((m) => m.key === "steps" && m.direction === "down") && !est.askNow, est.reason);
  const twoCats = { ...d, healthNights: nights(40, 3), stepDays: stepDays(40, 3) };
  const e2 = evaluatePassive(twoCats, TODAY);
  check("Sleep and Energy from the phone together ask", e2.askNow && e2.reason === "changed", e2.reason);
  check("the explanation is worded against the usual", /nights have been shorter/.test(e2.changed.map((m) => m.phrase).join()) && /fewer steps/.test(e2.changed.map((m) => m.phrase).join()));
  check("phone values are no percentages or scores", e2.changed.every((m) => !/%|score|risk/i.test(m.phrase ?? "")));
  const learning = { ...empty(), healthNights: nights(10, 3), stepDays: stepDays(10, 3) };
  check("10 days from the phone: still learning, never asks", evaluatePassive(learning, TODAY).learning && !evaluatePassive(learning, TODAY).askNow);
  const made = { ...twoCats, healthNights: twoCats.healthNights.map((n) => ({ ...n, source: "demo" as const })) };
  check("made-up nights mark the evaluation as simulated", evaluatePassive(made, TODAY).simulated);
}

// --- The development build's made-up weeks ------------------------------------------------

{
  // Written at 12:00 on 14 November: 56 nights ending this morning and 56 full days of steps.
  const now = new Date(2026, 10, 14, 12, 0);
  const { sleep, steps } = demoWeeks(now);
  const raw: RawSleepSample[] = sleep.map((x) => ({ ...x, source: "made-up", madeUp: true }));
  const n = reduceNights(raw, { now: now.getTime() });
  check("made-up weeks: 56 nights, the last one ending this morning", n.length === 56 && n[55].date === TODAY && n[0].date === addDays(TODAY, -55), `${n.length} ${n[0]?.date} ${n.at(-1)?.date}`);
  check("made-up weeks: every night is marked made up", n.every((x) => x.source === "demo"));
  check("made-up weeks: the awake stretch is not counted asleep", n.every((x) => x.awakenings === 1 && x.asleepMinutes! < x.inBedMinutes!));
  const s = reduceSteps(steps, { today: TODAY, madeUpDays: new Set(steps.map((x) => localDay(x.start))) });
  check("made-up weeks: 56 days of steps, none today", s.length === 56 && s.at(-1)!.date === addDays(TODAY, -1), `${s.length} ${s.at(-1)?.date}`);
  const data = { ...empty(), healthNights: n, stepDays: s, phoneHealth: { askedAt: "2026-11-14T10:00:00Z" } };
  const e = evaluatePassive(data, TODAY);
  const cats = new Set(e.changed.map((m) => sourceOf(m.key)));
  check("made-up weeks: Sleep and Energy both show a change, so Cheri would ask", cats.has("sleep") && cats.has("energy") && e.askNow, `${[...cats].join()} ${e.reason}`);
  check("made-up weeks: shown as simulated", e.simulated);
  const midnight = demoWeeks(new Date(2026, 10, 14, 0, 30));
  check("made-up weeks: nothing written that ends after now is kept by the reducer", reduceNights(midnight.sleep.map((x) => ({ ...x, source: "m" })), { now: new Date(2026, 10, 14, 0, 30).getTime() }).every((x) => x.date < TODAY));
}

// --- The reaction check (experimental), last in Energy ----------------------------------

{
  const energy = SOURCES.find((c) => c.id === "energy")!.inputs;
  check("Energy's last input is the reaction check, after typing", energy.at(-1)?.id === "reaction-check" && energy.at(-2)?.id === "typing" && energy.at(-1)?.label === "Reaction check (experimental)");
  check("the reaction check is an Energy measure", sourceOf("reactionTime") === "energy");
  const def = PASSIVE_DEFS.find((d) => d.key === "reactionTime")!;
  check("worded as an observation against the usual, marked experimental", def.up === "your reactions have been slower" && /experimental/i.test(def.label) && /experimental/i.test(def.is));
  check("the legend says one bad night's sleep slows reactions too", /one bad night's sleep slows reactions too/.test(def.isNot) && /one bad night's sleep slows reactions too/i.test(def.meaning));

  // Missing list (older data, or before the reaction check lands): no results, nothing breaks.
  const none = empty();
  const en = evaluatePassive(none, TODAY);
  check("no stored list: no points", reactionPoints(none, TODAY).length === 0 && reactionPoints({ ...none, reactionChecks: "nonsense" } as unknown as AppData, TODAY).length === 0);
  const vNone = inputViews("energy", none, en, false).find((v) => v.input.id === "reaction-check");
  check("no results yet: shown as on, still learning (0 days), never left out", vNone?.kind === "learning" && vNone.days === 0, JSON.stringify(vNone));
  const paused = { ...none, settings: { muted: false, pausedAll: true } };
  check("paused: off", inputViews("energy", paused, evaluatePassive(paused, TODAY), false).find((v) => v.input.id === "reaction-check")?.kind === "off");

  // The day value is the median of that day's results; junk is skipped.
  const r = (date: string, medianMs: number) => ({ id: `${date}-${medianMs}`, date, at: `${date}T12:00:00Z`, medianMs, trialsMs: [], context: "own" as const });
  const mixed = { ...none, reactionChecks: [r("2026-11-10", 300), r("2026-11-10", 400), r("2026-11-10", 380), r("2026-11-11", 0), { date: 5, medianMs: 300 }, r("2026-11-20", 300)] } as unknown as AppData;
  const pts = reactionPoints(mixed, TODAY);
  check("one value a day, the median of that day's results; zero, junk and future days skipped", pts.length === 1 && pts[0].date === "2026-11-10" && pts[0].value === 380, JSON.stringify(pts));

  // 40 days of checks, the last week slower: Energy changes, and alone it never asks. Steady steps
  // carry the learning period (like the daily answer, checks the person does are not counted in it).
  const checks = (drift: number) =>
    Array.from({ length: 40 }, (_, i) => r(addDays(TODAY, i - 39), 320 + ((i * 7) % 5) * 6 + (i >= 33 ? drift : 0)));
  const steady = { ...none, stepDays: stepDays(40), reactionChecks: checks(0) } as AppData;
  const es = evaluatePassive(steady, TODAY);
  check("steady checks: values, within the usual", inputViews("energy", steady, es, false).find((v) => v.input.id === "reaction-check")?.kind === "values" && !es.changed.length);
  const slower = { ...none, stepDays: stepDays(40), reactionChecks: checks(90) } as AppData;
  const e1 = evaluatePassive(slower, TODAY);
  check("a slower last week makes Energy changed, worded against the usual", e1.changed.some((m) => m.key === "reactionTime" && m.direction === "up") && categoryOpening("energy", inputViews("energy", slower, e1, false), e1) === "Over the last week your reactions have been slower than your usual." && e1.reason !== "changed", categoryOpening("energy", inputViews("energy", slower, e1, false), e1));
  check("the reaction check alone never makes Cheri ask", !e1.askNow, e1.reason);
  const withSteps = { ...slower, stepDays: stepDays(40, 3) } as AppData;
  check("with steps also down it is still one category (Energy): no asking", !evaluatePassive(withSteps, TODAY).askNow);
  const withSleep = { ...slower, healthNights: nights(40, 3) } as AppData;
  check("with Sleep changed too, two categories ask", evaluatePassive(withSleep, TODAY).askNow);
}

// --- Notifications -----------------------------------------------------------------------

{
  const base = { ...empty(), settings: { muted: false, dailyQuestion: { every: "day" as const, when: "morning" as const } } };
  const now = new Date(2026, 10, 14, 8, 0); // Saturday 08:00, before the 09:30 hello
  const p = planNotifications(base, now);
  check("every day: 14 hellos, one a day, from today", p.notices.length === 14 && new Set(p.notices.map((n) => n.at!.slice(0, 10))).size === 14, String(p.notices.length));
  check("at the chosen time", new Date(p.notices[0].at!).getHours() === 9 && new Date(p.notices[0].at!).getMinutes() === 30);
  check("a hello opens the hello screen", p.notices.every((n) => n.path === HELLO_PATH && n.kind === "hello" && n.title === "A hello from Cheri"));
  const late = planNotifications(base, new Date(2026, 10, 14, 10, 0));
  check("a time that has passed today is not made up for", late.notices.length === 13 && new Date(late.notices[0].at!).getDate() === 15);
  const answered = planNotifications({ ...base, dailyAnswers: [{ date: "2026-11-14", answer: "good", dismissed: false, at: "", source: "user" }] }, now);
  check("a day already answered gets no hello", !answered.notices.some((n) => new Date(n.at!).getDate() === 14));
  const weekly = planNotifications({ ...base, settings: { ...base.settings, dailyQuestion: { every: "week", when: "morning" } } }, now);
  check("once a week: two in two weeks", weekly.notices.length === 2, String(weekly.notices.length));
  check("off: none", planNotifications({ ...base, settings: { ...base.settings, dailyQuestion: { every: "off", when: "morning" } } }, now).notices.length === 0);
  check("paused: none", planNotifications({ ...base, settings: { ...base.settings, pausedAll: true } }, now).notices.length === 0);
  const quiet = planNotifications({ ...base, settings: { ...base.settings, quietHours: { from: "07:00", to: "10:00" } } }, now);
  check("a time in quiet hours is moved out of them", quiet.notices.every((n) => new Date(n.at!).getHours() >= 10), quiet.notices[0]?.at ?? "");
  const allQuiet = planNotifications({ ...base, settings: { ...base.settings, quietHours: { from: "00:00", to: "23:59" } } }, now);
  check("when the whole day is quiet hours, no hello at all", allQuiet.notices.length === 0, String(allQuiet.notices.length));
  check("no profile: none", planNotifications({ ...base, profile: null }, now).notices.length === 0);

  const two = { ...empty(), healthNights: nights(40, 3), stepDays: stepDays(40, 3) };
  check("a word is due when two categories changed, outside quiet hours", wordDue(two, new Date(2026, 10, 14, 12, 0)));
  check("never a word in quiet hours", !wordDue(two, new Date(2026, 10, 14, 23, 0)));
  check("at most one word a day", !wordDue({ ...two, phoneNotices: { wordOn: "2026-11-14" } }, new Date(2026, 10, 14, 12, 0)));
  check("no word when the rule does not ask", !wordDue({ ...empty(), healthNights: nights(40, 3), stepDays: stepDays(40) }, new Date(2026, 10, 14, 12, 0)));
}

// --- The bridge: both sides speak the same protocol --------------------------------------

{
  const block = (file: string) => {
    const t = readFileSync(path.join(ROOT, file), "utf8");
    const a = t.indexOf("// BEGIN PROTOCOL");
    const b = t.indexOf("// END PROTOCOL");
    return a >= 0 && b > a ? t.slice(t.indexOf("\n", a) + 1, b) : null;
  };
  const web = block("lib/phone.ts");
  const native = block("mobile/src/protocol.ts");
  check("the protocol is byte for byte the same on both sides", !!web && web === native);
  check("same version and kinds at run time", nativeProtocol.PHONE_BRIDGE_VERSION === PHONE_BRIDGE_VERSION && nativeProtocol.PHONE_REQUESTS.join() === PHONE_REQUESTS.join() && nativeProtocol.PHONE_EVENTS.join() === PHONE_EVENTS.join());
  const phone = readFileSync(path.join(ROOT, "lib/phone.ts"), "utf8");
  check("lib/phone.ts imports nothing from React Native", !/from ["'](react-native|expo)/.test(phone));
  const native2 = readFileSync(path.join(ROOT, "mobile/src/health/nights.ts"), "utf8");
  check("the night reducer has no imports", !/^import /m.test(native2));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
