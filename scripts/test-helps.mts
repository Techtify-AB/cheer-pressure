// Unit tests for "What helps you?" and step one of the ladder (lib/helps.ts, lib/brain.ts
// chooseHelp, lib/ladder.ts startWithHelp/offerNext): learning from the values (followedBy:
// better, worse, no clear change, too early to tell, nothing to improve, shared credit, missing
// days), the person's own answer as the second signal, the combined order and the words.
// Run: npx tsx scripts/test-helps.mts
import { addDays } from "../lib/dates.ts";
import { brain, helpChoiceInput } from "../lib/brain.ts";
import {
  addOwn,
  AFTER_DAYS,
  answerHelped,
  answerLine,
  answerOffer,
  CLEAR_CHANGE,
  combinedScore,
  countLine,
  disagreementLine,
  doneThings,
  followedBy,
  followedLines,
  followedStats,
  helpedQuestion,
  helpedQuestionDue,
  helpsOf,
  learnedLine,
  MIN_DAYS_EACH_SIDE,
  offeredIn,
  openOffer,
  orderActivities,
  orderByWhatHelped,
  recordOffer,
  startingList,
  statsFor,
  valuesLine,
  WEIGHT,
  type Occasion,
  type ValueSeries,
} from "../lib/helps.ts";
import { answerSmallThing, offerNext, startWithHelp } from "../lib/ladder.ts";
import type { HelpItem, SuggestionRecord } from "../lib/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const D = "2026-11-01";
const list: HelpItem[] = startingList(["outdoors", "music", "light"]);
const rec = (item: string, answer: SuggestionRecord["answer"], day = D): SuggestionRecord => ({
  id: `${item}-${day}-${Math.random()}`,
  ladderStartedOn: day,
  offeredOn: day,
  item,
  label: item,
  answer,
  learned: false,
  simulated: false,
});

// --- Learning from the values ----------------------------------------------------------------
// One measure whose usual runs 10 to 19 (its 10 to 90 band is about 10.9 to 18.1, 7.2 wide),
// for the 40 days before D, and chosen values around D (offset from D: value; null = no value).
function measure(around: Record<number, number | null>, key = "m", center = D): ValueSeries {
  const points: ValueSeries["points"] = [];
  for (let k = -40; k <= 10; k++) {
    const date = addDays(center, k);
    if (k in around) {
      const v = around[k];
      if (v !== null) points.push({ date, value: v });
    } else if (k <= -7) points.push({ date, value: 10 + ((k + 40) % 10) });
    else points.push({ date, value: 15 });
  }
  return { key, points };
}
const around = (before: number, after: number) => ({ [-3]: before, [-2]: before, [-1]: before, 1: after, 2: after, 3: after });
const late = addDays(D, 10);
const one = (series: ValueSeries[], today = late, thing = "activity:outside") => followedBy([{ thing, date: D }], series, today)[0];

const better = one([measure(around(30, 15))]);
check("better: well outside before, inside after", better.followed === "better" && better.after === 0 && better.before! > 1, JSON.stringify(better));
const worse = one([measure(around(22, 35))]);
check("worse: a little outside before, far outside after", worse.followed === "worse", JSON.stringify(worse));
const same = one([measure(around(30, 29))]);
check("no clear change: about as far outside after as before", same.followed === "no-change", JSON.stringify(same));
check(`too early: until ${AFTER_DAYS} days after have passed`, one([measure(around(30, 15))], addDays(D, AFTER_DAYS)).followed === "too-early" && one([measure(around(30, 15))], addDays(D, AFTER_DAYS + 1)).followed === "better");
const nothing = one([measure(around(15, 30))]);
check("nothing to improve: the days before were already usual, even if worse after", nothing.followed === "nothing-to-improve", JSON.stringify(nothing));
check(`nothing to improve also just inside ${CLEAR_CHANGE} of the range`, one([measure(around(19.5, 30))]).followed === "nothing-to-improve");
const missingOne = one([measure({ ...around(30, 15), [-3]: null })]);
check(`missing days: ${MIN_DAYS_EACH_SIDE} of 3 days before are enough`, missingOne.followed === "better" && missingOne.daysBefore === 2);
const missingTwo = one([measure({ ...around(30, 15), 1: null, 2: null })]);
check("missing days: one day after is too few, too early to tell", missingTwo.followed === "too-early" && missingTwo.daysAfter === 1, JSON.stringify(missingTwo));
const noUsual = followedBy([{ thing: "activity:outside", date: D }], [{ key: "m", points: measure(around(30, 15)).points.filter((p) => p.date >= addDays(D, -12)) }], late)[0];
check("a measure without enough usual days does not count: too early to tell", noUsual.followed === "too-early");
const two = one([measure(around(30, 15)), measure(around(15, 15), "steady")]);
check("several measures: averaged per day (one better, one usual: still better)", two.followed === "better" && Math.abs(two.before! - better.before! / 2) < 1e-9, JSON.stringify(two));
const shared = followedBy([{ thing: "activity:outside", date: D }, { thing: "activity:song", date: addDays(D, 1) }], [measure(around(30, 15))], late);
check("two different things within the same three days: half the credit each", shared.length === 2 && shared.every((o) => o.share === 0.5), shared.map((o) => `${o.thing} ${o.share}`).join(", "));
const apart = followedBy([{ thing: "activity:outside", date: D }, { thing: "activity:song", date: addDays(D, -20) }], [measure(around(30, 15))], late);
check("things done far apart keep their whole credit", apart.every((o) => o.share === 1));
const again = followedBy([{ thing: "activity:outside", date: D }, { thing: "activity:outside", date: addDays(D, 2) }, { thing: "activity:outside", date: D }], [measure(around(30, 15))], late);
check("the same thing again within three days is one time, not three", again.length === 1);
const fs = followedStats(shared, ["activity:outside"]);
check("stats: whole times for the words, shares for the score", fs.betterTimes === 1 && fs.countedTimes === 1 && fs.better === 0.5 && fs.counted === 0.5, JSON.stringify(fs));
check(
  "done things: activities, and suggestions taken with no activity behind them",
  doneThings({ activitiesDone: [{ id: "a", activity: "song", date: D, at: "", easier: false, endedEarly: false }], suggestions: [{ ...rec("own-1", "try"), viaActivity: false }, { ...rec("light", "try"), viaActivity: true }, rec("music", "other")] })
    .map((d) => d.thing)
    .join() === "activity:song,help:own-1",
);

// --- Both signals, the score and the order ------------------------------------------------------
const occ = (thing: string, followed: Occasion["followed"], share = 1): Occasion => ({ thing, date: D, followed, before: 1, after: 0, daysBefore: 3, daysAfter: 3, share });
const none = orderByWhatHelped(list);
check("nothing tried: the person's own list order", none.order.map((h) => h.id).join() === "outdoors,music,light", none.order.map((h) => h.id).join());
check("nothing tried: no learned line", none.reason === null && !none.learned);
check("never an item that is off", !none.order.some((h) => !h.on) && none.order.length === 3);
check("untried scores one half", combinedScore({ better: 0, counted: 0 }, { yes: 0, aLittle: 0, notReally: 0 }) === 0.5);
check(
  `weights: better days ${WEIGHT.betterDays}, Yes ${WEIGHT.yes}, A little ${WEIGHT.aLittle}, each answer out of ${WEIGHT.answer}`,
  Math.abs(combinedScore({ better: 3, counted: 4 }, { yes: 2, aLittle: 0, notReally: 0 }) - (3 + 1 + 1) / (4 + 1 + 2)) < 1e-9,
);
check("the values count more than an answer: one better day over one Yes", combinedScore({ better: 1, counted: 1 }, { yes: 0, aLittle: 0, notReally: 0 }) > combinedScore({ better: 0, counted: 0 }, { yes: 1, aLittle: 0, notReally: 0 }));
check("Not really counts against: below untried", combinedScore({ better: 0, counted: 0 }, { yes: 0, aLittle: 0, notReally: 1 }) < 0.5);

const lightBetter = { occasions: [occ("activity:daylight", "better"), occ("activity:daylight", "better"), occ("activity:daylight", "better"), occ("activity:daylight", "no-change")] };
const o1 = orderByWhatHelped(list, lightBetter);
check("followed by better days 3 of 4 times: offered first", o1.order[0].id === "light" && o1.learned);
check("its line says what it rests on, as 'followed by'", o1.reason === "After morning light, your days moved back towards your usual 3 of 4 times, so I'm suggesting it first.", o1.reason ?? "");
const o2 = orderByWhatHelped(list, { ...lightBetter, feedback: { light: { yes: 2, aLittle: 0, notReally: 0 } } });
check("both signals in the line, apart", o2.reason === "After morning light, your days moved back towards your usual 3 of 4 times, and you said it helped twice, so I'm suggesting it first.", o2.reason ?? "");
const o3 = orderByWhatHelped(list, { occasions: [occ("activity:outside", "worse")] });
check("followed by worse days: untried things come first", o3.order.map((h) => h.id).join() === "music,light,outdoors", o3.order.map((h) => h.id).join());
const o4 = orderByWhatHelped(list, { occasions: [occ("activity:outside", "too-early"), occ("activity:song", "nothing-to-improve")] });
check("too early to tell and nothing to improve count for nothing: the list order", o4.order.map((h) => h.id).join() === "outdoors,music,light" && !o4.learned);
const o5 = orderByWhatHelped(list, { occasions: [occ("activity:song", "no-change")], feedback: { music: { yes: 1, aLittle: 0, notReally: 0 } } });
check("said Yes but the days did not move: below untried", o5.order[o5.order.length - 1].id === "music", o5.order.map((h) => h.id).join());
const o6 = orderByWhatHelped(list, { history: [{ ...rec("light", "try"), helped: "yes" }, { ...rec("light", "try"), helped: "yes" }] });
check("only answers (Home's Did it help?): offered first, quoted as theirs", o6.order[0].id === "light" && o6.reason === "You said morning light helped twice, so I'm suggesting it first.", o6.reason ?? "");
check("skipped answers count as nothing", statsFor(list, { history: [{ ...rec("music", "try"), helped: "skipped" }] }).find((x) => x.id === "music")!.score === 0.5);
check("exclude leaves out what was already offered", orderByWhatHelped(list, lightBetter, ["light"]).order[0].id === "outdoors");
const o7 = orderByWhatHelped([{ id: "light", label: "Light in the morning", on: true, own: false }, { id: "music", label: "Music", on: true, own: false }], lightBetter);
check("learned item already first in the list: no line (the plain order would offer it too)", o7.order[0].id === "light" && o7.reason === null);
check("own items are judged by their own suggestions", statsFor([{ id: "own-1", label: "Tax forms", on: true, own: true }], { occasions: [occ("help:own-1", "better")] })[0].values.betterTimes === 1);

// --- Words ---------------------------------------------------------------------------------------
const v = (o: Occasion[], thing = "activity:outside") => followedStats(o, [thing]);
const A = (yes: number, aLittle = 0, notReally = 0) => ({ yes, aLittle, notReally });
check("values line, several times", valuesLine(v([occ("activity:outside", "better"), occ("activity:outside", "better"), occ("activity:outside", "better"), occ("activity:outside", "worse")])) === "Followed by better days 3 of 4 times.");
check("values line, once", valuesLine(v([occ("activity:outside", "better")])) === "Followed by better days last time.");
check("values line, too early", valuesLine(v([occ("activity:outside", "too-early")])) === "Too early to tell.");
check("values line, none: null", valuesLine(v([])) === null);
check("answer line, quoted as theirs", answerLine(A(2)) === "You said it helped twice." && answerLine(A(1, 1, 1)) === "You said it helped 2 of 3 times." && answerLine(A(0)) === null);
const lines = followedLines(v([occ("activity:outside", "better"), occ("activity:outside", "better"), occ("activity:outside", "better"), occ("activity:outside", "no-change")]), A(2));
check("both, apart", lines.join(" ") === "Followed by better days 3 of 4 times. You said it helped twice.", lines.join(" "));
check("disagreement said plainly: Yes but the days did not change", disagreementLine(v([occ("activity:outside", "no-change")]), A(1)) === "You said this helped, though your days did not change much afterwards.");
check("disagreement the other way", disagreementLine(v([occ("activity:outside", "better")]), A(0, 0, 1)) === "Your days moved back towards your usual afterwards, though you said it didn't help much.");
check("no disagreement when they agree", disagreementLine(v([occ("activity:outside", "better")]), A(1)) === null);
check("disagreement replaces the answer line", followedLines(v([occ("activity:outside", "no-change")]), A(1)).join(" ") === "Not followed by better days last time. You said this helped, though your days did not change much afterwards.");
check("count line for Settings", countLine({ values: v([occ("activity:outside", "too-early")]), answers: A(0) }) === "Too early to tell.");
check(
  "learned lines say 'followed by' or quote the person, never 'it helped' as a fact or 'works for you'",
  [o1.reason, o2.reason, o6.reason].every((l) => !!l && !/works for you/i.test(l) && !/helped/i.test(l.replace(/you said (it|morning light) helped/gi, ""))),
);
check("learned line, values once", learnedLine({ id: "light", label: "x" }, { values: v([occ("activity:daylight", "better")], "activity:daylight"), answers: A(0) }) === "After morning light last time, your days moved back towards your usual, so I'm suggesting it first.");

// The activity library: the same score per activity
const libOrder = orderActivities(["outside", "daylight", "song", "game"], [occ("activity:song", "better"), occ("activity:outside", "worse")], [{ activity: "game", feedback: "no" }]);
check("library: followed by better days first, untried next, worse or Not really last", libOrder.join() === "song,daylight,outside,game" || libOrder.join() === "song,daylight,game,outside", libOrder.join());

// "Did it help?" for suggestions with no activity behind them
{
  const now = new Date("2026-11-02T15:00:00");
  const base = { ...rec("music", "try", "2026-11-02"), answeredAt: "2026-11-02T14:00:00" };
  check("asked after a while, the same day", helpedQuestionDue([base], now, "2026-11-02")?.id === base.id);
  check("not right after the tap", helpedQuestionDue([{ ...base, answeredAt: "2026-11-02T14:50:00" }], now, "2026-11-02") === null);
  check("still the next day", helpedQuestionDue([base], new Date("2026-11-03T09:00:00"), "2026-11-03")?.id === base.id);
  check("not two days later", helpedQuestionDue([base], new Date("2026-11-04T09:00:00"), "2026-11-04") === null);
  check("not when an activity was behind it (it asks itself)", helpedQuestionDue([{ ...base, viaActivity: true }], now, "2026-11-02") === null);
  const answered = answerHelped([base], base.id, "skipped");
  check("asked once: Skip ends it", helpedQuestionDue(answered, now, "2026-11-02") === null);
  check("the question in plain words", helpedQuestion({ item: "outdoors", label: "Being outdoors or in nature" }) === "Did time outdoors help?");
}

// Own items
const withOwn = addOwn(list, "  Baking   bread ", "x1");
check("own item added, tidied, on", withOwn.some((h) => h.own && h.label === "Baking bread" && h.on));
check("same own item twice is not added twice", addOwn(withOwn, "baking bread", "x2").filter((h) => h.own).length === 1);

// Before onboarding asked: made from the routines
const fromRoutines = helpsOf({ settings: { routines: { walk: false } } as never });
check("earlier routines: walk off means outdoors off", fromRoutines.find((h) => h.id === "outdoors")!.on === false && fromRoutines.find((h) => h.id === "music")!.on);

// The brain picks through the same score, with both histories
const choice = await brain.chooseHelp(helpChoiceInput(D, list, [], [], null, {}, lightBetter.occasions));
check("brain.chooseHelp: the score's first, with its line", choice?.item.id === "light" && choice.learned && !!choice.reason);
const input = helpChoiceInput(D, list, [], [], null, { music: A(1) }, lightBetter.occasions);
check("brain input carries both histories and the stats", input.occasions.length === 4 && input.feedback.music.yes === 1 && input.stats.length === list.length);
const nothingOn = await brain.chooseHelp(helpChoiceInput(D, startingList([]), []));
check("brain.chooseHelp: null when nothing is on", nothingOn === null);

// Recording: offered, taken, judged
let h: SuggestionRecord[] = [];
h = recordOffer(h, { id: "a", ladderStartedOn: D, today: D, item: list[0], learned: false, simulated: false });
check("offer recorded unanswered", openOffer(h, D)?.id === "a");
h = answerOffer(h, "a", "other");
h = recordOffer(h, { id: "b", ladderStartedOn: D, today: D, item: list[1], learned: false, simulated: false });
check("Something else: both in this ladder's offers", offeredIn(h, D).join() === "outdoors,music");
h = answerOffer(h, "b", "try");
check("an answer is kept once", answerOffer(h, "b", "not-now").find((r) => r.id === "b")!.answer === "try");

let ladder = startWithHelp(D, { item: "outdoors", label: "Being outdoors or in nature", learned: false }, false);
ladder = offerNext(ladder, { item: "music", label: "Music", learned: false }, D);
ladder = answerSmallThing(ladder, "try", D);
check("ladder step one holds the item offered last and its answer", ladder.smallThing?.item === "music" && ladder.smallThing.answer === "try");

// The activity library's answers, mapped onto the person's own list
{
  const { feedbackFromActivities } = await import("../lib/helps.ts");
  const done = (activity: string, feedback: "yes" | "a-little" | "no" | null) => ({ activity, feedback }) as never;
  const fbA = feedbackFromActivities({ helps: list, settings: {} as never, activitiesDone: [done("song", "yes"), done("song", "yes"), done("song", "no"), done("daylight", null)] });
  check("activity answers map onto the list (music is the song activity)", fbA.music?.yes === 2 && fbA.music.aLittle === 0 && fbA.music.notReally === 1, JSON.stringify(fbA));
  check("an activity done without an answer adds nothing", !fbA.light);
  const oA = orderByWhatHelped(list, { feedback: fbA });
  check("and they order the suggestions", oA.order[0].id === "music" && oA.reason === "You said music helped twice, so I'm suggesting it first.", oA.reason ?? "");
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall helps checks passed");
