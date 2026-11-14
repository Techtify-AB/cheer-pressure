// Unit tests for the passive rule (lib/passive.ts). Run: pnpm test:passive
import { addDays } from "../lib/dates.ts";
import { passiveInput, ruleBrain, SUGGESTIONS } from "../lib/brain.ts";
import { computeLevels } from "../lib/levels.ts";
import {
  calmLine,
  evaluatePassive,
  explainChange,
  judge,
  clockToDayMinutes,
  dayMinutesToClock,
  suggestionFor,
  weeklyInsight,
} from "../lib/passive.ts";
import type { ActivityDay, AppData, TypingSession } from "../lib/types.ts";

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
    activityDays: [],
    checkIns: [],
    settings: { muted: false },
  };
}

function session(date: string, spread: number, pause = 600, hold = 95): TypingSession {
  return {
    id: `t-${date}-${spread}`,
    date,
    measuredIn: "computer",
    windowSec: 600,
    presses: 400,
    medianIntervalMs: 180,
    spreadMs: spread,
    p95PauseMs: pause,
    medianHoldMs: hold,
    source: "user",
    savedAt: "",
  };
}

function day(date: string, first: string, last: string): ActivityDay {
  return { date, first, last, source: "user" };
}

/** n days ending yesterday (or today), steady, then the last `drift` days changed. */
function history(n: number, drift: number, opts: { spread?: boolean; first?: boolean } = {}) {
  const d = empty();
  for (let i = n; i >= 1; i--) {
    const date = addDays(TODAY, -i);
    const inDrift = i <= drift;
    const wobble = (i % 3) * 4; // 0, 4, 8
    d.typingSessions.push(session(date, inDrift && opts.spread ? 160 + wobble : 90 + wobble));
    const first = inDrift && opts.first ? `09:${30 + (i % 3) * 5}` : `07:${10 + (i % 3) * 5}`;
    d.activityDays.push(day(date, first, `23:${10 + (i % 3) * 5}`));
  }
  return d;
}

// judge
check("judge: learning below 7 earlier + 3 recent", judge([1, 2, 3, 4, 5, 6, 7, 8, 9]).status === "learning");
const steady = judge([10, 11, 12, 10, 11, 12, 10, 11, 12, 11]);
check("judge: inside the usual range is steady", steady.status === "steady" && steady.direction === null);
const up = judge([10, 11, 12, 10, 11, 12, 10, 20, 21, 22]);
check("judge: all of the last 3 above the usual range is up", up.status === "changed" && up.direction === "up");
const down = judge([10, 11, 12, 10, 11, 12, 10, 2, 3, 4]);
check("judge: all of the last 3 below the usual range is down", down.status === "changed" && down.direction === "down");
const mixed = judge([10, 11, 12, 10, 11, 12, 10, 2, 3, 30]);
check("judge: two low and one high is not a change (needs three in a row)", mixed.status === "steady");
const oneOff = judge([10, 11, 12, 10, 11, 12, 10, 11, 40, 11]);
check("judge: one odd session does not count", oneOff.status === "steady");

// clock helpers
check("day minutes: 00:40 comes after 23:10", clockToDayMinutes("00:40") > clockToDayMinutes("23:10"));
check("day minutes round trip", dayMinutesToClock(clockToDayMinutes("01:15")) === "01:15");

// evaluate
const young = history(5, 0);
const ey = evaluatePassive(young, TODAY);
check("first days: learning and never asks", ey.learning && !ey.askNow && ey.reason === "learning", `${ey.daysOfData} days`);

const calm = history(20, 0);
const ec = evaluatePassive(calm, TODAY);
check("steady history: does not ask", !ec.learning && !ec.askNow && ec.changed.length === 0, ec.reason);

const one = history(20, 3, { spread: true });
const eo = evaluatePassive(one, TODAY);
check("one change: does not ask", !eo.askNow && eo.changed.map((m) => m.key).join() === "spread", eo.reason);

const two = history(20, 3, { spread: true, first: true });
const et = evaluatePassive(two, TODAY);
const keys = et.changed.map((m) => m.key);
check("two changes: asks", et.askNow && keys.includes("spread") && keys.includes("firstActivity"), keys.join());
check(
  "explanation is plain",
  /^Three things have changed compared with your usual: your typing has been more uneven, your days have started later and .+\. This is based on your last 3 typing sessions and 3 days\.$/.test(
    explainChange(et),
  ),
  explainChange(et),
);
check("based on 3 sessions and 3 days", et.basedOn.sessions === 3 && et.basedOn.days === 3);

const asked = history(20, 3, { spread: true, first: true });
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
const stale = history(20, 0);
stale.typingSessions = stale.typingSessions.map((s) => ({ ...s, date: addDays(s.date, -30) }));
const est = evaluatePassive(stale, TODAY).metrics.find((m) => m.key === "spread")!;
check("old sessions only: no recent comparison", est.status === "no-recent");

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
const lastThree = passiveInput(et).measures.find((m) => m.key === "spread")!;
check("brain input carries the last three values and usual range", lastThree.lastThree?.length === 3 && !!lastThree.usual);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
