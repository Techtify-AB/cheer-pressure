// The clinic report (lib/report.ts): its numbers are ones the person sees on "My values", its
// dates are right, it reads in the first person, it shows empty states with too little data,
// and nothing that makes it can reach the network. Run: pnpm test:report (part of pnpm test).
import { readFileSync } from "node:fs";
import { addDays, daysBetween, formatDay } from "../lib/dates.ts";
import { evaluatePassive, MIN_DAY_PRESSES, SOURCES } from "../lib/passive.ts";
import { firstAsk, replayEndingOn, replayFrames, upTo } from "../lib/replay.ts";
import { DISCLAIMER, REPORT_DAYS, changedSince, clinicReport, measureNumbers, reportText } from "../lib/report.ts";
import { answerSmallThing, answerSomeone, closeLadder, startAfterNotBest } from "../lib/ladder.ts";
import type { AppData } from "../lib/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const TODAY = "2026-11-14";
const empty = (): AppData => ({
  version: 1,
  profile: { createdAt: "", earlySigns: [] },
  daily: [],
  weekly: [],
  reaction: [],
  typingSessions: [],
  typingDays: [],
  activityDays: [],
  checkIns: [],
  settings: { muted: false },
  ladder: null,
});

// Too little data: empty states, no numbers made up.
{
  const r = clinicReport(empty(), TODAY);
  const text = reportText(r);
  check("empty: says there are not enough days yet", !r.enoughData && /Not enough days yet/.test(r.summary), r.summary);
  check(
    "empty: every category names every input it has, as not measured",
    r.sources.length === 4 &&
      r.sources.every((s) => s.lines.length === 1 && s.lines[0].label === "Not measured" && s.lines[0].text.split(", ").length === SOURCES.find((c) => c.id === s.id)!.inputs.filter((i) => !i.retired).length),
    r.sources.map((s) => s.lines.map((l) => l.text).join(" ")).join(" | "),
  );
  check("empty: no answers and no steps", text.includes("None in this period.") && r.answers.length === 0 && r.ladder.length === 0);
  check(
    "empty: data quality counts zero days, by category in order",
    r.quality.length === 5 &&
      r.quality[0].startsWith(`Sleep, estimated from this computer: 0 of ${REPORT_DAYS} days`) &&
      r.quality[1].startsWith(`Energy, movement (camera): 0 of`) &&
      r.quality[2].startsWith(`Energy, typing: 0 of ${REPORT_DAYS} days`) &&
      r.quality[3].startsWith("Social") &&
      r.quality[4].startsWith("Mood"),
    r.quality.join(" | "),
  );
  check("the period is the last eight weeks, today included", r.period.from === addDays(TODAY, -55) && r.period.to === TODAY && r.period.text.startsWith(formatDay(addDays(TODAY, -55))));
}

// The replay's days, on the day Cheri asks, with answers, weekly questions and the ladder.
const placed = replayEndingOn(TODAY)!;
const stop = firstAsk(replayFrames(placed.data, placed.lastDay))!;
const data: AppData = { ...empty(), ...upTo(placed.data, TODAY) };
const started = addDays(TODAY, -9);
data.checkIns = [
  { id: "a", date: addDays(TODAY, -20), at: "", answer: "okay", triggeredBy: [], basedOn: { days: 7, usualDays: 26 }, simulated: true },
  { id: "b", date: started, at: "", answer: "not-best", triggeredBy: [], basedOn: { days: 7, usualDays: 26 }, simulated: true },
];
data.weekly = [{ id: "w", date: started, down: 2, interest: 1, sleep: 1, tense: 1, signs: [], source: "demo", savedAt: "" }];
data.ladder = answerSomeone(answerSmallThing(startAfterNotBest(started, "walk", true), "try", started), "yes", addDays(started, 2));
const e = evaluatePassive(data, TODAY);
const r = clinicReport(data, TODAY, e);
const text = reportText(r);
check("the day the replay stops is today", stop.date === TODAY && e.askNow);

// Numbers: only ones "My values" shows (measureNumbers), counts of days, and dates.
{
  const seen = new Set<string>();
  const add = (s: string | number | null) => {
    if (s === null) return;
    for (const n of String(s).match(/\d+(\.\d+)?/g) ?? []) seen.add(n);
  };
  for (const m of e.metrics) Object.values(measureNumbers(m)).forEach(add);
  const kinds = (data.typingDays ?? []).filter((t) => t.kind === "all" && daysBetween(t.date, TODAY) < REPORT_DAYS);
  const enough = kinds.filter((t) => t.presses >= MIN_DAY_PRESSES).length;
  const little = kinds.length - enough;
  const activity = data.activityDays.filter((a) => daysBetween(a.date, TODAY) < REPORT_DAYS).length;
  const inReport = (d: string) => daysBetween(d, TODAY) >= 0 && daysBetween(d, TODAY) < REPORT_DAYS;
  const movementDays = new Set((data.movementSessions ?? []).filter((m) => inReport(m.date) && m.minutes >= 20).map((m) => m.date)).size;
  const contactDays = new Set((data.contactDays ?? []).filter((c) => inReport(c.date)).map((c) => c.date)).size;
  const answeredDays = new Set((data.dailyAnswers ?? []).filter((a) => a.answer && inReport(a.date)).map((a) => a.date)).size;
  [enough, little, REPORT_DAYS - enough - little, activity, movementDays, contactDays, answeredDays, REPORT_DAYS, MIN_DAY_PRESSES, 10, 4, 3, 6, 0, 2].forEach(add);
  // Counts of answers per week (the person gave them), counted here on their own.
  for (let w = 0; w < 4; w++) {
    const week = (data.dailyAnswers ?? []).filter((a) => daysBetween(a.date, TODAY) >= 7 * w && daysBetween(a.date, TODAY) < 7 * w + 7);
    for (const v of ["good", "okay", "not-so-good"]) add(week.filter((a) => a.answer === v).length);
    add(7 - week.filter((a) => a.answer).length);
  }
  const withoutDates = text
    .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} [A-Z][a-z]{2,3}\b/g, "")
    .replace(/PHQ-2/g, "")
    .replace(/\b\d{1,2}:\d{2}\b/g, (t) => (seen.has(t.replace(":", "")) || [...seen].length ? t : t));
  const times = new Set<string>();
  for (const m of e.metrics) {
    const n = measureNumbers(m);
    for (const v of [n.recent, n.usualLow, n.usualHigh]) if (v && /\d:\d\d/.test(v)) times.add(v);
  }
  const strange = (withoutDates.replace(/\b\d{2}:\d{2}\b/g, (t) => (times.has(t) ? "" : `[${t}]`)).match(/\[?\d+(\.\d+)?\]?/g) ?? []).filter(
    (n) => n.startsWith("[") || !seen.has(n),
  );
  check("no number the person has not seen on My values (or a count of days, or a date)", strange.length === 0, strange.join(", "));
}

// Dates
{
  const changed = e.metrics.filter((m) => m.status === "changed");
  const okSince = changed.every((m) => {
    const since = changedSince(m, TODAY)!;
    const line = r.sources.flatMap((s) => s.lines).find((l) => l.label === m.label)!;
    return daysBetween(since, TODAY) >= 0 && daysBetween(since, TODAY) < 7 && line.text.includes(`since ${formatDay(since)}`);
  });
  check("each change says since when, a day in the last week", changed.length >= 2 && okSince, changed.map((m) => `${m.key} ${changedSince(m, TODAY)}`).join(", "));
  check("answers to Cheri carry their own dates", r.answers.length === 2 && r.answers[1].startsWith(formatDay(started)) && r.answers[1].includes('"Not my best"'));
  check("PHQ-2 total of the weekly answer", r.weekly.length === 1 && r.weekly[0].includes("PHQ-2 total 3 of 6"), r.weekly[0]);
  check("the ladder's steps, and that the values have not come back", r.ladder.some((x) => x.includes("a walk in daylight") && x.includes("I said I'd try it")) && r.ladder.some((x) => x.includes("asked someone I trust")) && r.ladder[r.ladder.length - 1] === "The values have not come back to my usual yet.");
  const back = clinicReport({ ...data, ladder: closeLadder(data.ladder!, addDays(TODAY, -1)) }, TODAY, e);
  check("and when they came back", back.ladder[back.ladder.length - 1] === `${formatDay(addDays(TODAY, -1))}: the values came back to my usual.`);
  const old = clinicReport({ ...data, checkIns: [{ ...data.checkIns[0], date: addDays(TODAY, -REPORT_DAYS) }] }, TODAY, e);
  check("answers before the period are left out", old.answers.length === 0);
}

// The daily question's answers: counts per week, in plain words.
{
  const own = r.sources.find((s) => s.id === "mood");
  const weeks = own?.lines.filter((l) => l.label.startsWith("Week from")) ?? [];
  const lastWeek = (data.dailyAnswers ?? []).filter((a) => daysBetween(a.date, TODAY) < 7);
  const n = (v: string) => lastWeek.filter((a) => a.answer === v).length;
  check(
    "own answers: four weeks of counts, the last week right",
    own?.label === "Mood" &&
      weeks.length === 4 &&
      weeks[3].text === `${n("good")} Good, ${n("okay")} Okay, ${n("not-so-good")} Not so good, ${7 - lastWeek.filter((a) => a.answer).length} without an answer.`,
    weeks[3]?.text,
  );
  const none = clinicReport({ ...data, dailyAnswers: [] }, TODAY);
  check("own answers: Mood says the daily answer was not measured when the person never answered", none.sources.find((s) => s.id === "mood")!.lines.some((l) => l.label === "Not measured" && l.text.includes("my daily answer (no values)")));
  check("the report has the four categories, in order", r.sources.map((s) => s.label).join() === "Sleep,Energy,Social,Mood");
}

// Wording
check("first person throughout: never \"your\" or \"you\" (outside the quoted question)", !/\byou(r)?\b/i.test(text.replace(/"How are you today\?"/g, "")), (text.match(/.{20}\byou(r)?\b.{20}/i) ?? [""])[0]);
check("compared only with my own usual, never with other people", text.includes("never with other people") && !/average|population|others'/i.test(text));
check("says what each value is and is not", text.includes("not measured sleep") && text.includes("Never which keys"));
check("the prototype line", text.includes(DISCLAIMER) && DISCLAIMER === "A prototype. Not a diagnosis and not for clinical decisions on its own.");
check("no risk, score or diagnosis words, no percentages", !/(risk|score|depress|relapse|diagnosed|%)/i.test(text.replace(DISCLAIMER, "")));
check("no app names or kinds of app, and no typed text beyond answers to Cheri", !/(mail|slack|chrome|safari|code|browser|game)/i.test(text));
check("made-up data is marked", r.simulated && text.includes("Includes made-up demo data."));

// Nothing that makes or shows the report can reach the network.
{
  const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const report = ["lib/report.ts", "app/share/page.tsx"].map(read);
  check("the report and its screen import no messages client and call no fetch", report.every((s) => !/lib\/(messages|trusted)|from "\.\/(messages|trusted)"|\bfetch\(/.test(s)));
  check("My values only reads whether someone is connected: it sends nothing", !/\bfetch\(|send(Reply|Greeting|ContactRequest)|createPair/.test(read("app/values/page.tsx")));
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("report: all passed");
