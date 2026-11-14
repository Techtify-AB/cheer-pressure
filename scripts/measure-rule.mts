// Measures the rule on made-up periods (lib/replay.ts: weekday and weekend differences, days
// away from the computer, days with too little writing, day-to-day wobble):
//
// - by chance: how many of the steady periods make the companion ask at any point in five
//   steady weeks after the 14-day learning period (days 15 to 42 of the steady stretch);
// - drift: whether it notices a one-week drift (sleep slips first, typing follows), and on
//   which day after the drift began.
//
// It prints every candidate "changed" test (CHANGE_TESTS in lib/passive.ts), each with the
// per-source rule (two different sources, or two sleep measures alone; typing alone never).
// Run: npx tsx scripts/measure-rule.mts [periods]
import { CHANGE_TEST, CHANGE_TESTS, enoughToAsk, sourceOf, type ChangeTest, type PassiveMetric } from "../lib/passive";
import { STEADY_DAYS, makeReplayData, replayFrames } from "../lib/replay";

const SEEDS = Number(process.argv[2] ?? 400);
const LAST = "2026-11-14";
const DAYS = STEADY_DAYS + 14; // six steady weeks, then two weeks after the drift began

type Rule = (c: PassiveMetric[]) => boolean;
const sources = (c: PassiveMetric[]) => new Set(c.map((m) => sourceOf(m.key))).size;
const RULES: [string, Rule][] = [
  ["as implemented: two sources (typing, day and night rhythm, movement, own answers), or two sleep measures alone, or the own answers alone", (c) => enoughToAsk(c)],
  ["two different sources only", (c) => sources(c) >= 2],
  ["any two measures", (c) => c.length >= 2],
];

const tests = Object.keys(CHANGE_TESTS) as ChangeTest[];
console.log(`${SEEDS} made-up periods: six steady weeks (asks by chance counted on days 15 to ${STEADY_DAYS}), then a drift from day ${STEADY_DAYS + 1}.`);
for (const test of tests) {
  const stats = RULES.map(() => ({ falseAsk: 0, inWeek: 0, inTwo: 0, lag: 0 }));
  const triggers = new Map<string, number>();
  for (let seed = 1; seed <= SEEDS; seed++) {
    const data = makeReplayData(LAST, seed, { steadyDays: STEADY_DAYS, days: DAYS });
    const frames = replayFrames(data, LAST, { days: DAYS, test });
    RULES.forEach(([, rule], i) => {
      const asks = (f: (typeof frames)[number]) => !f.evaluation.learning && rule(f.evaluation.changed);
      if (frames.some((f) => f.day <= STEADY_DAYS && asks(f))) stats[i].falseAsk++;
      const hit = frames.find((f) => f.day > STEADY_DAYS && asks(f));
      if (hit) {
        const lag = hit.day - STEADY_DAYS;
        if (lag <= 7) stats[i].inWeek++;
        stats[i].inTwo++;
        stats[i].lag += lag;
        if (i === 0) {
          const k = hit.evaluation.changed.map((m) => m.key).join("+");
          triggers.set(k, (triggers.get(k) ?? 0) + 1);
        }
      }
    });
  }
  console.log(`\nchanged test "${test}"${test === CHANGE_TEST ? " (chosen)" : ""}:`);
  RULES.forEach(([name], i) => {
    const s = stats[i];
    console.log(
      `- ${name}: asks by chance in ${s.falseAsk} of ${SEEDS} (${((s.falseAsk / SEEDS) * 100).toFixed(1)} per 100); notices the drift within its first week in ${s.inWeek}, within two weeks in ${s.inTwo}${s.inTwo ? `, on average on day ${(s.lag / s.inTwo).toFixed(1)} of the drift` : ""}`,
    );
  });
  const top = [...triggers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  console.log(`  what made it ask first: ${top.map(([k, n]) => `${k} ${n}`).join(", ")}`);
}
