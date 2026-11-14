// Headless check that the product reads as four categories everywhere, not as a typing product
// or a flat list of measures. Walks every screen in three data states (empty, demo data, demo
// data with the camera and microphone switched on) and asserts from the rendered text:
//
// - where category names are listed, they come in the order Sleep, Energy, Social, Mood, and a
//   list with three or more of them has all four;
// - no screen's first measure line is a typing measure;
// - none of the banned leftover phrases (scripts/banned-phrases.json) appears, closed sheets
//   included;
// - every category view in My values and every panel in Live names every input its category
//   has (SOURCES in lib/passive.ts), with a state, never fewer.
//
// The camera and the microphone are never opened: getUserMedia is replaced before any page
// script runs, so "switched on" means only the setting.
//
//   npx tsx scripts/check-categories.mts [base-url]      (a static build served on 3472)

import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { todayKey } from "../lib/dates.ts";
import { makeDemoData } from "../lib/demo.ts";
import { SOURCES } from "../lib/passive.ts";

const BASE = process.argv[2] ?? "http://localhost:3472";
const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, "..");
const banned = JSON.parse(readFileSync(path.join(ROOT, "scripts/banned-phrases.json"), "utf8")) as { everywhere: string[]; rendered: string[] };
const PHRASES = [...banned.everywhere, ...banned.rendered];
const NAMES = SOURCES.map((c) => c.label);
const INPUTS = Object.fromEntries(SOURCES.map((c) => [c.id, c.inputs.map((i) => i.id)]));

function loadPlaywright() {
  for (const t of [process.env.PLAYWRIGHT_CORE, "playwright-core", path.join(execSync("npm root -g").toString().trim(), "@playwright/cli/node_modules/playwright-core")].filter(Boolean) as string[]) {
    try {
      return require(t);
    } catch {
      // try the next one
    }
  }
  throw new Error("playwright-core not found; set PLAYWRIGHT_CORE");
}
function executablePath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    const cache = path.join(process.env.HOME!, "Library/Caches/ms-playwright");
    for (const d of readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
      const exe = path.join(cache, d, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
      if (existsSync(exe)) return exe;
    }
  } catch {
    // Playwright's own lookup
  }
  return undefined;
}

const { chromium } = loadPlaywright();
const PROFILE = { createdAt: "2026-11-01T10:00:00.000Z", earlySigns: ["Going to bed later"] };
const BASE_SETTINGS = { muted: true, quietHours: { from: "03:00", to: "03:01" }, dailyQuestion: { every: "off", when: "midday" } };

type State = "empty" | "demo" | "demo+sensors";
function stored(state: State) {
  const today = todayKey();
  const demo = state === "empty" ? {} : makeDemoData(today, PROFILE.earlySigns);
  const sources = state === "demo+sensors" ? { typing: true, dayRhythm: true, camera: true, microphone: true, contact: true } : undefined;
  return { version: 1, profile: PROFILE, checkIns: [], ...demo, settings: { ...BASE_SETTINGS, ...(sources ? { sources } : {}) } };
}

const results: { ok: boolean; what: string; detail?: string }[] = [];
const check = (ok: boolean, what: string, detail?: string) => results.push({ ok, what, detail });

/**
 * What one rendered screen says, read in the page. Plain JavaScript in a string: tsx would add
 * helpers to a function that do not exist inside the page.
 */
const READ = `(names) => {
  const inHeader = (el) => !!el.closest(".shell-header");
  const own = (el) => (el.textContent || "").replace(/\\s+/g, " ").trim();
  const cats = [];
  for (const el of document.querySelectorAll("main *")) {
    if (inHeader(el) || el.children.length > 1) continue;
    const t = own(el);
    const name = names.find((n) => t === n || t.startsWith(n + ", ") || t.startsWith(n + " ("));
    if (name && (el.getClientRects().length || el.closest(".print-report"))) cats.push(name);
  }
  const lines = [...document.querySelectorAll(".strip-label, .value-input-name, .live-row-name, .live-typing, .noticing-value, .switch-label, .replay-strip-measure")]
    .filter((el) => el.getClientRects().length)
    .map(own)
    .filter(Boolean);
  const inputs = {};
  for (const box of document.querySelectorAll("[data-category]")) {
    if (!box.getClientRects().length) continue;
    const id = box.getAttribute("data-category");
    const found = [
      ...[...box.querySelectorAll("[data-input]")].map((x) => x.getAttribute("data-input")),
      ...[...box.querySelectorAll("[data-inputs]")].flatMap((x) => x.getAttribute("data-inputs").split(" ")),
    ];
    inputs[id] = [...(inputs[id] || []), ...found];
  }
  return { text: ((document.querySelector("main") || {}).textContent || "").replace(/\\s+/g, " "), cats, lines, inputs };
}`;

interface Reading {
  text: string;
  cats: string[];
  lines: string[];
  inputs: Record<string, string[]>;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Playwright page, loaded dynamically
async function read(page: any): Promise<Reading> {
  return page.evaluate(`(${READ})(${JSON.stringify(NAMES)})`);
}

function judge(where: string, r: Reading, seen?: Record<string, Set<string>>) {
  // Order: the names shown must follow Sleep, Energy, Social, Mood.
  const order = r.cats.map((c) => NAMES.indexOf(c));
  const inOrder = order.every((v, i) => i === 0 || v >= order[i - 1]);
  const distinct = [...new Set(r.cats)];
  if (distinct.length >= 2) check(inOrder && (distinct.length < 3 || distinct.length === 4), `${where}: categories in order`, r.cats.join(", "));
  // The first measure line is never typing.
  if (r.lines.length) check(!/^typing|^hold time|^thinking pauses/i.test(r.lines[0]), `${where}: first measure line is not typing`, r.lines[0]);
  // No leftover wording, sheets included.
  const lower = r.text.toLowerCase();
  const found = PHRASES.filter((p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower));
  check(found.length === 0, `${where}: no leftover phrases`, found.join(", "));
  if (seen) for (const [id, list] of Object.entries(r.inputs)) for (const x of list) (seen[id] ??= new Set()).add(x);
}

async function walk(state: State, size: { width: number; height: number }) {
  const browser = await chromium.launch({ headless: true, executablePath: executablePath() });
  const context = await browser.newContext({ viewport: size });
  // Never a real camera or microphone.
  await context.addInitScript(`
    if (navigator.mediaDevices) Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () => Promise.reject(new DOMException("blocked by the check", "NotAllowedError")),
    });
  `);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e: Error) => errors.push(String(e).slice(0, 160)));
  const tag = `${state} ${size.width}`;
  await page.goto(BASE + "/setup/");
  await page.evaluate(`localStorage.setItem("companion.v1", ${JSON.stringify(JSON.stringify(stored(state)))})`);
  const go = async (p: string) => {
    await page.goto(BASE + p, { waitUntil: "networkidle" });
    await page.waitForTimeout(350);
  };
  const next = async () => {
    const b = page.locator(".pager").getByRole("button", { name: "Next" });
    if (!(await b.count()) || !(await b.first().isVisible())) return false;
    await b.first().click();
    await page.waitForTimeout(200);
    return true;
  };

  for (const p of ["/", "/settings/", "/settings/#measure", "/settings/#data", "/settings/#daily", "/settings/#trust", "/settings/#voice", "/settings/#routines", "/settings/#look", "/demo/", "/demo/clinic/", "/help/", "/demo/replay/", "/demo/camera/", "/demo/voice/", "/weekly/", "/mascot/"]) {
    await go(p);
    judge(`${tag} ${p}`, await read(page));
  }
  for (const c of SOURCES) {
    await go(`/settings/#measure-${c.id}`);
    judge(`${tag} settings ${c.label}`, await read(page));
  }

  // My values: the summary, then every page of every category.
  await go("/values/");
  judge(`${tag} values summary`, await read(page));
  await page.getByRole("button", { name: "See each category" }).click();
  await page.waitForTimeout(300);
  const valuesSeen: Record<string, Set<string>> = {};
  for (let i = 0; i < 12; i++) {
    const h = await page.locator("h1").first().innerText();
    judge(`${tag} values ${h} (${i + 1})`, await read(page), valuesSeen);
    if (!(await next())) break;
  }
  for (const c of SOURCES) {
    const got = valuesSeen[c.id] ?? new Set();
    check(INPUTS[c.id].every((x) => got.has(x)), `${tag} values ${c.label}: every input shown`, `${[...got].join(" ")} of ${INPUTS[c.id].join(" ")}`);
  }

  // Live: every panel (paged on narrow windows).
  await go("/live/");
  const liveSeen: Record<string, Set<string>> = {};
  for (let i = 0; i < 4; i++) {
    judge(`${tag} live (${i + 1})`, await read(page), liveSeen);
    if (!(await next())) break;
  }
  for (const c of SOURCES) {
    const got = liveSeen[c.id] ?? new Set();
    check(INPUTS[c.id].every((x) => got.has(x)), `${tag} live ${c.label}: every input shown`, `${[...got].join(" ")} of ${INPUTS[c.id].join(" ")}`);
  }

  // The clinic report, part by part, and its print layout.
  await go("/share/");
  for (let i = 0; i < 9; i++) {
    judge(`${tag} share (${i + 1})`, await read(page));
    if (!(await next())) break;
  }

  if (state !== "empty") {
    // The conversation as it opens on a change, with its worked-out sheet.
    await page.evaluate(`(() => {
      const v = JSON.parse(localStorage.getItem("companion.v1"));
      v.settings.simulatedChangeAt = new Date().toISOString();
      localStorage.setItem("companion.v1", JSON.stringify(v));
    })()`);
    await go("/prompt/");
    judge(`${tag} conversation`, await read(page));
  }
  check(errors.length === 0, `${tag}: no page errors`, errors.join(" | "));
  await browser.close();
}

for (const state of ["empty", "demo", "demo+sensors"] as State[]) {
  for (const size of [
    { width: 1366, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await walk(state, size);
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of failed) console.log(`FAIL ${r.what}${r.detail ? `: ${r.detail}` : ""}`);
console.log(`${results.length - failed.length} of ${results.length} category checks ok`);
process.exit(failed.length ? 1 : 0);
