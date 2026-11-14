// Headless check that every screen fits one view: no page scroll either way, at most
// one primary action, at most four groups, no console errors. Walks the three places
// (home, the conversation with its ladder, settings) and the demo area, at three sizes.
//
//   node scripts/check-fit.mjs [base-url] [screenshot-dir]
//
// Needs playwright-core and a Chromium it can launch. It is not a dependency of this
// repo: set PLAYWRIGHT_CORE to its folder, or have it installed globally.

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3472";
const SHOTS = process.argv[3] ?? null;
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const tries = [
    process.env.PLAYWRIGHT_CORE,
    "playwright-core",
    path.join(execSync("npm root -g").toString().trim(), "@playwright/cli/node_modules/playwright-core"),
  ].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch {
      // try the next one
    }
  }
  throw new Error("playwright-core not found; set PLAYWRIGHT_CORE");
}

const { chromium: pw } = loadPlaywright();
// Use the Chromium Playwright expects, or else any headless shell already downloaded.
function executablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const cache = path.join(process.env.HOME, "Library/Caches/ms-playwright");
    const dirs = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
    for (const d of dirs) {
      const exe = path.join(cache, d, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
      if (existsSync(exe)) return exe;
    }
  } catch {
    // fall back to Playwright's own lookup
  }
  return undefined;
}
const chromium = { launch: (o) => pw.launch({ ...o, executablePath: executablePath() }) };
const SIZES = [
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
  { width: 520, height: 820 },
];
const PROFILE = { createdAt: "2026-11-01T10:00:00.000Z", earlySigns: ["Going to bed later"] };

async function measure(page, name) {
  const m = await page.evaluate(() => {
    const se = document.scrollingElement;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && !el.closest("dialog:not([open])");
    };
    const screen = document.querySelector(".screen");
    const companion = document.querySelector('[data-state][role="img"]');
    return {
      overY: se.scrollHeight - window.innerHeight,
      overX: se.scrollWidth - window.innerWidth,
      primaries: [...document.querySelectorAll(".btn-primary")].filter(visible).length,
      groups: screen ? screen.children.length : 0,
      mood: companion?.getAttribute("data-state") ?? "-",
      size: companion ? Math.round(companion.getBoundingClientRect().width) : 0,
      noPointer: [...document.querySelectorAll("button:not(:disabled), a[href], [role=switch]:not(:disabled)")]
        .filter(visible)
        .filter((el) => getComputedStyle(el).cursor !== "pointer").length,
    };
  });
  const vp = page.viewportSize();
  const ok = m.overY <= 1 && m.overX <= 1 && m.primaries <= 1 && m.groups <= 4 && m.noPointer === 0;
  results.push({ ok, name, vp: `${vp.width}x${vp.height}`, ...m });
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${vp.width}-${name}.png`) });
  return m;
}

const results = [];
const errors = [];

async function run(size) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: size });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`${size.width}: ${msg.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => errors.push(`${size.width}: ${String(e).slice(0, 160)}`));
  const go = async (p) => {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
  };
  const click = async (text) => {
    // A row's name is its label and its one-line value, so match the start.
    const name = new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`);
    await page.getByRole("button", { name }).or(page.getByRole("link", { name })).first().click();
    await page.waitForTimeout(350);
  };
  const seed = async (settings = {}) => {
    await page.evaluate(
      ([profile, settings]) =>
        localStorage.setItem(
          "companion.v1",
          JSON.stringify({ version: 1, profile, daily: [], weekly: [], reaction: [], typingSessions: [], activityDays: [], checkIns: [], settings: { muted: true, quietHours: { from: "03:00", to: "03:01" }, ...settings } }),
        ),
      [PROFILE, settings],
    );
  };

  await go("/setup/");
  await measure(page, "setup");
  await seed();
  await go("/");
  await measure(page, "home");
  await page.locator(".noticing").click();
  await page.waitForTimeout(300);
  const sheet = await page.evaluate(() => {
    const d = document.querySelector("dialog[open]");
    return d ? { fits: d.scrollHeight <= d.clientHeight + 1 } : null;
  });
  results.push({ ok: !!sheet?.fits, name: "home sheet fits without scrolling", vp: `${size.width}x${size.height}`, overY: sheet ? (sheet.fits ? 0 : 1) : "no sheet", overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0 });
  await page.keyboard.press("Escape");
  await click("Talk to me");
  await measure(page, "talk-own-choice");

  for (const h of ["", "#measure", "#routines", "#voice", "#trust", "#data", "#delete"]) {
    await go(`/settings/${h}`);
    await measure(page, `settings${h.replace("#", "-")}`);
  }
  await go("/help/");
  await measure(page, "help");
  await go("/demo/");
  await measure(page, "demo");
  await go("/live/");
  await measure(page, "live");

  // The ladder, live: Simulate a change, Not my best, then skip ahead.
  await go("/demo/");
  await click("Simulate a change");
  await measure(page, "ask-explain");
  await click("Next");
  await measure(page, "ask-question");
  await click("Not my best");
  await measure(page, "step1-small-thing");
  await click("I'll try that");
  await measure(page, "step1-done");
  await go("/");
  await measure(page, "home-ladder-waiting");
  await go("/demo/");
  await click("Skip ahead two days");
  await measure(page, "step2-someone");
  await go("/");
  await measure(page, "home-step2-due");
  await go("/prompt/");
  await click("Yes");
  await page.waitForTimeout(4200);
  await measure(page, "step2-reply");
  await click("Yes");
  await measure(page, "step2-reply-yes");
  for (let i = 0; i < 3; i++) {
    await go("/demo/");
    await click("Skip ahead two days");
  }
  await measure(page, "step3-clinic");
  await click("Approve");
  await measure(page, "step3-approved");
  await go("/trends/");
  await measure(page, "trends");
  await go("/weekly/");
  await measure(page, "weekly");

  // Quiet hours now: the companion sleeps on home.
  const now = new Date();
  const hh = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  await seed({ quietHours: { from: hh(new Date(now.getTime() - 3600_000)), to: hh(new Date(now.getTime() + 3600_000)) } });
  await go("/");
  await measure(page, "home-quiet-hours");

  // The replay: start, middle, and the moment it asks.
  await seed();
  await go("/demo/replay/");
  await measure(page, "replay-start");
  const tPlay = Date.now();
  await click("Play");
  await page.waitForTimeout(9000);
  await measure(page, "replay-playing");
  await page.getByRole("button", { name: "See what it asks" }).waitFor({ timeout: 30000 });
  const tAsk = Date.now();
  await page.waitForFunction(() => !document.querySelector(".btn-primary")?.disabled);
  const stopText = await page.locator(".replay-day").innerText();
  const line = await page.locator(".replay-line").innerText();
  await measure(page, "replay-asks");
  results.push({ ok: true, name: `replay stopped at "${stopText.replace(/\s+/g, " ")}" ${((tAsk - tPlay) / 1000).toFixed(1)} s after Play`, vp: `${size.width}x${size.height}`, overY: 0, overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0 });
  await click("See what it asks");
  const promptLine = await page.locator(".bubble").first().innerText();
  results.push({ ok: promptLine.trim() === line.trim(), name: "replay explanation equals the conversation's", vp: `${size.width}x${size.height}`, overY: 0, overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0 });
  await measure(page, "replay-see-what-it-asks");

  await browser.close();

  // Reduced motion: the dots step without transitions.
  const b2 = await chromium.launch({ headless: true });
  const c2 = await b2.newContext({ viewport: size, reducedMotion: "reduce" });
  const p2 = await c2.newPage();
  await p2.goto(BASE + "/setup/");
  await p2.evaluate((profile) => localStorage.setItem("companion.v1", JSON.stringify({ version: 1, profile, settings: { muted: true } })), PROFILE);
  await p2.goto(BASE + "/demo/replay/", { waitUntil: "networkidle" });
  await p2.getByRole("button", { name: "Play", exact: true }).click();
  await p2.waitForTimeout(6000);
  const dur = await p2.evaluate(() => getComputedStyle(document.querySelector(".strip-dot")).transitionDuration);
  results.push({ ok: parseFloat(dur) < 0.02, name: `reduced motion: dot transition ${dur}`, vp: `${size.width}x${size.height}`, overY: 0, overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0 });
  await b2.close();
}

if (SHOTS) mkdirSync(SHOTS, { recursive: true });
for (const size of SIZES) await run(size);

for (const r of results) {
  console.log(
    `${r.ok ? "ok  " : "FAIL"} ${r.vp.padEnd(9)} ${r.name.padEnd(28)} overY=${r.overY} overX=${r.overX} primary=${r.primaries} groups=${r.groups} mood=${r.mood}${r.size ? `@${r.size}` : ""} noPointer=${r.noPointer}`,
  );
}
for (const e of errors) console.log(`console: ${e}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} of ${results.length} ok, ${errors.length} console errors`);
process.exit(failed || errors.length ? 1 : 0);
