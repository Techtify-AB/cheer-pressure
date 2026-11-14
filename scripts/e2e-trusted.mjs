/*
  The whole chain with someone you trust, end to end, in a headless browser (never on screen).

    node scripts/e2e-trusted.mjs [--no-build] [screenshot-dir]

  It starts, and stops again when done:
  - the messages service from server/ on port 3480 (next dev), with a local stand-in for Redis
    over REST (server/scripts/fake-upstash.mjs, port 3489) so pairs survive a restart of the service;
  - the desktop app's static build (out/, built first unless --no-build) on port 3472.

  Then it plays the story with two browser contexts:
  1. The desktop page (1366 x 768) creates an invite under Settings, Someone you trust.
  2. A 390 x 844 "phone" opens the invite link, enters a first name and sends "Walk after lunch?".
  3. The desktop shows "Sara: Walk after lunch?" on home within 3 seconds, the companion is glad,
     the mascot page shows its cue, and the companion reads it aloud once (outside quiet hours).
  4. The desktop answers Yes; the phone shows "They said yes"; home goes back to its calm state.
  5. In quiet hours a second greeting still shows, and nothing is read aloud.
  6. With the service stopped, the desktop's request to get in touch shows "Waiting for
     connection", and after the service starts again it shows "Sent" and reaches the phone.

  Needs playwright-core (server/node_modules has it) and a Chromium headless shell
  (npx playwright-core install chromium-headless-shell).
*/
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const NO_BUILD = args.includes("--no-build");
const SHOTS = args.find((a) => !a.startsWith("--")) ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const SERVICE_PORT = 3480;
const STATIC_PORT = 3472;
const REDIS_PORT = 3489;
const SERVICE = `http://localhost:${SERVICE_PORT}`;
const APP = `http://localhost:${STATIC_PORT}`;

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Playwright --------------------------------------------------------------------------

const require = createRequire(import.meta.url);
function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_CORE, path.join(ROOT, "server/node_modules/playwright-core"), "playwright-core"].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch {
      // next
    }
  }
  throw new Error("playwright-core not found; run pnpm install in server/ or set PLAYWRIGHT_CORE");
}
function executablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const cache = path.join(process.env.HOME, "Library/Caches/ms-playwright");
    for (const d of readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
      const exe = path.join(cache, d, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
      if (existsSync(exe)) return exe;
    }
  } catch {
    // Playwright's own lookup
  }
  return undefined;
}

// --- Processes ---------------------------------------------------------------------------

const children = [];
function start(name, cmd, argv, opts) {
  const child = spawn(cmd, argv, { ...opts, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  child.log = () => log;
  child.label = name;
  children.push(child);
  return child;
}
function stop(child) {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      resolve();
    }
    setTimeout(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // gone
      }
    }, 4000);
  });
}
async function portFree(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(800) });
    return false;
  } catch {
    return true;
  }
}
async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return true;
    } catch {
      // not yet
    }
    await sleep(250);
  }
  return false;
}

const serviceEnv = {
  ...process.env,
  UPSTASH_REDIS_REST_URL: `http://localhost:${REDIS_PORT}`,
  UPSTASH_REDIS_REST_TOKEN: "local-test-token",
  ALLOWED_ORIGINS: APP,
  NEXT_TELEMETRY_DISABLED: "1",
};
const startService = () =>
  start("service", path.join(ROOT, "server/node_modules/.bin/next"), ["dev", "-H", "0.0.0.0", "-p", String(SERVICE_PORT)], {
    cwd: path.join(ROOT, "server"),
    env: serviceEnv,
  });

// A tiny static server for out/ (trailing-slash folders with index.html).
function serveStatic() {
  const base = path.join(ROOT, "out");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".txt": "text/plain", ".woff2": "font/woff2", ".ico": "image/x-icon" };
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, APP).pathname);
    let file = path.join(base, p);
    if (!file.startsWith(base)) return res.writeHead(403).end();
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
    if (!existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/html" });
      return res.end(existsSync(path.join(base, "404.html")) ? readFileSync(path.join(base, "404.html")) : "not found");
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(STATIC_PORT, () => resolve(server)));
}

// --- The story ---------------------------------------------------------------------------

const PROFILE = { createdAt: "2026-11-01T10:00:00.000Z", earlySigns: ["Going to bed later"] };
const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const NO_QUIET = { from: "03:00", to: "03:01" };
const quietNow = () => ({ from: hhmm(new Date(Date.now() - 3600_000)), to: hhmm(new Date(Date.now() + 3600_000)) });

// Read-aloud, observed: a stand-in on-device voice that records what would be spoken.
const SPEECH_STUB = () => {
  const spoken = [];
  window.__spoken = spoken;
  const voice = { localService: true, lang: "en-GB", default: true, name: "Test voice", voiceURI: "test" };
  const fake = {
    getVoices: () => [voice],
    speak: (u) => {
      spoken.push(u.text);
      setTimeout(() => u.onend?.(), 10);
    },
    cancel: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true });
  window.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
};

async function main() {
  for (const p of [SERVICE_PORT, STATIC_PORT, REDIS_PORT]) {
    if (!(await portFree(p))) throw new Error(`port ${p} is in use; stop what runs there first`);
  }
  if (!NO_BUILD) {
    console.log("building the static app (pnpm build)");
    execSync("pnpm build", { cwd: ROOT, stdio: "ignore" });
  }
  const redis = start("fake-upstash", process.execPath, [path.join(ROOT, "server/scripts/fake-upstash.mjs"), String(REDIS_PORT)], { cwd: path.join(ROOT, "server") });
  let service = startService();
  const staticServer = await serveStatic();
  check("messages service started", await waitFor(`${SERVICE}/`, 60_000));
  await waitFor(`http://localhost:${REDIS_PORT}/`, 5_000);

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, executablePath: executablePath() });
  const errors = [];
  const watch = (page, who) => {
    page.on("pageerror", (e) => errors.push(`${who}: ${String(e).slice(0, 200)}`));
    page.on("response", async (r) => {
      if (r.status() >= 400 && r.url().startsWith(SERVICE) && r.request().method() !== "OPTIONS") {
        const body = await r.text().catch(() => "");
        console.log(`  (${who}: ${r.request().method()} ${r.url().replace(/\?.*/, "")} answered ${r.status()} ${body.slice(0, 120)})`);
      }
    });
  };

  try {
    // 1. Desktop: invite someone.
    const desk = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    await desk.addInitScript(SPEECH_STUB);
    const d = await desk.newPage();
    watch(d, "desktop");
    await d.goto(`${APP}/setup/`);
    await d.evaluate(
      ([profile, quiet]) =>
        localStorage.setItem(
          "companion.v1",
          JSON.stringify({ version: 1, profile, daily: [], weekly: [], reaction: [], typingSessions: [], activityDays: [], checkIns: [], settings: { muted: false, quietHours: quiet, dailyQuestion: { every: "off", when: "midday" } } }),
        ),
      [PROFILE, NO_QUIET],
    );
    await d.goto(`${APP}/settings/#trust`, { waitUntil: "networkidle" });
    check("desktop: not connected at first", (await d.getByRole("status").innerText()).includes("Not connected"));
    await d.getByRole("button", { name: "Invite someone" }).click();
    const link = d.getByRole("textbox", { name: "Invite link for someone you trust" });
    await link.waitFor({ timeout: 10_000 });
    const inviteUrl = await link.inputValue();
    check("desktop: invite created, waiting for them", (await d.getByRole("status").innerText()).includes("waiting for them to open it"));
    check("desktop: the invite has a QR code made on this device", await d.locator(".qr img").getAttribute("src").then((s) => !!s?.startsWith("data:image/png")));
    check("desktop: the invite link points at the service", inviteUrl.startsWith(`${SERVICE}/t/`), inviteUrl.replace(/i=.*/, "i=..."));
    if (SHOTS) await d.screenshot({ path: `${SHOTS}/1-desktop-invite.png` });

    // 2. Phone: open the invite, give a name.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await phone.newPage();
    watch(p, "phone");
    await p.goto(inviteUrl, { waitUntil: "networkidle" });
    await p.fill("#name", "Sara");
    await p.getByRole("button", { name: "Continue" }).click();
    await p.getByRole("heading", { name: "Hi Sara" }).waitFor({ timeout: 10_000 });
    check("phone: joined as Sara", true);

    const connected = await d.getByText("Connected with Sara").waitFor({ timeout: 5_000 }).then(() => true, () => false);
    check("desktop: settings say Connected with Sara", connected);

    // 3. Phone sends "Walk after lunch?"; the desktop shows it on home within 3 seconds.
    await d.goto(`${APP}/`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Send a few words" }).click();
    const t0 = Date.now();
    await p.getByRole("button", { name: "Walk after lunch?" }).click();
    const shown = await d
      .locator(".greeting-line")
      .filter({ hasText: "Walk after lunch?" })
      .waitFor({ timeout: 3_000 })
      .then(() => true, () => false);
    const ms = Date.now() - t0;
    check("desktop: shows the greeting within 3 s", shown, `${ms} ms`);
    if (shown) {
      check("desktop: it reads Sara: Walk after lunch?", (await d.locator(".greeting-line").innerText()).replace(/\s+/g, " ").trim() === "Sara: Walk after lunch?");
      check("desktop: the companion is glad", (await d.locator('[data-state][role="img"]').first().getAttribute("data-state")) === "joy");
      check("desktop: one primary action, Yes", (await d.locator(".btn-primary:visible").allInnerTexts()).join("|") === "Yes");
      await sleep(300);
      const spoken = await d.evaluate(() => window.__spoken);
      check("desktop: read aloud once outside quiet hours", spoken.length === 1 && spoken[0] === "Sara says: Walk after lunch?", JSON.stringify(spoken));
      const m = await desk.newPage();
      await m.goto(`${APP}/mascot/`, { waitUntil: "networkidle" });
      const cue = await m.locator(".mascot-page[data-cue][data-greeting]").count();
      check("mascot: shows its cue and looks glad", cue === 1 && (await m.locator('[data-state][role="img"]').getAttribute("data-state")) === "joy");
      await m.close();
    }
    if (SHOTS) await d.screenshot({ path: `${SHOTS}/2-desktop-greeting.png` });

    // 4. Desktop answers Yes; the phone shows "They said yes"; home is calm again.
    await d.getByRole("button", { name: "Yes", exact: true }).click();
    const yes = await p.getByRole("heading", { name: "They said yes" }).waitFor({ timeout: 5_000 }).then(() => true, () => false);
    check("phone: shows They said yes", yes);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/3-phone-they-said-yes.png` });
    check("desktop: says Sent to Sara", await d.getByText("Sent to Sara.").waitFor({ timeout: 4_000 }).then(() => true, () => false));
    await d.getByRole("link", { name: "Talk to me" }).waitFor({ timeout: 8_000 });
    check("desktop: home is calm again, greeting gone", (await d.locator(".greeting-line").count()) === 0);
    await p.getByRole("button", { name: "Done" }).click();

    // 5. Quiet hours: the greeting still shows, nothing is read aloud.
    await d.evaluate((quiet) => {
      const v = JSON.parse(localStorage.getItem("companion.v1"));
      v.settings.quietHours = quiet;
      localStorage.setItem("companion.v1", JSON.stringify(v));
    }, quietNow());
    await d.reload({ waitUntil: "networkidle" });
    await d.locator("body").click({ position: { x: 5, y: 400 } });
    await p.getByRole("button", { name: "Send a few words" }).click();
    await p.getByRole("button", { name: "Thinking of you" }).click();
    const quietShown = await d.locator(".greeting-line").filter({ hasText: "Thinking of you" }).waitFor({ timeout: 4_000 }).then(() => true, () => false);
    await sleep(400);
    const spokenQuiet = await d.evaluate(() => window.__spoken);
    check("quiet hours: the greeting still shows", quietShown);
    check("quiet hours: nothing read aloud", spokenQuiet.length === 0, JSON.stringify(spokenQuiet));
    if (quietShown) {
      await d.getByRole("button", { name: "Thank you" }).click();
      check("phone: the thank-you arrives", await p.getByRole("heading", { name: "They wrote back" }).waitFor({ timeout: 5_000 }).then(() => true, () => false));
    }
    await p.getByRole("button", { name: "Done" }).click().catch(() => {});

    // 6. The service stops: the request waits, then goes when the service is back.
    await stop(service);
    check("service stopped", await portFree(SERVICE_PORT));
    await d.goto(`${APP}/prompt/`, { waitUntil: "domcontentloaded" });
    await d.getByRole("button", { name: "I'd like someone to check in on me" }).click();
    await d.getByRole("button", { name: "Yes", exact: true }).click();
    const waiting = await d.locator(".request-status", { hasText: "Waiting for connection" }).waitFor({ timeout: 15_000 }).then(() => true, () => false);
    check("desktop: request shows Waiting for connection", waiting);
    if (!waiting) console.log("outbox:", await d.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("cheerpressure.messages.v1"))?.outbox)));
    if (SHOTS) await d.screenshot({ path: `${SHOTS}/4-desktop-waiting.png` });
    service = startService();
    check("service started again", await waitFor(`${SERVICE}/`, 60_000));
    const t1 = Date.now();
    const sent = await d.locator(".request-status", { hasText: /^Sent$/ }).waitFor({ timeout: 45_000 }).then(() => true, () => false);
    check("desktop: request delivered after the service returned", sent, `${Date.now() - t1} ms after it answered`);
    await p.reload({ waitUntil: "networkidle" });
    const asked = await p.getByText("They would like to talk or meet up").waitFor({ timeout: 8_000 }).then(() => true, () => false);
    check("phone: sees they asked to get in touch", asked);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/5-phone-asked.png` });

    // The reply to that request shows in the ladder, and Yes goes back.
    await p.getByRole("button", { name: "Send a few words" }).click();
    await p.getByRole("button", { name: "Call tonight?" }).click();
    const reply = await d.locator(".greeting-line").filter({ hasText: "Call tonight?" }).waitFor({ timeout: 4_000 }).then(() => true, () => false);
    check("desktop: the ladder shows the real reply", reply);
    if (reply) {
      await d.getByRole("button", { name: "Yes", exact: true }).click();
      check("phone: shows They said yes to the reply", await p.getByRole("heading", { name: "They said yes" }).waitFor({ timeout: 5_000 }).then(() => true, () => false));
    }

    // Disconnect: one confirmation, the pair is gone on the service and on this device.
    await d.goto(`${APP}/settings/#trust`, { waitUntil: "networkidle" });
    await d.getByRole("button", { name: "Disconnect" }).click();
    await d.getByRole("button", { name: "Yes, disconnect" }).click();
    await d.getByText("Not connected").waitFor({ timeout: 5_000 });
    const left = await d.evaluate(() => localStorage.getItem("cheerpressure.messages.v1"));
    check("disconnect: messages removed from this device", left === null);
    await p.reload({ waitUntil: "networkidle" });
    check("disconnect: the phone's link has ended", await p.getByRole("heading", { name: "This link has ended" }).waitFor({ timeout: 6_000 }).then(() => true, () => false));
  } finally {
    await browser.close();
    staticServer.close();
    await stop(service);
    await stop(redis);
  }
  for (const e of errors) console.log(`page error: ${e}`);
  console.log(`${passed} passed, ${failed} failed, ${errors.length} page errors`);
  process.exit(failed || errors.length ? 1 : 0);
}

const cleanup = async () => {
  for (const c of children) await stop(c);
};
process.on("SIGINT", () => cleanup().then(() => process.exit(130)));
main().catch(async (e) => {
  console.log(`FAIL ${e.message}`);
  for (const c of children) if (c.log) console.log(`--- ${c.label} log (tail)\n${c.log().slice(-1500)}`);
  await cleanup();
  process.exit(1);
});
