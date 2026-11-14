/*
  Drives the two phone pages through the whole story in a headless browser (never on screen).

    node scripts/drive-pages.mjs [baseUrl] [screenshotDir]

  Needs the service running (pnpm dev) and a Chromium headless shell for playwright-core
  (npx playwright-core install chromium-headless-shell). Asserts on every screen that the page
  does not scroll at 390 x 844 (documentElement.scrollHeight <= innerHeight) and that every
  enabled button and link has cursor: pointer.
*/
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";

const BASE = (process.argv[2] ?? "http://localhost:3480").replace(/\/+$/, "");
const SHOTS = process.argv[3] ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? `: ${detail}` : ""}`);
};

const errors = [];
let shot = 0;

async function screen(page, label) {
  const m = await page.evaluate(() => {
    const clickable = [...document.querySelectorAll("button:not(:disabled), a[href]")].filter((el) => el.offsetParent !== null);
    const notPointer = clickable.filter((el) => getComputedStyle(el).cursor !== "pointer").map((el) => el.textContent.trim());
    return { sh: document.documentElement.scrollHeight, ih: window.innerHeight, sw: document.documentElement.scrollWidth, iw: window.innerWidth, notPointer };
  });
  check(`${label}: no page scroll (${m.sh} <= ${m.ih})`, m.sh <= m.ih && m.sw <= m.iw, JSON.stringify(m));
  check(`${label}: everything clickable has cursor: pointer`, m.notPointer.length === 0, m.notPointer.join(", "));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${String(++shot).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-")}.png` });
}

const heading = (page) => page.locator("h1").first().innerText();
const waitHeading = (page, text, timeout = 6000) => page.locator("h1", { hasText: text }).first().waitFor({ timeout });

const browser = await chromium.launch({ headless: true });
try {
  const viewport = { width: 390, height: 844 };
  const trustedCtx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const userCtx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const t = await trustedCtx.newPage();
  const u = await userCtx.newPage();
  for (const [who, p] of [["trusted", t], ["person", u]]) {
    p.on("console", (msg) => msg.type() === "error" && errors.push(`${who}: ${msg.text()}`));
    p.on("pageerror", (e) => errors.push(`${who}: ${e.message}`));
  }

  // The front page.
  await t.goto(BASE + "/");
  await waitHeading(t, "A few kind words");
  await screen(t, "front page");

  const created = await (await fetch(BASE + "/api/pairs", { method: "POST", headers: { "X-Forwarded-For": "10.9.9.9" } })).json();

  // Trusted person: step 1, the name.
  await t.goto(created.inviteUrl);
  await waitHeading(t, "What should they call you?");
  check("trusted: invite moved out of the address", !new URL(t.url()).search, t.url());
  check(
    "trusted: invite kept in this phone's storage",
    (await t.evaluate((k) => localStorage.getItem(k), `cheerpressure.phone.trusted.${created.pair}.invite`)) === created.inviteToken,
  );
  await screen(t, "trusted name step");
  await t.getByLabel("First name").fill("Anna");
  await t.getByRole("button", { name: "Continue" }).click();
  await waitHeading(t, "Hi Anna");
  check("trusted: home says there is no request yet", await t.getByText("No requests right now").isVisible());
  await screen(t, "trusted home, no request");

  // The help sheet.
  await t.getByRole("button", { name: "Need help now?" }).click();
  const dialog = t.locator("dialog[open]");
  await dialog.waitFor();
  check("help: shows 112 and the clinic placeholder", (await dialog.getByRole("link", { name: "Call 112" }).getAttribute("href")) === "tel:112" && (await dialog.getByText("Placeholder: the clinic").isVisible()));
  await screen(t, "help sheet");
  await dialog.getByRole("button", { name: "Close" }).click();

  // The person's phone.
  await u.goto(created.userUrl);
  await waitHeading(u, "Nothing new yet");
  check("person: token moved out of the address", !new URL(u.url()).search, u.url());
  await screen(u, "person, nothing yet");
  await u.getByRole("button", { name: "Ask to talk or meet up" }).click();
  await waitHeading(u, "Ask Anna to talk or meet up?");
  await screen(u, "person, ask confirm");
  await u.getByRole("button", { name: "Send", exact: true }).click();
  await waitHeading(u, "Nothing new yet");
  const askLine = u.getByText(/You asked to talk or meet up/);
  check("person: the request shows at once with its status", await askLine.isVisible());
  await u.getByText(/You asked to talk or meet up .*Sent/).waitFor({ timeout: 4000 });
  check("person: the request becomes Sent", true);
  await screen(u, "person, request sent");

  // Trusted sees the request, sends a question.
  await t.getByText("They would like to talk or meet up").waitFor({ timeout: 5000 });
  check("trusted: sees the request within a poll or two", true);
  await screen(t, "trusted home, request");
  await t.getByRole("button", { name: "Send a few words" }).click();
  await waitHeading(t, "Send a few words");
  await screen(t, "trusted send");
  const t0 = Date.now();
  await t.getByRole("button", { name: "Walk after lunch?" }).click();
  await t.locator(".card .text", { hasText: "Walk after lunch?" }).waitFor({ timeout: 1000 });
  check(`trusted: the message shows at once after the tap (${Date.now() - t0} ms)`, Date.now() - t0 < 500);
  await waitHeading(t, "Their answer shows up here", 4000);
  check("trusted: status moves to Sent", (await t.locator(".status").innerText()) === "Sent");
  await screen(t, "trusted waiting");

  // The person answers yes.
  await waitHeading(u, "Anna asks");
  check("person: sees the question", await u.getByText("Walk after lunch?").isVisible());
  await screen(u, "person, question");
  await u.getByRole("button", { name: "Yes", exact: true }).click();
  check("person: the answer shows at once", await u.getByText(/You said yes/).isVisible());
  await u.getByText(/You said yes\. Sent/).waitFor({ timeout: 4000 });
  await screen(u, "person, answered");

  // Trusted sees it.
  await waitHeading(t, "They said yes", 5000);
  check("trusted: sees They said yes", true);
  await screen(t, "trusted, they said yes");
  await t.getByRole("button", { name: "Done" }).click();
  await waitHeading(t, "Hi Anna");
  check("trusted: the request is no longer open after sending", !(await t.getByText("They would like to talk or meet up").isVisible()));

  // Offline: send while the network is down, then come back.
  await trustedCtx.setOffline(true);
  await t.getByRole("button", { name: "Send a few words" }).click();
  await t.getByRole("button", { name: "Thinking of you" }).click();
  await t.locator(".card .text", { hasText: "Thinking of you" }).waitFor({ timeout: 1000 });
  check("offline: the message shows at once as Sending", (await t.locator(".status").innerText()) === "Sending");
  await t.getByText("You're offline").waitFor({ timeout: 8000 });
  check("offline: a short offline line instead of an error", true);
  await t.locator(".status", { hasText: "Waiting for connection" }).waitFor({ timeout: 10000 });
  check("offline: status becomes waiting for connection", true);
  await screen(t, "trusted offline waiting");
  await trustedCtx.setOffline(false);
  await t.locator(".status", { hasText: "Sent" }).waitFor({ timeout: 8000 });
  check("offline: sent once the network is back", true);
  await waitHeading(u, "From Anna", 5000);
  check("person: the greeting arrived exactly once", (await u.locator(".card .text").allInnerTexts()).join("|") === "Thinking of you");
  await screen(u, "person, greeting");

  // The person writes a short reply.
  await u.getByRole("button", { name: "Write a short reply" }).click();
  await waitHeading(u, "A short reply to Anna");
  await screen(u, "person reply step");
  await u.getByLabel("Your reply").fill("Thank you, that made my day");
  await u.getByRole("button", { name: "Send", exact: true }).click();
  await u.getByText(/You replied: Thank you, that made my day\. Sent/).waitFor({ timeout: 4000 });
  check("person: the reply is sent", true);
  await waitHeading(t, "They wrote back", 5000);
  check("trusted: sees the written reply", await t.getByText("Thank you, that made my day").isVisible());
  await screen(t, "trusted, they wrote back");

  // Reload with the service unreachable: the last known state comes from the cache.
  await t.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await t.reload();
  await waitHeading(t, "They wrote back", 3000);
  check("cache: after a reload without the service, the last state renders from the phone", await t.getByText("Thank you, that made my day").isVisible());
  await t.getByText("You're offline").waitFor({ timeout: 6000 });
  check("cache: and says it is offline", true);
  await screen(t, "trusted reload without service");
  await t.unroute("**/api/**");

  // Laptop width.
  await u.setViewportSize({ width: 1366, height: 768 });
  await screen(u, "person at 1366x768");

  // The pair is deleted: both pages say it has ended.
  await fetch(`${BASE}/api/pairs/${created.pair}`, { method: "DELETE", headers: { Authorization: `Bearer ${created.userToken}` } });
  await waitHeading(u, "This link has ended", 6000);
  check("ended: the person's page says the link has ended", true);
  await screen(u, "person, ended");

  const real = errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|net::ERR/.test(e));
  check("no console errors (other than the offline steps)", real.length === 0, real.join(" | "));
  void heading;
} catch (e) {
  check("no unexpected error", false, e instanceof Error ? e.message.split("\n")[0] : String(e));
} finally {
  await browser.close();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
