// The daily question (lib/daily.ts): when it comes up, and the person's own answers as a
// source in the rule (lib/passive.ts). Run: pnpm test:daily (part of pnpm test).
import { addDays } from "../lib/dates.ts";
import { questionDue, questionTime } from "../lib/daily.ts";
import { enoughToAsk, evaluatePassive, judgeAnswers } from "../lib/passive.ts";
import type { AppData, DailyAnswer, DailyAnswerValue, Settings } from "../lib/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const TODAY = "2026-11-14";
const at = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const base: Settings = { muted: true };
const answer = (date: string, value: DailyAnswerValue | null, dismissed = false): DailyAnswer => ({ date, answer: value, dismissed, at: "", source: "user" });
const due = (minutesNow: number, settings: Settings = base, answers: DailyAnswer[] = []) => questionDue({ today: TODAY, minutesNow, settings, answers });

// Time of day
check("default: every day around midday", questionTime(base) === "12:30" && !due(at("12:29")).due && due(at("12:30")).due);
check("morning", questionTime({ ...base, dailyQuestion: { every: "day", when: "morning" } }) === "09:30");
check("evening", due(at("18:29"), { ...base, dailyQuestion: { every: "day", when: "evening" } }).reason === "not-yet");
check(
  "a time inside quiet hours moves to half an hour after they end",
  questionTime({ ...base, quietHours: { from: "22:00", to: "10:00" }, dailyQuestion: { every: "day", when: "morning" } }) === "10:30",
);

// Quiet hours, pause and off
check("never in quiet hours", due(at("23:00"), base).reason === "quiet-hours");
check("never during Pause everything", due(at("13:00"), { ...base, pausedAll: true }).reason === "paused");
check("off is off", due(at("13:00"), { ...base, dailyQuestion: { every: "off", when: "midday" } }).reason === "off");

// Once a day, dismissed for today, no stacking
check("answered today: not again", due(at("15:00"), base, [answer(TODAY, "good")]).reason === "done-today");
check("dismissed today: not again the same day", due(at("20:00"), base, [answer(TODAY, null, true)]).reason === "done-today");
check("dismissed yesterday: comes again today", due(at("13:00"), base, [answer(addDays(TODAY, -1), null, true)]).due);
check(
  "missed days while the computer was off: one question when next here, not several",
  due(at("16:45"), base, [answer(addDays(TODAY, -4), "okay")]).due && due(at("16:46"), base, [answer(addDays(TODAY, -4), "okay"), answer(TODAY, "good")]).reason === "done-today",
);

// How often
const every = (e: NonNullable<Settings["dailyQuestion"]>["every"]) => ({ ...base, dailyQuestion: { every: e, when: "midday" as const } });
check("every other day: not the day after", due(at("13:00"), every("other-day"), [answer(addDays(TODAY, -1), "good")]).reason === "not-this-day");
check("every other day: two days after", due(at("13:00"), every("other-day"), [answer(addDays(TODAY, -2), "good")]).due);
check("twice a week: three days apart", !due(at("13:00"), every("twice-week"), [answer(addDays(TODAY, -2), "good")]).due && due(at("13:00"), every("twice-week"), [answer(addDays(TODAY, -3), "good")]).due);
check("once a week: seven days apart", !due(at("13:00"), every("week"), [answer(addDays(TODAY, -6), "good")]).due && due(at("13:00"), every("week"), [answer(addDays(TODAY, -7), "good")]).due);
check("a dismissal counts as asked for how often", !due(at("13:00"), every("week"), [answer(addDays(TODAY, -3), null, true)]).due);

// The person's own answers as a source
const pts = (values: (number | null)[]) =>
  values.flatMap((v, i) => (v === null ? [] : [{ date: addDays(TODAY, i - (values.length - 1)), value: v }]));
const usualOk = Array.from({ length: 28 }, (_, i) => (i % 9 === 0 ? 2 : i % 2));
check("four Not so good in the last week, more than usual: changed", judgeAnswers(pts([...usualOk, 2, 2, 1, 2, 0, 2, null]), TODAY).status === "changed");
check("three are not enough", judgeAnswers(pts([...usualOk, 2, 2, 1, 2, 0, 0, null]), TODAY).status === "steady");
check(
  "unanswered days are never counted as low",
  judgeAnswers(pts([...usualOk, 2, 2, 2, null, null, null, null]), TODAY).status === "no-recent",
);
const usualLow = Array.from({ length: 28 }, (_, i) => (i % 4 === 3 ? 1 : 2));
check("not more than their usual: not changed", judgeAnswers(pts([...usualLow, 2, 2, 2, 2, 1, 1, 1]), TODAY).status === "steady");
check("too few usual answers: still learning", judgeAnswers(pts([...Array(25).fill(null), 0, 1, 0, 2, 2, 2, 2, 1, 2, 0]), TODAY).status === "learning");
check("the own answers may ask on their own", enoughToAsk([{ key: "ownAnswer" }]) && !enoughToAsk([{ key: "spread" }, { key: "hold" }]));

{
  const data: AppData = {
    version: 1,
    profile: { createdAt: "", earlySigns: [] },
    daily: [],
    weekly: [],
    reaction: [],
    typingSessions: [],
    typingDays: [],
    activityDays: Array.from({ length: 35 }, (_, i) => ({ date: addDays(TODAY, -i), first: "07:30", last: "23:00", source: "user" as const })),
    dailyAnswers: [...usualOk, 2, 2, 1, 2, 0, 2, 2].map((v, i) => answer(addDays(TODAY, i - 34), (["good", "okay", "not-so-good"] as const)[v])),
    checkIns: [],
    settings: { muted: true },
  };
  const e = evaluatePassive(data, TODAY);
  check("in the rule: answers alone make Cheri ask", e.askNow && e.changed.map((m) => m.key).join() === "ownAnswer", `${e.reason} ${e.changed.map((m) => m.key)}`);
  const dismissedOnly = { ...data, dailyAnswers: data.dailyAnswers!.map((a, i) => (i >= 28 ? { ...a, answer: null, dismissed: true } : a)) };
  check("in the rule: a week of dismissals is not a low week", !evaluatePassive(dismissedOnly, TODAY).askNow);
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("daily: all passed");
