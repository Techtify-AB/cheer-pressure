// Tiny check of the browser-side typing calculation (lib/typing.ts), with the same
// cases as the Rust tests in src-tauri/src/rhythm.rs.
// Run: node --experimental-strip-types scripts/test-typing.mts
import { quantile, SESSION_IDLE_MS, TypingCollector, typingStats } from "../lib/typing.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}
const close = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9;

const v = [100, 200, 300, 400];
check("quantile", close(quantile(v, 0.5), 250) && close(quantile(v, 0.25), 175) && close(quantile(v, 0.95), 385) && quantile([], 0.5) === null);

const even = typingStats(Array.from({ length: 11 }, (_, i) => i * 200), [90, 100, 110]);
check("even typing has no spread", even.presses === 11 && close(even.medianIntervalMs, 200) && close(even.spreadMs, 0) && close(even.medianHoldMs, 100));

const gaps = typingStats([0, 100, 200, 10_200, 10_300], []);
check("gaps over 5 s are not intervals", gaps.presses === 5 && close(gaps.medianIntervalMs, 100) && close(gaps.p95PauseMs, 100) && gaps.medianHoldMs === null);

let t = 0;
const uneven = [0];
for (let i = 0; i < 20; i++) uneven.push((t += i % 2 === 0 ? 90 : 420));
const a = typingStats(Array.from({ length: 21 }, (_, i) => i * 180), []).spreadMs!;
const b = typingStats(uneven, []).spreadMs!;
check("uneven typing has a larger spread", b > a + 100, `even ${a}, uneven ${b}`);

const c = new TypingCollector();
c.keyDown(0);
c.keyDown(50);
c.keyUp(100);
c.keyUp(160);
const s = c.live(200);
check("release pairs with oldest open press", s.presses === 2 && close(s.medianIntervalMs, 50) && close(s.medianHoldMs, 105));

const lost = new TypingCollector();
lost.keyDown(0);
lost.keyDown(3_000);
lost.keyUp(3_080);
check("lost releases do not pair later", close(lost.live(3_100).medianHoldMs, 80));

const sess = new TypingCollector();
for (let i = 0; i < 30; i++) {
  sess.keyDown(i * 150);
  sess.keyUp(i * 150 + 80);
}
const notYet = sess.endIfIdle(4_350 + 60_000);
const end = sess.endIfIdle(4_350 + SESSION_IDLE_MS);
check("session ends after 5 idle minutes", notYet === null && end !== null && end.stats.presses === 30 && close(end.stats.medianIntervalMs, 150) && close(end.stats.medianHoldMs, 80) && sess.lastPress() === null);

const short = new TypingCollector();
for (let i = 0; i < 5; i++) short.keyDown(i * 100);
check("short sessions are not kept", short.endNow() === null);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
