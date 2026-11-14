// The browser-side typing calculation (lib/typing.ts): bursts, the under-1-s rule, the
// not-writing checks and the daily pooling. The Rust tests in src-tauri/src/rhythm.rs check
// the same rules. Run: pnpm test:typing
import {
  BurstCollector,
  DayPool,
  MIN_DAY_PRESSES,
  burstNumbers,
  numbers,
  quantile,
  verdict,
  verdictWords,
  type Burst,
} from "../lib/typing.ts";
import { bursts, game, mainBurst, prose, shortcuts } from "./typing-samples.mts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}
const close = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9;

const v = [100, 200, 300, 400];
check("quantile", close(quantile(v, 0.5), 250) && close(quantile(v, 0.25), 175) && close(quantile(v, 0.95), 385) && quantile([], 0.5) === null);

/** Even typing: a press every `gap` ms, each held `hold` ms. */
function even(c: BurstCollector, start: number, n: number, gap: number, hold = 90) {
  const ended: Burst[] = [];
  for (let i = 0; i < n; i++) {
    const t = start + i * gap;
    const e = c.keyDown(t);
    if (e) ended.push(e);
    c.keyUp(t + hold);
  }
  return ended;
}

// Burst cutting
{
  const c = new BurstCollector(() => "writing");
  even(c, 0, 40, 200);
  const cut = even(c, 40 * 200 + 2_500, 40, 200); // a gap over 2 s
  check("a gap over 2 s ends the burst", cut.length === 1 && cut[0].presses === 40 && c.now()?.presses === 40);
  const c2 = new BurstCollector(() => "writing");
  even(c2, 0, 20, 200);
  even(c2, 19 * 200 + 1_900, 20, 200); // a gap of 1.9 s after the 20th press
  check("a gap of 1.9 s does not end it, and counts as one thinking pause", c2.now()?.presses === 40 && c2.now()?.thinking === 1);
  const lastAt = 19 * 200 + 1_900 + 19 * 200;
  check("tick keeps it at 2 s and ends it just after", c2.tick(lastAt + 2_000) === null && c2.tick(lastAt + 2_001) !== null && c2.now() === null);
  const kinds: string[] = [];
  const c3 = new BurstCollector(() => (kinds.push("asked"), "code"));
  even(c3, 0, 35, 150);
  check("the kind of app is asked once, when the burst starts", kinds.length === 1 && c3.now()?.kind === "code");
}

// Motor rhythm only: thinking pauses do not move the rhythm numbers
{
  const c = new BurstCollector(() => "writing");
  even(c, 0, 50, 180);
  const plain = burstNumbers(c.close()!);
  const t = new BurstCollector(() => "writing");
  let at = 0;
  for (let i = 0; i < 50; i++) {
    at += i === 0 ? 0 : i % 10 === 0 ? 1_600 : 180; // a thinking pause every 10 presses
    t.keyDown(at);
    t.keyUp(at + 90);
  }
  const b = t.close()!;
  const thoughtful = burstNumbers(b);
  check("gaps of 1 to 2 s are left out of the rhythm", close(thoughtful.spreadMs, plain.spreadMs!) && close(thoughtful.spreadMs, 0), `${thoughtful.spreadMs}`);
  check("and counted as thinking pauses per 100 presses", b.thinking === 4 && close(thoughtful.thinkingPer100, 8));
  check("motor gaps are only those under 1 s", b.motorGaps.every((g) => g < 1_000) && b.motorGaps.length === 45);
  const n = numbers([100, 200, 300, 400, 500], [90, 100, 110, 3_000], 0, 5);
  check("spread is the 25th to 75th percentile of motor gaps; hold leaves out holds over 2 s", close(n.spreadMs, 200) && close(n.holdMs, 100));
}

// Not writing
{
  const N = 200;
  const proseCounted = Array.from({ length: N }, (_, i) => verdict(mainBurst(prose(i + 1))).counted).filter(Boolean).length;
  const gameWhy = Array.from({ length: N }, (_, i) => verdict(mainBurst(game(i + 1, 80, i % 2 === 0))));
  const shortWhy = Array.from({ length: N }, (_, i) => verdict(mainBurst(shortcuts(i + 1))));
  check("generated prose counts as writing", proseCounted === N, `${proseCounted} of ${N}`);
  check("generated game input never counts (held keys or keys at once)", gameWhy.every((x) => !x.counted && (x.why === "held-keys" || x.why === "keys-at-once")));
  check("generated shortcut tapping never counts", shortWhy.every((x) => !x.counted));
  const held = new BurstCollector(() => "writing");
  held.keyDown(0);
  for (let t = 400; t < 3_000; t += 80) held.keyDown(t, true);
  const h = verdict(held.now()!);
  check("holding one key down: not counted, held keys", !h.counted && h.why === "held-keys", verdictWords(h, "writing", 1));
  const short = new BurstCollector(() => "writing");
  even(short, 0, 12, 150);
  const s = verdict(short.now()!);
  check("a few presses: not counted, too short", !s.counted && s.why === "too-short", verdictWords(s, "writing", 12));
  const inGame = new BurstCollector(() => "game");
  even(inGame, 0, 60, 180);
  const g = verdict(inGame.close()!);
  check("anything typed while a game is in front is never counted", !g.counted && g.why === "game");
  const mash = new BurstCollector(() => "writing");
  for (let i = 0; i < 40; i++) mash.keyDown(i * 30); // mashing: many keys down at once, released later
  for (let i = 0; i < 40; i++) mash.keyUp(1_300 + i * 30);
  const m = verdict(mash.now()!);
  check("mashing many keys at once: not counted", !m.counted, m.counted ? "counted" : m.why);
}

// A day
{
  const pool = new DayPool();
  for (const b of bursts(prose(7, 200))) pool.add(b);
  const small = pool.summary();
  check("under 300 counted presses: the day has no typing value", small.presses < MIN_DAY_PRESSES && small.spreadMs === null && small.holdMs === null, `${small.presses} presses`);
  for (const b of bursts(prose(8, 200))) pool.add(b);
  for (const b of bursts(game(3))) pool.add(b);
  for (const b of bursts(shortcuts(3))) pool.add(b);
  const day = pool.summary();
  check("pooled over the day's counted bursts only", day.presses === 400 && day.bursts >= 2 && day.spreadMs !== null && day.holdMs !== null, `${day.presses} presses, ${day.bursts} bursts`);
  const all = [...bursts(prose(7, 200)), ...bursts(prose(8, 200))].filter((b) => verdict(b).counted);
  const direct = numbers(all.flatMap((b) => b.motorGaps), all.flatMap((b) => b.holds), all.reduce((a, b) => a + b.thinking, 0), 400);
  check("pooling equals the numbers over all the day's gaps and holds", close(day.spreadMs, direct.spreadMs!) && close(day.holdMs, direct.holdMs!));
}

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("all passed");
