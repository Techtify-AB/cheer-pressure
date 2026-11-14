// Measures how often the rule asks by chance during five steady weeks of made-up but
// realistic data, and whether it still notices the drift in week six. Prints the rule as
// implemented (lib/passive.ts, enoughToAsk) and the variants it was chosen from.
// Run: npx tsx scripts/measure-rule.mts
import { BAND, enoughToAsk, sourceOf, type PassiveMetric } from "../lib/passive";
import { STEADY_DAYS, makeReplayData, replayFrames } from "../lib/replay";

const SEEDS = 400;
const LAST = "2026-11-14";

type Rule = (changed: PassiveMetric[]) => boolean;
const sources = (c: PassiveMetric[]) => new Set(c.map((m) => sourceOf(m.key))).size;
const sleep = (c: PassiveMetric[]) => c.filter((m) => m.source === "sleep").length;
const VARIANTS: [string, Rule][] = [
  ["as implemented: two sources, or two sleep measures alone", (c) => enoughToAsk(c)],
  ["earlier rule: at least 2 measures of any kind", (c) => c.length >= 2],
  ["two different sources only", (c) => sources(c) >= 2],
  ["one sleep measure alone (rejected)", (c) => sources(c) >= 2 || sleep(c) >= 1],
];

const stats = VARIANTS.map(() => ({ falseAsk: 0, caught: 0, dayOfCatch: 0 }));
const firstTriggers = new Map<string, number>();
for (let seed = 1; seed <= SEEDS; seed++) {
  const frames = replayFrames(makeReplayData(LAST, seed), LAST);
  VARIANTS.forEach(([, rule], i) => {
    const asks = (f: (typeof frames)[number]) => !f.evaluation.learning && rule(f.evaluation.changed);
    if (frames.some((f) => f.day <= STEADY_DAYS && asks(f))) stats[i].falseAsk++;
    const hit = frames.find((f) => f.day > STEADY_DAYS && asks(f));
    if (hit) {
      stats[i].caught++;
      stats[i].dayOfCatch += hit.day;
      if (i === 0) {
        const k = hit.evaluation.changed.map((m) => m.key).join("+");
        firstTriggers.set(k, (firstTriggers.get(k) ?? 0) + 1);
      }
    }
  });
}
console.log(`usual range ${BAND.low * 100} to ${BAND.high * 100}, ${SEEDS} made-up five-week periods, drift in week six:`);
VARIANTS.forEach(([name], i) => {
  const s = stats[i];
  console.log(
    `- ${name}: asks by chance in ${s.falseAsk} of ${SEEDS}; notices the drift in ${s.caught} of ${SEEDS}${s.caught ? `, on average on day ${(s.dayOfCatch / s.caught).toFixed(1)}` : ""}`,
  );
});
const top = [...firstTriggers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
console.log(`what made it ask first (as implemented): ${top.map(([k, n]) => `${k} ${n}`).join(", ")}`);
