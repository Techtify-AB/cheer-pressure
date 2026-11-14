// Generated key moments for three kinds of input, used to choose and test the not-writing
// thresholds in lib/typing.ts (the Rust tests in src-tauri/src/rhythm.rs generate the same
// three kinds). Moments only: "down", "up", "repeat". Never keys.
//
//   npx tsx scripts/typing-samples.mts      prints how the three kinds separate
//
// - prose: one person writing, gaps around 150 to 220 ms with natural rollover, a few
//   thinking pauses of 1 to 2 s, now and then a held backspace that repeats;
// - game: movement keys held 0.3 to 1.5 s, two or three at once, with quick taps between,
//   with or without the keyboard's auto-repeat;
// - shortcuts: switching apps or stepping through a list, one press every 0.5 to 1.9 s.
import { BurstCollector, features, verdict, type Burst } from "../lib/typing.ts";

export type Moment = { t: number; kind: "down" | "up" | "repeat" };

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const normal = (r: () => number) => (r() + r() + r() + r() + r() + r() - 3) / Math.sqrt(0.5);

/** Repeats while a key is held: macOS starts after about 400 ms, then every 80 ms. */
function repeatsFor(down: number, hold: number, out: Moment[]) {
  for (let t = down + 400; t < down + hold; t += 80) out.push({ t, kind: "repeat" });
}

export function prose(seed: number, presses = 120): Moment[] {
  const r = rng(seed);
  const out: Moment[] = [];
  const typical = 150 + r() * 70;
  const holdMid = 80 + r() * 30;
  let t = 1000;
  for (let i = 0; i < presses; i++) {
    if (i > 0) {
      const thinking = r() < 0.04;
      t += thinking ? 1000 + r() * 950 : Math.min(950, typical * Math.exp(0.35 * normal(r)));
    }
    const heldBackspace = r() < 0.015;
    const hold = heldBackspace ? 600 + r() * 300 : Math.max(40, holdMid + 15 * normal(r));
    out.push({ t, kind: "down" }, { t: t + hold, kind: "up" });
    if (heldBackspace) repeatsFor(t, hold, out);
  }
  return out.sort((a, b) => a.t - b.t);
}

export function game(seed: number, presses = 80, withRepeats = true): Moment[] {
  const r = rng(seed);
  const out: Moment[] = [];
  let t = 1000;
  for (let i = 0; i < presses; i++) {
    t += 60 + r() * 260;
    const held = r() < 0.6;
    const hold = held ? 300 + r() * 1200 : 60 + r() * 60;
    out.push({ t, kind: "down" }, { t: t + hold, kind: "up" });
    if (held && withRepeats) repeatsFor(t, hold, out);
  }
  return out.sort((a, b) => a.t - b.t);
}

export function shortcuts(seed: number, presses = 40): Moment[] {
  const r = rng(seed);
  const out: Moment[] = [];
  let t = 1000;
  for (let i = 0; i < presses; i++) {
    t += r() < 0.15 ? 120 + r() * 200 : 500 + r() * 1400;
    const hold = 60 + r() * 70;
    out.push({ t, kind: "down" }, { t: t + hold, kind: "up" });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Feeds moments to a collector and returns every burst, the last one closed too. */
export function bursts(moments: Moment[], kind: Burst["kind"] = "writing"): Burst[] {
  const c = new BurstCollector(() => kind);
  const out: Burst[] = [];
  for (const m of moments) {
    if (m.kind === "up") c.keyUp(m.t);
    else {
      const ended = c.keyDown(m.t, m.kind === "repeat");
      if (ended) out.push(ended);
    }
  }
  const last = c.close();
  if (last) out.push(last);
  return out;
}

/** The longest burst of each sample: the one the checks are about. */
export const mainBurst = (m: Moment[], kind: Burst["kind"] = "writing") =>
  bursts(m, kind).sort((a, b) => b.presses - a.presses)[0];

if (process.argv[1]?.endsWith("typing-samples.mts")) {
  const N = 300;
  const kinds: [string, (s: number) => Moment[]][] = [
    ["prose", (s) => prose(s)],
    ["game with repeats", (s) => game(s, 80, true)],
    ["game without repeats", (s) => game(s, 80, false)],
    ["shortcuts", (s) => shortcuts(s)],
  ];
  const range = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
    return `${p(0).toFixed(2)} / ${p(0.5).toFixed(2)} / ${p(1).toFixed(2)}`;
  };
  console.log(`${N} samples of each kind; min / median / max of each feature, and how many count as writing`);
  for (const [name, gen] of kinds) {
    const bs = Array.from({ length: N }, (_, i) => mainBurst(gen(i + 1)));
    const f = bs.map(features);
    const counted = bs.filter((b) => verdict(b).counted).length;
    console.log(
      `${name.padEnd(22)} repeats ${range(f.map((x) => x.repeatShare))}  median hold ${range(f.map((x) => x.medianHold ?? 0))}  keys at once ${range(f.map((x) => x.chordShare))}  gaps under 1 s ${range(f.map((x) => x.motorShare))}  counted ${counted} of ${N}`,
    );
  }
}
