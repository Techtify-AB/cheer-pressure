// The camera wired into the app, headless, with Chromium's fake camera (no real camera is ever
// opened; the full Chromium is needed, the headless shell has no camera at all):
//
//   node scripts/check-camera-wiring.mjs [base-url]      (default http://localhost:3472, a static build)
//
// 1. Off by default: nothing asks for the camera and no "Camera on" sign.
// 2. Settings, What I measure: turning Movement (camera) on starts it; "Camera on" shows on
//    every screen, and in the mascot window (which reads the main window's heartbeat).
// 3. Pause everything stops it and the sign goes; turning it off stops it too.
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3472";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_CORE ?? path.resolve("server/node_modules/playwright-core"));

function executablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = path.join(process.env.HOME, "Library/Caches/ms-playwright");
  for (const d of readdirSync(cache).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
    const exe = path.join(cache, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(exe)) return exe;
  }
  return undefined;
}

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
};
const PROFILE = { createdAt: "2026-11-01T10:00:00.000Z", earlySigns: [] };

const browser = await chromium.launch({
  headless: true,
  executablePath: executablePath(),
  args: ["--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const origin = new URL(BASE).origin;
  await ctx.grantPermissions(["camera"], { origin });
  const page = await ctx.newPage();
  let mediaRequests = 0;
  await page.exposeFunction("__countMedia", () => mediaRequests++);
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (!md) return;
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = (c) => {
      window.__countMedia();
      return orig(c);
    };
  });
  await page.goto(`${BASE}/setup/`);
  await page.evaluate((profile) => localStorage.setItem("companion.v1", JSON.stringify({ version: 1, profile, settings: { muted: true, dailyQuestion: { every: "off", when: "midday" }, quietHours: { from: "03:00", to: "03:01" } } })), PROFILE);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  check("off by default: the camera is never asked for", mediaRequests === 0 && (await page.locator(".camera-on").count()) === 0);

  await page.goto(`${BASE}/settings/#measure`, { waitUntil: "networkidle" });
  await page.getByRole("switch", { name: /Movement \(camera\)/ }).click();
  const on = await page.locator(".shell-header .camera-on").waitFor({ timeout: 90_000 }).then(() => true, () => false);
  check("turned on: the camera is asked for once, and \"Camera on\" shows", on && mediaRequests === 1, `${mediaRequests} request(s)`);
  let everywhere = true;
  for (const p of ["/", "/values/", "/help/"]) {
    await page.getByRole("link", { name: p === "/" ? "Cheer Pressure" : p === "/help/" ? "Need help now?" : "Settings" }).first().click();
    await page.waitForTimeout(500);
    if (p === "/values/") await page.goto(`${BASE}/values/`, { waitUntil: "domcontentloaded" }).catch(() => {});
    const sign = await page.locator(".shell-header .camera-on").waitFor({ timeout: 90_000 }).then(() => true, () => false);
    everywhere &&= sign;
  }
  check("\"Camera on\" is on every screen while it runs", everywhere);

  const mascot = await ctx.newPage();
  await mascot.setViewportSize({ width: 160, height: 180 });
  await mascot.goto(`${BASE}/mascot/`, { waitUntil: "networkidle" });
  const mascotSign = await mascot.locator(".mascot-camera").waitFor({ timeout: 8_000 }).then(() => true, () => false);
  check("the mascot window shows \"Camera on\" too", mascotSign);

  await page.goto(`${BASE}/settings/#measure`, { waitUntil: "networkidle" });
  await page.locator(".shell-header .camera-on").waitFor({ timeout: 90_000 }).catch(() => {});
  await page.getByRole("button", { name: "Pause everything" }).click();
  const paused = await page.locator(".shell-header .camera-on").waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false);
  check("Pause everything stops it", paused);
  const mascotOff = await mascot.locator(".mascot-camera").waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false);
  check("and the mascot's sign goes", mascotOff);
  await page.getByRole("button", { name: "Resume measuring" }).click();
  await page.locator(".shell-header .camera-on").waitFor({ timeout: 90_000 }).catch(() => {});
  await page.getByRole("switch", { name: /Movement \(camera\)/ }).click();
  const offAgain = await page.locator(".shell-header .camera-on").waitFor({ state: "detached", timeout: 10_000 }).then(() => true, () => false);
  check("turning it off stops it", offAgain);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("companion.v1")).movementSessions ?? []);
  check("nothing but numbers would be stored (a short stretch with no one in frame stores nothing)", Array.isArray(stored) && stored.length === 0);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} failed` : "camera wiring: all passed");
process.exit(failed ? 1 : 0);
