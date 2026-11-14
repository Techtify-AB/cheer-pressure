// Unit tests for the daily hello (lib/hello.ts, lib/daily.ts, the phone's plan in lib/phone.ts)
// and the face model seam (lib/camera/faceModel.ts). Run: npx tsx scripts/test-hello.mts
import { addDays } from "../lib/dates.ts";
import { helloDue, helloObservation, helloUsual, LEARNING_DAYS, reactionOffered } from "../lib/hello.ts";
import { planNotifications } from "../lib/phone.ts";
import { createFaceModel } from "../lib/camera/faceModel.ts";
import type { AppData, DailyAnswer, HelloReading, Settings } from "../lib/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const START = "2026-11-01";
const at = (day: string, hhmm: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return new Date(y, m - 1, d, h, mi);
};
const settings = (s: Partial<Settings> = {}): Settings =>
  ({ dailyQuestion: { every: "twice-week", when: "midday", firstTwoWeeksDaily: true }, quietHours: { from: "22:00", to: "08:00" }, ...s }) as Settings;
const data = (s: Partial<Settings> = {}, answers: DailyAnswer[] = [], readings: HelloReading[] = []) =>
  ({ profile: { createdAt: at(START, "10:00").toISOString(), earlySigns: [] }, settings: settings(s), dailyAnswers: answers, helloReadings: readings }) as unknown as AppData;
const ans = (date: string): DailyAnswer => ({ date, answer: "okay", dismissed: false, at: at(date, "12:40").toISOString(), source: "user" });

// When it comes
check("due at the chosen time on the first day", helloDue(data(), at(START, "12:31")).due);
check("not before the chosen time", helloDue(data(), at(START, "11:00")).reason === "not-yet");
check("never twice a day", helloDue(data({}, [ans(START)]), at(START, "15:00")).reason === "done-today");
check("never in quiet hours (moved out of them)", helloDue(data({ quietHours: { from: "12:00", to: "14:00" } }), at(START, "13:00")).reason === "quiet-hours");
check("every day during the first two weeks", helloDue(data({}, [ans(addDays(START, 5))]), at(addDays(START, 6), "12:31")).due);
check("after two weeks, as chosen (a few times a week): not the next day", helloDue(data({}, [ans(addDays(START, 15))]), at(addDays(START, 16), "12:31")).reason === "not-this-day");
check("after two weeks, as chosen: three days later it comes", helloDue(data({}, [ans(addDays(START, 15))]), at(addDays(START, 18), "12:31")).due);
check("off after two weeks: off", helloDue(data({ dailyQuestion: { every: "off", when: "midday", firstTwoWeeksDaily: true } }), at(addDays(START, 20), "12:31")).reason === "off");
check("chose no daily hello: off from the start", helloDue(data({ dailyQuestion: { every: "off", when: "midday", firstTwoWeeksDaily: false } }), at(START, "12:31")).reason === "off");
check("paused: never", helloDue(data({ pausedAll: true }), at(START, "12:31")).reason === "paused");
const missed = helloDue(data({}, [ans(addDays(START, 1))]), at(addDays(START, 4), "12:31"));
check("a missed day is not stacked: one hello today", missed.due);

// The phone's notifications (lib/phone.ts, planned from the same settings)
const plan = planNotifications(data(), at(START, "09:00")).notices;
check("phone plan: one per day in the first two weeks, at the chosen time", plan.length === 14 && plan.every((n) => new Date(n.at!).getHours() === 12 && new Date(n.at!).getMinutes() === 30), `${plan.length}`);
check("phone plan: opens /hello/", plan.every((n) => n.path === "/hello/"));
const planAnswered = planNotifications(data({}, [ans(START)]), at(START, "09:00")).notices;
check("phone plan: nothing on a day already answered", !planAnswered.some((n) => n.id === `hello-${START}`));
const late = planNotifications(data({}, [], []), at(addDays(START, 20), "09:00")).notices;
const gaps = late.slice(1).map((n, i) => Math.round((Date.parse(n.at!) - Date.parse(late[i].at!)) / 86_400_000));
check("phone plan: after two weeks, every third day (a few times a week)", gaps.length > 0 && gaps.every((g) => g === 3), gaps.join(","));
check("phone plan: nothing while paused", planNotifications(data({ pausedAll: true }), at(START, "09:00")).notices.length === 0);
check("phone plan: never inside quiet hours", plan.every((n) => { const h = new Date(n.at!).getHours(); return h >= 8 && h < 22; }));

// The person's own usual
const r = (date: string, animation: number): HelloReading => ({ date, at: at(date, "12:40").toISOString(), seconds: 4, face: { readings: { animation, smilingShare: 0.2 }, confidence: 1, model: "expression-v1" }, tone: null, source: "user" });
const days = Array.from({ length: LEARNING_DAYS }, (_, i) => r(addDays(START, i), 40 + (i % 5)));
const early = helloUsual(days.slice(0, 5), addDays(START, 20));
check("still learning before two weeks of readings", early.learning && early.days === 5 && early.daysLeft === 9);
check("learning is said plainly", helloObservation(null, early) === "I'm still learning your usual: 5 of 14 days so far.");
const learnt = helloUsual(days, addDays(START, LEARNING_DAYS));
check("after 14 days with readings, the usual exists", !learnt.learning && !!learnt.usual.animation && learnt.usual.animation.n === 14);
const lower = helloObservation(r(addDays(START, 14), 10), learnt);
check("an observation against the person's own usual, never a feeling", lower === "Today your face moved less than your usual. Just an observation.", lower ?? "");
check("within the usual range", helloObservation(r(addDays(START, 14), 42), learnt) === "Today looked like your usual.");
check("two readings on one day count as one day", helloUsual([...days.slice(0, 13), r(addDays(START, 12), 41)], addDays(START, 20)).days === 13);
check("today's own reading is not part of its usual", helloUsual(days, addDays(START, 13)).days === 13);

// The reaction check: at most twice a week, daily in the learning weeks only when agreed
const offered = (date: string): HelloReading => ({ ...r(date, 40), reactionOffered: true });
check("reaction: offered when nothing was offered this week", reactionOffered(data(), addDays(START, 20)));
check("reaction: not a third time in seven days", !reactionOffered(data({}, [], [offered(addDays(START, 17)), offered(addDays(START, 19))]), addDays(START, 20)));
check("reaction: never twice on one day", !reactionOffered(data({}, [], [offered(addDays(START, 20))]), addDays(START, 20)));
check("reaction: daily in the first two weeks when agreed", reactionOffered(data({ helloReaction: true }, [], [offered(addDays(START, 3)), offered(addDays(START, 4))]), addDays(START, 5)));
check("reaction: not daily in the first two weeks without agreeing", !reactionOffered(data({}, [], [offered(addDays(START, 3)), offered(addDays(START, 4))]), addDays(START, 5)));

// The face model seam, default implementation
{
  const m = createFaceModel();
  await m.init();
  let last = null as ReturnType<typeof m.read>;
  for (let i = 0; i < 12 * 12; i++) {
    const t = i * 83;
    const wobble = Math.sin(i / 3) * 0.3 + 0.3;
    last = m.read({ t, blendshapes: { mouthSmileLeft: i % 24 < 12 ? 0.8 : 0.1, mouthSmileRight: i % 24 < 12 ? 0.8 : 0.1, jawOpen: wobble, browInnerUp: wobble / 2 } }) ?? last;
  }
  check("face model: named readings with a confidence", !!last && typeof last.readings.animation === "number" && typeof last.readings.smilingShare === "number" && last.confidence > 0 && last.confidence <= 1, JSON.stringify(last));
  check("face model: about half the time smiling here", !!last && last.readings.smilingShare > 0.3 && last.readings.smilingShare < 0.7);
  const none = createFaceModel();
  check("face model: no face, no reading", none.read({ t: 0, blendshapes: null }) === null && none.read({ t: 500, blendshapes: null }) === null);
  m.dispose();
  check("face model: name stored with readings", m.name === "expression-v1");
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall hello checks passed");
