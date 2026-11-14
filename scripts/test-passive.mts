// Unit tests for the passive rule (lib/passive.ts). Run: pnpm test:passive
import { addDays, daysBetween } from "../lib/dates.ts";
import { passiveInput, ruleBrain, SUGGESTIONS } from "../lib/brain.ts";
import { computeLevels } from "../lib/levels.ts";
import { forRule } from "../lib/settings.ts";
import {
  calmLine,
  evaluatePassive,
  explainChange,
  judgeDays,
  isWeekend,
  typingKindFor,
  clockToDayMinutes,
  dayMinutesToClock,
  suggestionFor,
  weeklyInsight,
  enoughToAsk,
  movementPoints,
  cameraMoodPoints,
  tonePoints,
  PASSIVE_DEFS,
  sourceOf,
  SOURCES,
} from "../lib/passive.ts";
import type { ActivityDay, AppData, TypingDay } from "../lib/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const TODAY = "2026-11-14";

function empty(): AppData {
  return {
    version: 1,
    profile: { createdAt: "", earlySigns: [] },
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

function typingDay(date: string, spread: number | null, hold: number | null, kind: TypingDay["kind"] = "all", presses = 900): TypingDay {
  return { date, kind, measuredIn: "computer", presses, bursts: 9, spreadMs: spread, holdMs: hold, thinkingPer100: 4, source: "user", savedAt: "" };
}

function day(date: string, first: string, last: string): ActivityDay {
  return { date, first, last, source: "user" };
}

/** n days ending today, steady with a small wobble, then the last `drift` days changed. */
function history(n: number, drift: number, opts: { spread?: boolean; hold?: boolean; first?: boolean; last?: boolean } = {}) {
  const d = empty();
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(TODAY, -i);
    const inDrift = i < drift;
    const wobble = (i % 3) * 4; // 0, 4, 8
    d.typingDays!.push(typingDay(date, inDrift && opts.spread ? 160 + wobble : 90 + wobble, inDrift && opts.hold ? 140 + wobble : 95 + wobble));
    const first = inDrift && opts.first ? `09:${30 + (i % 3) * 5}` : `07:${10 + (i % 3) * 5}`;
    const last = inDrift && opts.last ? `01:${10 + (i % 3) * 5}` : `23:${10 + (i % 3) * 5}`;
    d.activityDays.push(day(date, first, last));
  }
  return d;
}

const pts = (values: number[], end = TODAY) => values.map((value, i) => ({ date: addDays(end, i - (values.length - 1)), value }));
const steadyVals = (n: number) => Array.from({ length: n }, (_, i) => 10 + (i % 3));

// The windows: usual is the 28 days before the last week, recent is the last 7 days.
check("windows: 9 usual days is still learning", judgeDays(pts([...steadyVals(9), ...steadyVals(7)]), TODAY).status === "learning");
check("windows: 10 usual days is enough", judgeDays(pts([...steadyVals(10), ...steadyVals(7)]), TODAY).status === "steady");
/** 28 steady usual days (35 to 8 days ago), then the given recent values on the last days. */
const withRecent = (recent: number[]) => [
  ...steadyVals(28).map((value, i) => ({ date: addDays(TODAY, -34 + i), value })),
  ...recent.map((value, i) => ({ date: addDays(TODAY, i - (recent.length - 1)), value })),
];
check("windows: 3 days in the last week is not enough to compare", judgeDays(withRecent([20, 21, 22]), TODAY).status === "no-recent");
const j4 = judgeDays(withRecent([20, 21, 22, 23]), TODAY);
check("windows: 4 days in the last week are enough", j4.status === "changed" && j4.direction === "up" && j4.recent?.n === 4);
const old = pts([...steadyVals(28), ...Array(7).fill(30), ...steadyVals(7)]);
check("windows: days older than 35 days are not in the usual", judgeDays(pts([...Array(10).fill(50), ...steadyVals(28), ...steadyVals(7)]), TODAY).usual?.high === 12);
check("windows: a week that came back is steady", judgeDays(old, TODAY).status === "steady");
check("judge: the middle of the week clearly above is up", judgeDays(pts([...steadyVals(28), 20, 21, 22, 11, 20, 21, 22]), TODAY).direction === "up");
check("judge: clearly below is down", judgeDays(pts([...steadyVals(28), 2, 3, 4, 2, 3, 4, 3]), TODAY).direction === "down");
check("judge: two odd days in the week do not count", judgeDays(pts([...steadyVals(28), 40, 11, 10, 40, 12, 11, 10]), TODAY).status === "steady");
check("judge: just outside the band is not clearly outside", judgeDays(pts([...steadyVals(28), ...Array(7).fill(12.3)]), TODAY).status === "steady");

// Weekdays with weekdays, weekends with weekends
{
  // Weekends always 30 higher; a week that keeps that pattern is steady only when they are compared apart.
  const series = Array.from({ length: 35 }, (_, i) => {
    const date = addDays(TODAY, i - 34);
    return { date, value: (isWeekend(date) ? 40 : 10) + (i % 3) };
  });
  const j = judgeDays(series, TODAY);
  check("weekday split: a usual weekend level is not a change", j.split && j.status === "steady", j.status);
  const weekendsOnWeekdays = series.map((p, i) => (i >= 28 && !isWeekend(p.date) ? { ...p, value: 40 + (i % 3) } : p));
  const jw = judgeDays(weekendsOnWeekdays, TODAY);
  check("weekday split: weekdays that look like weekends are a change", jw.split && jw.status === "changed" && jw.direction === "up");
  const fewWeekends = series.filter((p, i) => i >= 28 || !isWeekend(p.date) || i < 7);
  const jf = judgeDays(fewWeekends, TODAY);
  check("weekday split: too few usual weekend days, so pooled", !jf.split, `${fewWeekends.filter((p) => isWeekend(p.date)).length} weekend days`);
}

// Typing compares like with like
{
  const d = empty();
  for (let i = 34; i >= 0; i--) {
    const date = addDays(TODAY, -i);
    d.typingDays!.push(typingDay(date, 80 + (i % 3), 90, "writing", 1500));
    d.typingDays!.push(typingDay(date, 140 + (i % 3), 110, "code", 400));
    d.typingDays!.push(typingDay(date, 100 + (i % 3), 95, "all", 1900));
  }
  check("like with like: the kind with the most presses this week", typingKindFor(d.typingDays!, TODAY) === "writing");
  const sparse = { ...d, typingDays: d.typingDays!.filter((t) => t.kind !== "writing" || daysBetween(t.date, TODAY) < 7) };
  check("like with like: without enough usual days of a kind, the code days are used", typingKindFor(sparse.typingDays!, TODAY) === "code");
  const pooled = { ...d, typingDays: d.typingDays!.filter((t) => t.kind === "all") };
  check("like with like: otherwise pooled", typingKindFor(pooled.typingDays!, TODAY) === "all");
  // An unusual week of code (more thought, slower) does not look like a change in writing.
  const codeWeek = structuredClone(d);
  for (const t of codeWeek.typingDays!) if (daysBetween(t.date, TODAY) < 7 && t.kind === "code") t.presses = 400;
  const e = evaluatePassive(codeWeek, TODAY).metrics.find((m) => m.key === "spread")!;
  check("like with like: the metric says which kind it compared", e.kind === "writing" && e.status === "steady");
  const few = typingDay(TODAY, 300, 300, "all", 120);
  check("a day under 300 counted presses has no typing value", typingKindFor([few], TODAY) === "all" && evaluatePassive({ ...empty(), typingDays: [few] }, TODAY).metrics.find((m) => m.key === "spread")!.points.length === 0);
}

// Movement from the camera: one value per day, weighted by minutes, never on its own
{
  const d = empty();
  d.movementSessions = [
    { date: TODAY, minutes: 10, movementMean: 0.1, shiftsPerHour: 6, source: "user", savedAt: "" },
    { date: TODAY, minutes: 30, movementMean: 0.02, shiftsPerHour: 12, source: "user", savedAt: "" },
    { date: addDays(TODAY, -1), minutes: 15, movementMean: 0.05, shiftsPerHour: 5, source: "user", savedAt: "" },
  ];
  const lv = movementPoints(d, "movementLevel", TODAY);
  const sh = movementPoints(d, "positionChanges", TODAY);
  check("movement: a day under 20 minutes in frame has no value", lv.length === 1 && lv[0].date === TODAY);
  check("movement: pooled by minutes in frame", Math.abs(lv[0].value - 0.04) < 1e-9 && Math.abs(sh[0].value - 10.5) < 1e-9, `${lv[0].value} ${sh[0].value}`);
  check("movement is part of Energy, with typing", sourceOf("movementLevel") === "energy" && sourceOf("spread") === "energy" && !enoughToAsk([{ key: "movementLevel" }, { key: "spread" }]) && enoughToAsk([{ key: "movementLevel" }, { key: "firstActivity" }]));
  const off = forRule({ ...d, settings: { muted: true } });
  const on = forRule({ ...d, settings: { muted: true, sources: { typing: true, dayRhythm: true, camera: true } } });
  check("movement: the camera is off by default, so the person's own stretches are left out", (off.movementSessions ?? []).length === 0 && (on.movementSessions ?? []).length === 3);
  const changed = history(40, 7, { spread: true });
  for (let i = 34; i >= 0; i--) {
    const low = i < 7;
    changed.movementSessions!.push({ date: addDays(TODAY, -i), minutes: 60, movementMean: low ? 0.01 + (i % 3) * 0.001 : 0.06 + (i % 3) * 0.004, shiftsPerHour: 8 + (i % 3), source: "user", savedAt: "" });
  }
  changed.settings.sources = { typing: true, dayRhythm: true, camera: true };
  const e = evaluatePassive(forRule(changed), TODAY);
  check("movement and typing together are one category, Energy, so Cheri does not ask", !e.askNow && e.changed.some((m) => m.key === "movementLevel") && e.changed.some((m) => m.key === "spread"), e.changed.map((m) => m.key).join());
}

// Mood from the camera and the microphone: observations that never outweigh the person's answer
{
  check("face movement with Energy may support a change (two categories)", enoughToAsk([{ key: "faceMovement" }, { key: "spread" }]));
  check("but not when the person's own answers have been steady", !enoughToAsk([{ key: "faceMovement" }, { key: "spread" }], { answerSteady: true }));
  check("Mood sensors alone never ask", !enoughToAsk([{ key: "faceMovement" }, { key: "posture" }, { key: "pitchVariability" }]));
  const d = empty();
  d.movementSessions = [
    { date: TODAY, minutes: 30, movementMean: 0.05, shiftsPerHour: 8, expression: { minutesWithFace: 6, smilingShare: 0.2, smilesPerHour: 3, animationMean: 0.5, browLoweredShare: 0.9 }, posture: { minutes: 30, uprightMean: 1.2, usual: 1.1, slumpedShare: 0.1, uprightShare: 0.2 }, source: "user", savedAt: "" },
    { date: TODAY, minutes: 10, movementMean: 0.05, shiftsPerHour: 8, expression: { minutesWithFace: 6, smilingShare: 0.4, smilesPerHour: 3, animationMean: 0.3, browLoweredShare: 0.9 }, posture: null, source: "user", savedAt: "" },
  ];
  const face = cameraMoodPoints(d, "faceMovement", TODAY);
  const smile = cameraMoodPoints(d, "raisedMouth", TODAY);
  const sit = cameraMoodPoints(d, "posture", TODAY);
  check("face and posture: one value per day, weighted by minutes, from 10 minutes", Math.abs(face[0].value - 0.4) < 1e-9 && Math.abs(smile[0].value - 0.3) < 1e-9 && Math.abs(sit[0].value - 1.2) < 1e-9);
  check("lowered brows are stored but never a measure", !PASSIVE_DEFS.some((x) => /brow/i.test(x.key + x.label)));
  d.toneSessions = [
    { date: TODAY, minutes: 10, speakingMinutes: 2, segmentsPerMinute: 30, pitchVariability: 2, loudnessMean: -30, source: "user", savedAt: "" },
    { date: addDays(TODAY, -1), minutes: 10, speakingMinutes: 4, segmentsPerMinute: 20, pitchVariability: 3, loudnessMean: -30, source: "user", savedAt: "" },
  ];
  check("voice: pace and tone per day from 3 minutes of talking", tonePoints(d, "voicePace", TODAY).length === 1 && tonePoints(d, "pitchVariability", TODAY)[0].value === 3);
  const sensorWords = PASSIVE_DEFS.filter((x) => ["faceMovement", "raisedMouth", "posture", "pitchVariability", "voicePace", "movementLevel"].includes(x.key)).flatMap((x) => [x.up, x.down, x.label, x.meaning]).join(" ");
  check("sensor wording names an observation, never a feeling", !/\b(sad|happy|mood|low|depress|anxious|upset|angry|feel)\b/i.test(sensorWords), (sensorWords.match(/\b(sad|happy|mood|low|depress|anxious|upset|angry|feel)\w*/i) ?? [""])[0]);
}

// Older data must not crash, and old sessions are ignored by the rule
{
  const legacy = { ...empty(), typingDays: undefined } as unknown as AppData;
  legacy.typingSessions = Array.from({ length: 40 }, (_, i) => ({
    id: `t${i}`, date: addDays(TODAY, -i), measuredIn: "computer" as const, windowSec: 600, presses: 400,
    medianIntervalMs: 180, spreadMs: i < 3 ? 400 : 90, p95PauseMs: 600, medianHoldMs: 95, source: "user" as const, savedAt: "",
  }));
  const e = evaluatePassive(legacy, TODAY);
  check("older stored sessions load and are ignored by the rule", e.metrics.find((m) => m.key === "spread")!.points.length === 0 && !e.askNow);
}

// clock helpers
check("day minutes: 00:40 comes after 23:10", clockToDayMinutes("00:40") > clockToDayMinutes("23:10"));
check("day minutes round trip", dayMinutesToClock(clockToDayMinutes("01:15")) === "01:15");

// evaluate
const young = history(13, 0);
const ey = evaluatePassive(young, TODAY);
check("first 13 days: learning and never asks", ey.learning && !ey.askNow && ey.reason === "learning", `${ey.daysOfData} days`);
check("from 14 days: no longer learning", !evaluatePassive(history(14, 0), TODAY).learning);

const calm = history(40, 0);
const ec = evaluatePassive(calm, TODAY);
check("steady history: does not ask", !ec.learning && !ec.askNow && ec.changed.length === 0, ec.reason);

const one = history(40, 7, { spread: true });
const eo = evaluatePassive(one, TODAY);
check("one change: does not ask", !eo.askNow && eo.changed.map((m) => m.key).join() === "spread", eo.reason);

const two = history(40, 7, { spread: true, first: true });
const et = evaluatePassive(two, TODAY);
const keys = et.changed.map((m) => m.key);
check("two changes: asks", et.askNow && keys.includes("spread") && keys.includes("firstActivity"), keys.join());
check(
  "explanation is plain",
  /^Sleep and Energy have changed compared with your usual: over the last week .*your days have started later.*.*your typing has been more uneven than in the four weeks before\. This compares 7 days this week with 2\d days in the four weeks before\.$/.test(
    explainChange(et),
  ),
  explainChange(et),
);
check("based on 7 days this week and the usual days before", et.basedOn.days === 7 && et.basedOn.usualDays >= 27, JSON.stringify(et.basedOn));

// Sources: typing alone never asks; two sources, or two sleep measures alone, do.
check("every measure belongs to one input in one category", PASSIVE_DEFS.every((d) => SOURCES.flatMap((c) => c.inputs).filter((i) => i.measures.includes(d.key)).length === 1));
check("the four categories, in order", SOURCES.map((c) => c.label).join() === "Sleep,Energy,Social,Mood");
check("Energy alone and Social alone never ask", !enoughToAsk([{ key: "spread" }, { key: "hold" }, { key: "movementLevel" }, { key: "positionChanges" }]) && !enoughToAsk([{ key: "contact" }]));
check("Energy with Social: two categories, so it asks", enoughToAsk([{ key: "spread" }, { key: "contact" }]));
const typingOnly = history(40, 7, { spread: true, hold: true });
const eto = evaluatePassive(typingOnly, TODAY);
check(
  "Energy alone (typing, both measures changed): does not ask",
  !eto.askNow && eto.changed.length === 2 && eto.changed.every((m) => m.source === "energy") && eto.reason === "quiet-only",
  `${eto.changed.map((m) => m.key).join()} ${eto.reason}`,
);
check("typing alone: the companion says nothing", explainChange(eto) === "Nothing stands out compared with your usual right now." && calmLine(eto) === calmLine(ec));
check("typing alone: Your own level shows it and says typing alone does not ask", weeklyInsight(eto).includes("your typing has been more uneven") && weeklyInsight(eto).endsWith("Energy alone never makes me ask."), weeklyInsight(eto));
const sleepTwo = history(40, 7, { first: true, last: true });
const est2 = evaluatePassive(sleepTwo, TODAY);
check(
  "Sleep alone, in several measures: no longer asks (one category)",
  !est2.askNow && est2.changed.every((m) => m.source === "sleep") && est2.changed.length >= 2 && est2.reason === "quiet-only",
  `${est2.changed.map((m) => m.key).join()} ${est2.reason}`,
);
check("Sleep alone: says so on My values", weeklyInsight(est2).endsWith("Sleep alone never makes me ask."), weeklyInsight(est2));
check("enoughToAsk: one Energy and one Sleep", enoughToAsk([{ key: "hold" }, { key: "quietNight" }]));
check("enoughToAsk: two Sleep measures are one category", !enoughToAsk([{ key: "firstActivity" }, { key: "quietNight" }]));
check("enoughToAsk: Mood's own answers alone are one category", !enoughToAsk([{ key: "ownAnswer" }]) && enoughToAsk([{ key: "ownAnswer" }, { key: "lastActivity" }]));
check("enoughToAsk: both typing measures are not enough", !enoughToAsk([{ key: "spread" }, { key: "hold" }]));
check("enoughToAsk: one sleep is not enough", !enoughToAsk([{ key: "lastActivity" }]));
check("explanation names the categories, then the plain observation", /^Sleep and Energy have changed compared with your usual: over the last week your nights have been longer, your days have started later/.test(explainChange(et)), explainChange(et));
check("brain input carries each measure's source", passiveInput(et).measures.every((m) => m.source === sourceOf(m.key)));

const asked = history(40, 7, { spread: true, first: true });
asked.checkIns.push({
  id: "c1",
  date: addDays(TODAY, -1),
  at: "",
  answer: "okay",
  triggeredBy: et.changed.map((m) => ({ key: m.key, direction: m.direction ?? "up" })),
  basedOn: et.basedOn,
  simulated: false,
});
const ea = evaluatePassive(asked, TODAY);
check("asked yesterday about the same: waits", !ea.askNow && ea.reason === "waiting-after-last");

const askedFewer = structuredClone(asked);
askedFewer.checkIns[0].triggeredBy = [{ key: "spread", direction: "up" }];
const ef = evaluatePassive(askedFewer, TODAY);
check("asked yesterday, but something new changed: asks", ef.askNow && ef.reason === "changed");

const askedLongAgo = structuredClone(asked);
askedLongAgo.checkIns[0].date = addDays(TODAY, -3);
check("3 days after asking: asks again", evaluatePassive(askedLongAgo, TODAY).askNow);

const simulated = structuredClone(asked);
simulated.settings.simulatedChangeAt = "now";
const es = evaluatePassive(simulated, TODAY);
check("simulated change ignores the 3-day wait", es.askNow && es.reason === "simulated" && es.simulated);

// quiet night and last activity
const nights = empty();
nights.activityDays.push(day(addDays(TODAY, -1), "07:00", "23:30"), day(TODAY, "07:30", "10:00"));
const en = evaluatePassive(nights, TODAY);
const qn = en.metrics.find((m) => m.key === "quietNight")!;
const la = en.metrics.find((m) => m.key === "lastActivity")!;
check("quiet night spans midnight", qn.points.length === 1 && Math.abs(qn.points[0].value - 8) < 1e-9, String(qn.points[0]?.value));
check("today's last activity is left out", la.points.length === 1 && la.points[0].date === addDays(TODAY, -1));

const lateNight = empty();
lateNight.activityDays.push(day(addDays(TODAY, -1), "08:00", "01:00"), day(TODAY, "09:00", "12:00"));
const ql = evaluatePassive(lateNight, TODAY).metrics.find((m) => m.key === "quietNight")!;
check("last activity after midnight belongs to the day before", Math.abs(ql.points[0].value - 8) < 1e-9, String(ql.points[0]?.value));

// stale data
const stale = history(40, 0);
stale.typingDays = stale.typingDays!.map((s) => ({ ...s, date: addDays(s.date, -8) }));
const est = evaluatePassive(stale, TODAY).metrics.find((m) => m.key === "spread")!;
check("nothing typed in the last week: no recent comparison", est.status === "no-recent");

// the brain: the rule-based default words exactly what the pure functions say
for (const [name, d] of [
  ["learning", young],
  ["steady", calm],
  ["one change", one],
  ["two changes", two],
] as const) {
  const e = evaluatePassive(d, TODAY);
  const out = await ruleBrain.reflect({
    today: TODAY,
    profile: d.profile,
    recentDaily: [],
    recentWeekly: [],
    levels: computeLevels(d, TODAY),
    passive: passiveInput(e),
  });
  check(
    `brain words match the rule functions (${name})`,
    out.passive.explanation === explainChange(e) &&
      out.passive.calmLine === calmLine(e) &&
      out.passive.insight === weeklyInsight(e) &&
      out.passive.suggestion.text === SUGGESTIONS[suggestionFor(e)],
  );
}
const recentIn = passiveInput(et).measures.find((m) => m.key === "spread")!;
check("brain input carries the last week's values and usual range", recentIn.recentValues?.length === 7 && !!recentIn.usual);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");

// The ladder, the routines, the contact stand-in and the demo replay.
await import("./test-ladder.mts");
