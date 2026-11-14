// Headless check that every screen fits one view: no page scroll either way, at most
// one primary action, at most four groups, no console errors. Walks the three places
// (home, the conversation with its ladder, settings) and the demo area, at three sizes,
// and the screens for someone you trust against a small fake messages service (answered in
// the browser, so no service needs to run).
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

/** A fake messages service on http://localhost:3480, answered inside the browser context. */
async function fakeService(context) {
  const state = { trustedName: null, events: [], n: 0 };
  const PAIR = "ABC234";
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" };
  const reply = (route, status, body) => route.fulfill({ status, headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const event = (fields) => ({ v: 1, id: `evt${String(++state.n).padStart(6, "0")}`, ts: new Date().toISOString(), pair: PAIR, ...fields });
  await context.route("http://localhost:3480/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (url.pathname === "/api/pairs" && req.method() === "POST") {
      return reply(route, 201, { pair: PAIR, userToken: "u".repeat(43), inviteToken: "i".repeat(43), inviteUrl: `http://localhost:3480/t/${PAIR}?i=${"i".repeat(43)}`, userUrl: `http://localhost:3480/u/${PAIR}?u=${"u".repeat(43)}`, expiresAt: new Date(Date.now() + 172800000).toISOString() });
    }
    if (url.pathname === `/api/pairs/${PAIR}/events` && req.method() === "GET") {
      return reply(route, 200, { events: state.events, role: "user", trustedName: state.trustedName, serverTime: new Date().toISOString(), expiresAt: new Date(Date.now() + 172800000).toISOString() });
    }
    if (url.pathname === `/api/pairs/${PAIR}/events` && req.method() === "POST") {
      const d = JSON.parse(req.postData() ?? "{}");
      const e = event({ ...d, from: { role: "user" } });
      state.events.push(e);
      return reply(route, 201, { event: e });
    }
    if (url.pathname === `/api/pairs/${PAIR}` && req.method() === "DELETE") {
      state.events = [];
      state.trustedName = null;
      return reply(route, 200, {});
    }
    return reply(route, 404, { error: "not found" });
  });
  return {
    join: (name) => (state.trustedName = name),
    greet: (text, kind = "question") => state.events.push(event({ type: "greeting", clientId: `g${state.n}abcdefgh`, from: { role: "trusted", name: state.trustedName }, text, kind, replyTo: null })),
  };
}

async function run(size) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: size });
  const service = await fakeService(context);
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
          JSON.stringify({ version: 1, profile, daily: [], weekly: [], reaction: [], typingSessions: [], activityDays: [], checkIns: [], settings: { muted: true, quietHours: { from: "03:00", to: "03:01" }, dailyQuestion: { every: "off", when: "midday" }, ...settings } }),
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
  await page.waitForURL("**/values/");
  await page.waitForTimeout(300);
  await measure(page, "values-learning");
  await go("/");
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
  // The box: real writing counts, a held key does not.
  await page.locator("#typing-box").click();
  await page.keyboard.type("we walked to the harbour and back before lunch", { delay: 120 });
  await page.waitForTimeout(700);
  const writing = await page.locator(".burst-state").innerText();
  await measure(page, "live-counting");
  await page.waitForTimeout(2600);
  for (let i = 0; i < 30; i++) await page.keyboard.down("k");
  await page.keyboard.up("k");
  await page.waitForTimeout(700);
  const held = await page.locator(".burst-state").innerText();
  await measure(page, "live-held-key");
  results.push({ ok: writing.startsWith("Counting") && held.includes("held keys"), name: `live box: "${writing}" then "${held}"`, vp: `${size.width}x${size.height}`, overY: 0, overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0 });

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
  await click("Show me what they would get");
  await page.waitForURL("**/share/**");
  await page.waitForTimeout(400);
  await measure(page, "step3-share");
  await click("Approve for the demo clinic");
  await measure(page, "step3-approved");
  // My values on made-up data, one source per view, and the clinic report.
  await go("/values/");
  await measure(page, "values-summary");
  await click("See each source");
  await measure(page, "values-typing");
  await click("Next");
  await measure(page, "values-day-and-night");
  await go("/share/");
  for (let i = 0; i < 5; i++) {
    await measure(page, `share-part-${i + 1}`);
    if (i < 4) await page.locator(".pager").getByRole("button", { name: "Next" }).click();
    await page.waitForTimeout(150);
  }
  // The printed report: only the report, on A4.
  await page.emulateMedia({ media: "print" });
  const print = await page.evaluate(() => ({
    report: getComputedStyle(document.querySelector(".print-report")).display,
    app: getComputedStyle(document.querySelector(".screen")).display,
    header: getComputedStyle(document.querySelector(".shell-header")).display,
  }));
  await page.emulateMedia({ media: "screen" });
  let pages = 0;
  if (size.width === 1366) {
    const pdf = await page.pdf({ format: "A4", printBackground: false });
    pages = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    if (SHOTS) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path.join(SHOTS, "clinic-report.pdf"), pdf);
    }
  }
  results.push({
    ok: print.report === "block" && print.app === "none" && print.header === "none" && (size.width !== 1366 || pages === 1),
    name: `print: only the report${size.width === 1366 ? `, ${pages} A4 page` : ""}`,
    vp: `${size.width}x${size.height}`, overY: 0, overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0,
  });
  await go("/demo/clinic/");
  await measure(page, "demo-what-a-clinic-could-see");
  await go("/weekly/");
  await measure(page, "weekly");

  // Someone you trust: invite, connected, own phone, disconnect, the service address.
  await go("/demo/");
  await click("Messages service");
  await measure(page, "demo-service-address");
  await go("/settings/#trust");
  await click("Invite someone");
  await page.locator(".qr img").waitFor({ timeout: 5000 });
  await measure(page, "trust-invite-waiting");
  service.join("Sara");
  await page.getByText("Connected with Sara").waitFor({ timeout: 5000 });
  await measure(page, "trust-connected");
  await click("Your own phone");
  await page.locator(".qr img").waitFor({ timeout: 5000 });
  await measure(page, "trust-own-phone");
  await click("Back");
  await click("Disconnect");
  await measure(page, "trust-disconnect-confirm");
  await click("Keep the connection");

  // A greeting at any time: home, writing back, and the help card after crisis words.
  service.greet("Walk after lunch?");
  await go("/");
  await page.locator(".greeting-line").waitFor({ timeout: 5000 });
  await measure(page, "home-greeting");
  await click("Write back");
  await measure(page, "home-write-back");
  await page.fill("#reply-text", "I want to die");
  await click("Send to Sara");
  await measure(page, "home-reply-crisis-card");
  const card = await page.locator(".crisis-card").count();
  results.push({ ok: card === 1, name: "crisis words in a reply show the help card", vp: `${size.width}x${size.height}`, overY: 0, overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0 });
  await click("Back to home");
  service.greet("Thinking of you", "greeting");
  await go("/");
  await page.locator(".greeting-line").waitFor({ timeout: 5000 });
  await measure(page, "home-greeting-thanks");
  await click("Thank you");
  await measure(page, "home-after-answer");

  // Step two with a real pair: the request, the reply, the answer.
  await go("/prompt/");
  await click("I'd like someone to check in on me");
  await click("Yes");
  await page.locator(".request-status").waitFor({ timeout: 5000 });
  await measure(page, "step2-real-sent");
  service.greet("Call tonight?");
  await page.locator(".greeting-line").waitFor({ timeout: 5000 });
  await measure(page, "step2-real-reply");
  await click("Yes");
  await measure(page, "step2-real-answered");
  await go("/settings/#trust");
  await click("Disconnect");
  await click("Yes, disconnect");
  await page.getByText("Not connected").waitFor({ timeout: 5000 });

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

  // The daily question at a fixed time of day, on home and in the mascot window.
  {
    const ctx = await browser.newContext({ viewport: size });
    await ctx.clock.setFixedTime(new Date("2026-11-14T13:05:00"));
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(`${size.width}: ${String(e).slice(0, 160)}`));
    await p.goto(BASE + "/setup/");
    await p.evaluate((profile) => localStorage.setItem("companion.v1", JSON.stringify({ version: 1, profile, settings: { muted: true, quietHours: { from: "22:00", to: "08:00" } } })), PROFILE);
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await p.waitForTimeout(300);
    const shown = await p.getByRole("heading", { name: "How are you today?" }).count();
    await measure(p, "home-daily-question");
    await p.getByRole("button", { name: "Not so good" }).click();
    await p.waitForTimeout(300);
    const after = await p.locator(".calm-line").innerText();
    await measure(p, "home-daily-not-so-good");
    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem("companion.v1")).dailyAnswers);
    results.push({ ok: shown === 1 && after.startsWith("Thanks for telling me") && stored.length === 1 && stored[0].answer === "not-so-good", name: "daily question: shown, answered, stored once", vp: `${size.width}x${size.height}`, overY: 0, overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0 });
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    results.push({ ok: (await p.getByRole("heading", { name: "How are you today?" }).count()) === 0, name: "daily question: not again the same day", vp: `${size.width}x${size.height}`, overY: 0, overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0 });
    if (size.width === 1366) {
      // The mascot window: small, then grown for the bubble.
      await p.evaluate(() => {
        const v = JSON.parse(localStorage.getItem("companion.v1"));
        v.dailyAnswers = [];
        localStorage.setItem("companion.v1", JSON.stringify(v));
      });
      const m = await ctx.newPage();
      await m.setViewportSize({ width: 300, height: 300 });
      await m.goto(BASE + "/mascot/", { waitUntil: "networkidle" });
      await m.waitForTimeout(300);
      await measure(m, "mascot-daily-bubble");
      const bubble = await m.locator(".mascot-question").count();
      await m.getByRole("button", { name: "Good", exact: true }).click();
      await m.waitForTimeout(3000);
      await m.setViewportSize({ width: 160, height: 180 });
      await m.waitForTimeout(200);
      await measure(m, "mascot-after-answer");
      results.push({ ok: bubble === 1 && (await m.locator(".mascot-question").count()) === 0, name: "mascot: bubble, then gone after an answer", vp: "300x300", overY: 0, overX: 0, primaries: 0, groups: 0, mood: "-", size: 0, noPointer: 0 });
    }
    await ctx.close();
  }
  await go("/settings/#daily");
  await measure(page, "settings-daily");

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
