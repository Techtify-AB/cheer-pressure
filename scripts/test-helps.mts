// Unit tests for "What helps you?" and step one of the ladder (lib/helps.ts, lib/brain.ts
// chooseHelp, lib/ladder.ts startWithHelp/offerNext). Run: npx tsx scripts/test-helps.mts
import { addDays } from "../lib/dates.ts";
import { brain, helpChoiceInput } from "../lib/brain.ts";
import {
  addOwn,
  answerOffer,
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
check("learned line is the plain sentence", o1.reason === learnedLine({ id: "music", label: "Music" }) && o1.reason!.startsWith("Last time music was followed by better days"), o1.reason ?? "");
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
check("score is (back + 1) / (tried + 2)", Math.abs(out.score - 2 / 5) < 1e-9 && out.tried === 3 && out.back === 1);
const o4 = orderByWhatHelped(list, mixed);
check("light (1 of 1) before music (untried) before outdoors (1 of 3)", o4.order.map((h) => h.id).join() === "light,music,outdoors", o4.order.map((h) => h.id).join());

check("offers only, not answers: 'other' and 'not-now' never count", statsFor(list, [rec("music", "other", undefined), rec("music", "not-now", undefined)]).every((x) => x.tried === 0));
check("unjudged tries do not count yet", statsFor(list, [rec("music", "try", undefined)]).find((x) => x.id === "music")!.tried === 0);
check("exclude leaves out what was already offered", orderByWhatHelped(list, musicHelped, ["music"]).order[0].id === "outdoors");
check("count line in plain words", countLine(out) === "Tried 3 times, followed by better days once.", countLine(out) ?? "");

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
