// Measures how often the rule asks by chance during five steady weeks of made-up but
// realistic data, and whether it still notices the drift in week six.
// Run: npx tsx scripts/measure-rule.mts
import { BAND, MIN_CHANGED_TO_ASK } from "../lib/passive";
import { STEADY_DAYS, makeReplayData, replayFrames } from "../lib/replay";

const SEEDS = 400;
const LAST = "2026-11-14";
let falseAsk = 0, caught = 0, dayOfCatch = 0;
for (let seed = 1; seed <= SEEDS; seed++) {
  const frames = replayFrames(makeReplayData(LAST, seed), LAST);
  if (frames.some((f) => f.day <= STEADY_DAYS && f.evaluation.askNow)) falseAsk++;
  const hit = frames.find((f) => f.day > STEADY_DAYS && f.evaluation.askNow);
  if (hit) { caught++; dayOfCatch += hit.day; }
}
console.log(`usual range ${BAND.low * 100} to ${BAND.high * 100}, at least ${MIN_CHANGED_TO_ASK} measures: asks by chance in ${falseAsk} of ${SEEDS} steady five-week periods; notices the drift in ${caught} of ${SEEDS}${caught ? `, on average on day ${(dayOfCatch / caught).toFixed(1)}` : ""}`);
