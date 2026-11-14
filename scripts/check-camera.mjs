// Headless check of "Camera, live" (/demo/camera/): movement, face and posture. Never uses a real camera: Chromium runs
// with --use-fake-device-for-media-stream, so the only camera it can open is its own generated
// test pattern.
//
//   node scripts/check-camera.mjs [static-dir | base-url] [screenshot-dir]
//
// Given a folder (default: out/, from `pnpm build`) it serves it itself on port 3473 and stops
// the server at the end. Checks:
//   1. the screen loads with no console errors, and loads nothing of MediaPipe until asked
//   2. it fits one view without scrolling at 1366x768, 390x844 and 520x820 (also with the
//      example running), with one primary action, at most four groups, pointer on clickables
//   3. "Play a recorded example" moves all three panels as the sequence dictates: the movement
//      bar and position changes, the face bar and smiling share, posture learning then readings
//   4. with the fake camera allowed: the library, wasm and both models load from the same
//      origin, it starts, analyses frames, says no one and no face is in view, and stop
//      releases the camera
//   5. with the camera refused: a calm message and nothing else offered
//   and: no request to any other origin, in any of it.
//
// Needs playwright-core and a Chromium (same lookup as scripts/check-fit.mjs).

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ARG = process.argv[2] ?? "out";
const SHOTS = process.argv[3] ?? null;
const PORT = 3473;
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
// The full Chromium, run headless: the headless shell has no camera support at all
// (getUserMedia answers NotSupportedError), not even the fake one.
function executablePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const cache = path.join(process.env.HOME, "Library/Caches/ms-playwright");
    const dirs = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) {
      const exe = path.join(cache, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
      if (existsSync(exe)) return exe;
    }
  } catch {
    // fall back to Playwright's own lookup
  }
  return undefined;
}

// --- a small static server for out/ -------------------------------------------------------
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".task": "application/octet-stream",
  ".txt": "text/plain",
  ".md": "text/plain",
};
const notFound = [];
function serve(dir) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) {
      notFound.push(url.pathname);
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

// --- checks -----------------------------------------------------------------------------
let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

const SIZES = [
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
  { width: 520, height: 820 },
];

async function measure(page) {
  return page.evaluate(() => {
    const se = document.scrollingElement;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && !el.closest("dialog:not([open])");
    };
    const screen = document.querySelector(".screen");
    return {
      overY: se.scrollHeight - window.innerHeight,
      overX: se.scrollWidth - window.innerWidth,
      primaries: [...document.querySelectorAll(".btn-primary")].filter(visible).map((b) => b.textContent.trim()),
      groups: screen ? screen.children.length : 0,
      noPointer: [...document.querySelectorAll("button:not(:disabled), a[href]")]
        .filter(visible)
        .filter((el) => getComputedStyle(el).cursor !== "pointer")
        .map((el) => el.textContent.trim()),
    };
  });
}

async function fits(page, label) {
  const m = await measure(page);
  check(
    `${label}: fits, one primary, at most four groups, pointer on clickables`,
    m.overY <= 0 && m.overX <= 0 && m.primaries.length <= 1 && m.groups <= 4 && m.noPointer.length === 0,
    `overflow ${m.overY}/${m.overX} px, primary ${JSON.stringify(m.primaries)}, ${m.groups} groups${m.noPointer.length ? `, no pointer: ${m.noPointer.join(", ")}` : ""}`,
  );
}

const read = (page) =>
  page.evaluate(() => ({
    meter: Number(document.querySelector('[data-meter="movement"]')?.getAttribute("data-value") ?? -1),
    face: Number(document.querySelector('[data-meter="face"]')?.getAttribute("data-value") ?? -1),
    faceLine: document.querySelector("[data-face]")?.getAttribute("data-face") ?? "",
    smiling: Number(document.querySelector("[data-smiling-share]")?.getAttribute("data-smiling-share") ?? -1),
    posture: document.querySelector("[data-posture]")?.getAttribute("data-posture") ?? "",
    relative: Number(document.querySelector("[data-relative]")?.getAttribute("data-relative") ?? NaN),
    shifts: Number(document.querySelector("[data-shifts]")?.getAttribute("data-shifts") ?? -1),
    phase: document.querySelector("[data-phase]")?.getAttribute("data-phase"),
    line: document.querySelector("p[data-phase]")?.textContent ?? "",
    frames: Number(document.querySelector("[data-frames]")?.getAttribute("data-frames") ?? 0),
    delegate: document.querySelector("[data-delegate]")?.getAttribute("data-delegate") ?? null,
    cameraOn: !!document.querySelector("[data-camera-on]"),
    exampleTag: [...document.querySelectorAll("[role=status]")].some((e) => e.textContent.includes("Example, not live")),
  }));

async function main() {
  let server = null;
  let base = ARG;
  if (!/^https?:/.test(ARG)) {
    if (!existsSync(path.join(ARG, "demo/camera/index.html"))) throw new Error(`${ARG}/demo/camera/index.html not found: run pnpm build first`);
    server = await serve(ARG);
    base = `http://localhost:${PORT}`;
  }
  const origin = new URL(base).origin;
  const URL_CAMERA = `${base}/demo/camera/`;
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: executablePath(),
    // The fake device replaces every real camera and microphone; no real device is opened.
    args: ["--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader"],
  });

  const foreign = [];
  const consoleErrors = [];
  const watch = (page, label) => {
    page.on("request", (r) => {
      const u = r.url();
      if (u.startsWith("data:") || u.startsWith("blob:")) return;
      if (new URL(u).origin !== origin) foreign.push(`${label}: ${u}`);
    });
    page.on("console", (m) => {
      // MediaPipe prints its own start-up notes to stderr, which the browser shows as errors
      // ("INFO: Created TensorFlow Lite XNNPACK delegate for CPU."). Those are not errors.
      if (m.type() === "error" && !/^INFO: /.test(m.text())) consoleErrors.push(`${label}: ${m.text()}`);
    });
    page.on("pageerror", (e) => consoleErrors.push(`${label}: ${e.message}`));
    page.on("response", (r) => {
      if (r.status() >= 400) consoleErrors.push(`${label}: ${r.status()} ${new URL(r.url()).pathname}`);
    });
  };

  try {
    // 1 and 2: load and fit, at three sizes, before and during the example.
    for (const size of SIZES) {
      const ctx = await browser.newContext({ viewport: size });
      const page = await ctx.newPage();
      const label = `${size.width}x${size.height}`;
      watch(page, label);
      const loaded = [];
      page.on("request", (r) => loaded.push(new URL(r.url()).pathname));
      await page.goto(URL_CAMERA, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Start the camera" }).waitFor();
      check(
        `${label}: nothing of MediaPipe loads before the camera is started`,
        !loaded.some((p) => p.startsWith("/vendor/") || p.startsWith("/models/")),
        loaded.filter((p) => p.startsWith("/vendor/") || p.startsWith("/models/")).join(", ") || "none",
      );
      const privacy = await page.getByText("The picture is worked out on this computer. Nothing is stored or sent.").isVisible();
      check(`${label}: the privacy line is under the button`, privacy);
      await fits(page, `${label} off`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `camera-off-${label}.png`) });
      await page.getByRole("button", { name: "Play a recorded example" }).click();
      await page.waitForTimeout(9000);
      await fits(page, `${label} example`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `camera-example-${label}.png`) });
      await ctx.close();
    }

    // 3: the whole example, at 1366x768.
    {
      const ctx = await browser.newContext({ viewport: SIZES[0] });
      const page = await ctx.newPage();
      watch(page, "example");
      await page.goto(URL_CAMERA, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Play a recorded example" }).click();
      const t0 = Date.now();
      const samples = [];
      while (Date.now() - t0 < 43000) {
        samples.push({ t: (Date.now() - t0) / 1000, ...(await read(page)) });
        await page.waitForTimeout(250);
      }
      const between = (a, b) => samples.filter((s) => s.t >= a && s.t < b);
      const maxMeter = (a, b) => Math.max(0, ...between(a, b).map((s) => s.meter));
      const shiftAt = (n) => samples.find((s) => s.shifts >= n)?.t ?? null;
      const end = samples[samples.length - 1];
      check("example: marked Example, not live while it plays", between(1, 40).every((s) => s.exampleTag));
      check("example: the meter is low while sitting still", maxMeter(1, 7.5) <= 10, `at most ${maxMeter(1, 7.5)}`);
      check("example: the meter moves with the quick lean", maxMeter(8, 11.5) >= 15, `up to ${maxMeter(8, 11.5)}`);
      check("example: the quick lean is not counted", between(8, 19).every((s) => s.shifts === 0));
      check("example: first change once the lean is held", shiftAt(1) !== null && shiftAt(1) > 19 && shiftAt(1) < 24, `at ${shiftAt(1)?.toFixed(1)} s`);
      check("example: second change once the new place is held", shiftAt(2) !== null && shiftAt(2) > 28 && shiftAt(2) < 34, `at ${shiftAt(2)?.toFixed(1)} s`);
      check("example: two changes in the end, as the sequence says", end.shifts === 2, `${end.shifts}`);
      check("example: says it has finished", /whole example/.test(end.line), end.line);
      const maxFace = (a, b) => Math.max(0, ...between(a, b).map((s) => s.face));
      check("example: the face bar settles once the face is still", maxFace(20, 30) <= 10, `at most ${maxFace(20, 30)} from 20 to 30 s`);
      check("example: the face bar moves while talking", maxFace(11.5, 16) >= 40, `up to ${maxFace(11.5, 16)}`);
      const smileAt7 = between(6.5, 7.5)[0]?.smiling ?? -1;
      check("example: smiling share after the first smile", smileAt7 >= 35 && smileAt7 <= 60, `${smileAt7}% at 7 s`);
      check("example: smiling share at the end", end.smiling >= 8 && end.smiling <= 16, `${end.smiling}%`);
      check("example: posture learns first", between(1, 7.5).every((s) => s.posture === "learning"), [...new Set(between(1, 7.5).map((s) => s.posture))].join(","));
      const slumped = between(25, 28);
      check("example: posture reads more slumped while leaning in", slumped.length > 0 && slumped.every((s) => s.posture === "slumped" && s.relative < 94), `${[...new Set(slumped.map((s) => `${s.posture} ${s.relative}`))].join(", ")}`);
      check("example: posture about the usual at the end", end.posture === "usual", `${end.posture} ${end.relative}`);
      await ctx.close();
    }

    // 4: the pipeline with the fake camera allowed.
    {
      const ctx = await browser.newContext({ viewport: SIZES[1] });
      await ctx.grantPermissions(["camera"], { origin });
      const page = await ctx.newPage();
      watch(page, "camera");
      const assets = new Map();
      page.on("response", (r) => {
        const p = new URL(r.url()).pathname;
        if (p.startsWith("/vendor/") || p.startsWith("/models/")) assets.set(p, { status: r.status(), origin: new URL(r.url()).origin });
      });
      const logs = [];
      page.on("console", (m) => logs.push(m.text()));
      await page.goto(URL_CAMERA, { waitUntil: "networkidle" });
      const t0 = Date.now();
      await page.getByRole("button", { name: "Start the camera" }).click();
      let s = await read(page);
      while (Date.now() - t0 < 90000 && s.phase === "starting") {
        await page.waitForTimeout(250);
        s = await read(page);
      }
      const startedIn = (Date.now() - t0) / 1000;
      check("camera: started", s.phase === "on", `phase ${s.phase} after ${startedIn.toFixed(1)} s: ${s.line}`);
      const label = await page.evaluate(() => document.querySelector("video[data-camera-video]")?.srcObject?.getVideoTracks()[0]?.label ?? "");
      check("camera: it is Chromium's fake camera, not a real one", /^fake_device/.test(label), label || "no track");
      const want = [
        "/vendor/mediapipe/vision_bundle.mjs",
        "/vendor/mediapipe/wasm/vision_wasm_internal.js",
        "/vendor/mediapipe/wasm/vision_wasm_internal.wasm",
        "/models/pose_landmarker_lite.task",
        "/models/face_landmarker.task",
      ];
      for (const p of want) {
        const a = assets.get(p);
        check(`camera: ${p} from the app's own origin`, !!a && a.status === 200 && a.origin === origin, a ? `${a.status} ${a.origin}` : "not requested");
      }
      await page.waitForTimeout(6000);
      s = await read(page);
      check("camera: frames are analysed", s.frames >= 30, `${s.frames} frames in about 6 s, delegate ${s.delegate}`);
      check("camera: the test pattern is no one in frame", s.line === "No one in frame right now." && s.meter === 0 && s.shifts === 0, `"${s.line}", meter ${s.meter}, changes ${s.shifts}`);
      check("camera: the face panel says no face in view", s.faceLine === "No face in view" && s.face === 0, `"${s.faceLine}", bar ${s.face}`);
      check("camera: the posture panel says no one in frame", s.posture === "absent", s.posture);
      check("camera: Camera on is shown", s.cameraOn);
      await fits(page, "390x844 camera on");
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "camera-on-390x844.png") });
      // The tracks must end on stop: look at them from the page's side.
      await page.evaluate(() => {
        const v = document.querySelector("video[data-camera-video]");
        window.__tracks = v?.srcObject ? v.srcObject.getTracks() : [];
      });
      await page.getByRole("button", { name: "Stop the camera" }).click();
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => ({
        tracks: (window.__tracks ?? []).map((t) => t.readyState),
        src: document.querySelector("video[data-camera-video]")?.srcObject ?? null,
      }));
      s = await read(page);
      check(
        "camera: stop releases the camera",
        s.phase === "off" && !s.cameraOn && after.src === null && after.tracks.length > 0 && after.tracks.every((x) => x === "ended"),
        `phase ${s.phase}, tracks ${JSON.stringify(after.tracks)}`,
      );
      const mpLogs = logs.filter((l) => /webgl|gpu|delegate|xnnpack|tflite/i.test(l)).slice(0, 3);
      if (mpLogs.length) console.log(`      (MediaPipe said: ${mpLogs.map((l) => l.slice(0, 120)).join(" | ")})`);
      await ctx.close();
    }

    // 5: the camera refused.
    {
      const ctx = await browser.newContext({ viewport: SIZES[1] });
      // No permission granted: headless refuses the prompt.
      const page = await ctx.newPage();
      watch(page, "refused");
      await page.goto(URL_CAMERA, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Start the camera" }).click();
      let s = await read(page);
      const t0 = Date.now();
      while (Date.now() - t0 < 30000 && s.phase === "starting") {
        await page.waitForTimeout(200);
        s = await read(page);
      }
      const offered = await page.evaluate(() =>
        [...document.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim()),
      );
      check("refused: says so calmly", s.phase === "denied" && /not allowed/.test(s.line), `${s.phase}: ${s.line}`);
      check("refused: offers nothing else", offered.length === 0, offered.join(", ") || "no buttons");
      await fits(page, "390x844 refused");
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "camera-refused-390x844.png") });
      await ctx.close();
    }
  } finally {
    await browser.close();
    if (server) await new Promise((r) => server.close(r));
  }

  check("no request to any other origin", foreign.length === 0, foreign.slice(0, 5).join(", ") || "none");
  // A refused camera is reported by the browser as an error only if the page logs it; the page does not.
  // The browser asks for /favicon.ico by itself (the app has an icon.svg instead); that 404 is
  // reported in the console but is not this screen's. Only when served by this script can it tell.
  const onlyFavicon = server && notFound.length > 0 && notFound.every((p) => p === "/favicon.ico");
  const errors = consoleErrors.filter((e) => !(onlyFavicon && /Failed to load resource: .*404/.test(e)));
  if (onlyFavicon) console.log("      (left out: the browser's own request for /favicon.ico, 404)");
  check("no console errors", errors.length === 0, errors.slice(0, 5).join(" | ") || "none");
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
