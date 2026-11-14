// Unit tests for "What helps you?" and step one of the ladder (lib/helps.ts, lib/brain.ts
// chooseHelp, lib/ladder.ts startWithHelp/offerNext). Run: npx tsx scripts/test-helps.mts
import { addDays } from "../lib/dates.ts";
import { brain, helpChoiceInput } from "../lib/brain.ts";
import {
  addOwn,
  answerHelped,
  answerOffer,
  helpedQuestion,
  helpedQuestionDue,
  countLine,
  helpsOf,
  judgeSuggestions,
  learnedLine,
  offeredIn,
  openOffer,
  orderByWhatHelped,
  recordOffer,
  startingList,
  statsFor,
} from "../lib/helps.ts";
import { answerSmallThing, closeLadder, offerNext, startWithHelp } from "../lib/ladder.ts";
import type { HelpItem, SuggestionRecord } from "../lib/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const D = "2026-11-01";
const list: HelpItem[] = startingList(["outdoors", "music", "light"]);
const rec = (item: string, answer: SuggestionRecord["answer"], cameBack: boolean | undefined, day = D): SuggestionRecord => ({
  id: `${item}-${day}-${Math.random()}`,
  ladderStartedOn: day,
  offeredOn: day,
  item,
  label: item,
  answer,
  learned: false,
  cameBack,
  simulated: false,
});

// Ordering by the plain count
const none = orderByWhatHelped(list, []);
check("nothing tried: the person's own list order", none.order.map((h) => h.id).join() === "outdoors,music,light", none.order.map((h) => h.id).join());
check("nothing tried: no learned line", none.reason === null && !none.learned);
check("never an item that is off", !none.order.some((h) => !h.on) && none.order.length === 3);

const musicHelped = [rec("music", "try", true)];
const o1 = orderByWhatHelped(list, musicHelped);
check("tried and followed by values coming back: offered first", o1.order[0].id === "music");
check("learned line without answers says values came back", o1.reason === learnedLine({ id: "music", label: "Music" }) && o1.reason!.startsWith("Last time music was followed by better days"), o1.reason ?? "");
check("learned flag set", o1.learned);

const outdoorsFirstHelped = [rec("outdoors", "try", true)];
const o2 = orderByWhatHelped(list, outdoorsFirstHelped);
check("learned item already first in the list: no line (the plain order would offer it too)", o2.order[0].id === "outdoors" && o2.reason === null);

const outdoorsDidNot = [rec("outdoors", "try", false)];
const o3 = orderByWhatHelped(list, outdoorsDidNot);
check("tried without values coming back: untried things come first", o3.order.map((h) => h.id).join() === "music,light,outdoors", o3.order.map((h) => h.id).join());

const mixed = [rec("outdoors", "try", true), rec("outdoors", "try", false), rec("outdoors", "try", false), rec("light", "try", true)];
const s = statsFor(list, mixed);
const out = s.find((x) => x.id === "outdoors")!;
check("values only: score is (0.25 x back + 1) / (0.25 x tried + 2)", Math.abs(out.score - 1.25 / 2.75) < 1e-9 && out.tried === 3 && out.back === 1, String(out.score));
const o4 = orderByWhatHelped(list, mixed);
check("light (1 of 1) before music (untried) before outdoors (1 of 3)", o4.order.map((h) => h.id).join() === "light,music,outdoors", o4.order.map((h) => h.id).join());

// The person's own answer is the main signal
const said = (item: string, helped: SuggestionRecord["helped"], cameBack?: boolean) => ({ ...rec(item, "try", cameBack), helped });
const walk3of4 = [said("light", "yes"), said("light", "yes"), said("light", "a-little"), said("light", "not-really")];
const sw = statsFor(list, walk3of4).find((x) => x.id === "light")!;
check("answers: yes = 1, a little = 0.5: (2.5 + 1) / (4 + 2)", Math.abs(sw.score - 3.5 / 6) < 1e-9 && sw.asked === 4 && sw.helped === 3, String(sw.score));
const o5 = orderByWhatHelped(list, walk3of4);
check("said it helped 3 of 4 times: offered first", o5.order[0].id === "light");
check("the learned line says what it rests on", o5.reason === "You've said morning light helped 3 of 4 times, so I'm suggesting it first.", o5.reason ?? "");
const notHelpedButBack = [said("outdoors", "not-really", true)];
const o6 = orderByWhatHelped(list, notHelpedButBack);
check("'not really' outweighs values coming back: untried things come first", o6.order[o6.order.length - 1].id === "outdoors", o6.order.map((h) => h.id).join());
const yesNoValues = [said("light", "yes", false)];
const backNoAnswer = [rec("music", "try", true)];
const sy = statsFor(list, yesNoValues).find((x) => x.id === "light")!.score;
const sb = statsFor(list, backNoAnswer).find((x) => x.id === "music")!.score;
check("a yes, even without values coming back, counts more than values coming back alone", sy > sb, `${sy} > ${sb}`);
check("skipped answers count as nothing", statsFor(list, [said("music", "skipped")]).find((x) => x.id === "music")!.asked === 0);
const fb = { music: { yes: 2, aLittle: 0, notReally: 0 } };
const o7 = orderByWhatHelped(list, [], [], fb);
check("answers from the activity library count the same way", o7.order[0].id === "music" && o7.reason === "You've said music helped 2 of 2 times, so I'm suggesting it first.", o7.reason ?? "");

check("offers only, not answers: 'other' and 'not-now' never count", statsFor(list, [rec("music", "other", undefined), rec("music", "not-now", undefined)]).every((x) => x.tried === 0));
check("unjudged tries do not count yet", statsFor(list, [rec("music", "try", undefined)]).find((x) => x.id === "music")!.tried === 0);
check("exclude leaves out what was already offered", orderByWhatHelped(list, musicHelped, ["music"]).order[0].id === "outdoors");
check("count line in plain words", countLine(out) === "Followed by better days once.", countLine(out) ?? "");
check("count line with answers", countLine(sw) === "You said it helped 3 of 4 times." , countLine(sw) ?? "");

// "Did it help?" for suggestions with no activity behind them
{
  const now = new Date("2026-11-02T15:00:00");
  const base = { ...rec("music", "try", undefined, "2026-11-02"), answeredAt: "2026-11-02T14:00:00" };
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

// The brain picks through the same count
const choice = await brain.chooseHelp(helpChoiceInput(D, list, musicHelped));
check("brain.chooseHelp: the count's first, with its line", choice?.item.id === "music" && choice.learned && !!choice.reason);
const nothing = await brain.chooseHelp(helpChoiceInput(D, startingList([]), []));
check("brain.chooseHelp: null when nothing is on", nothing === null);

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

const notYet = judgeSuggestions(h, ladder, addDays(D, 2));
check("not judged before its days have passed", !notYet.changed);
const back = judgeSuggestions(h, closeLadder(ladder, addDays(D, 2)), addDays(D, 2));
check("values came back within 3 days: judged as back", back.changed && back.history.find((r) => r.id === "b")!.cameBack === true);
const late = judgeSuggestions(h, ladder, addDays(D, 4));
check("4 days without values coming back: judged as not back", late.history.find((r) => r.id === "b")!.cameBack === false);
check("only taken suggestions are judged", late.history.find((r) => r.id === "a")!.cameBack === undefined);
check("next time, music comes first after it was followed by better days", orderByWhatHelped(list, back.history).order[0].id === "music");

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall helps checks passed");
