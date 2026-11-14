// The activities ("something for you"): the pure parts, and a headless check in a browser.
//
//   npx tsx scripts/test-activities.mts                          unit tests
//   npx tsx scripts/test-activities.mts --browser <base-url>     headless check against a running app
//
// Unit: the timer's end-time logic (also "ran out while closed"), the memory game's rules and
// lock, the demo reply matching the draft, plan defaults and the single-meal case,
// activityForHelp, the "Did that help?" summary and order, the reaction check (too-early tap,
// median, comparison with the person's usual).
//
// Browser (needs playwright-core and a Chromium, like scripts/check-fit.mjs): at 390x844,
// 520x820 and 1366x768, every activity can be started, made easier, ended and opened again;
// "Did that help?" follows Done; no page scrolls; sound elements are paused and back at 0 after
// leaving a view; the timer is right after the page was hidden and the clock moved on, and
// shows the finish view when it ran out while the page was closed; the library works with
// every request to another origin blocked, and offline after it has loaded.

import { ACTIVITIES, ACTIVITY_IDS, activityForHelp, FOR_HELP, nextActivities } from "../lib/activities/index.ts";
import { activityHelpScore, activityHelpSentence, activityHelpStats, orderActivitiesByHelp } from "../lib/activities/feedback.ts";
import { flip, isWon, newRound, settle, shuffle, type GameState } from "../lib/activities/game.ts";
import { ATTENTION_GUIDE, holdFor, lineAt, PAUSE_AFTER_LINE_MS } from "../lib/activities/guide.ts";
import {
  arm,
  compareWithUsual,
  COMPARE_LINE,
  go,
  initialReaction,
  mayOfferReaction,
  median,
  ROUNDS,
  tap,
  waitMs,
} from "../lib/activities/reaction.ts";
import { askKind, demoReply, EASIER_DRAFT, walkDraft } from "../lib/activities/reply.ts";
import { formatClock, remainingMs, startTimer, timerPhase, timerProgress } from "../lib/activities/timer.ts";
import { DEMO_PLAN, mealActions, resolvePlan } from "../lib/plan.ts";
import { STARTING_HELPS } from "../lib/helps.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

/** A seeded random source, so the shuffles are repeatable. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function unit() {
  // --- Timer: the end time is the truth --------------------------------------------------
  const T0 = 1_700_000_000_000;
  const t = startTimer("outside", 5 * 60_000, T0);
  check("timer saves the end time", t.endsAt === T0 + 300_000 && t.startedAt === T0);
  check("remaining from the clock", remainingMs(t, T0 + 60_000) === 240_000);
  check("running before the end", timerPhase(t, "outside", T0 + 299_999) === "running");
  check("finished at the end", timerPhase(t, "outside", T0 + 300_000) === "finished");
  check("ran out while closed: finished, nothing left", timerPhase(t, "outside", T0 + 3_600_000) === "finished" && remainingMs(t, T0 + 3_600_000) === 0);
  check("another activity's timer counts as idle", timerPhase(t, "hobby", T0 + 10) === "idle");
  check("no timer is idle", timerPhase(null, "outside", T0) === "idle");
  // Hidden for two minutes: what is left is still worked out from the clock, not from ticks.
  check("after two minutes away: 3:00 left", formatClock(remainingMs(t, T0 + 120_000)) === "3:00");
  check("rounds up so it never shows 0:00 too early", formatClock(400) === "0:01" && formatClock(0) === "0:00");
  check("progress", timerProgress(t, T0 + 150_000) === 0.5 && timerProgress(t, T0 + 999_999) === 1);

  // --- The memory game --------------------------------------------------------------------
  const r = newRound(3, seeded(1));
  check("six cards, three pairs", r.cards.length === 6 && new Set(r.cards).size === 3 && r.cards.every((c) => r.cards.filter((x) => x === c).length === 2));
  check("easier: four cards, two pairs", newRound(2, seeded(1)).cards.length === 4 && new Set(newRound(2).cards).size === 2);
  const rounds = new Set(Array.from({ length: 20 }, (_, i) => newRound(3, seeded(i + 1)).cards.join(",")));
  check("shuffled every round", rounds.size > 5, `${rounds.size} different orders in 20 rounds`);
  check("shuffle keeps every card", shuffle([1, 2, 3, 4, 5], seeded(3)).sort().join() === "1,2,3,4,5");
  // A fixed layout to test the rules.
  const fixed: GameState = { cards: ["sun", "leaf", "sun", "wave", "leaf", "wave"], open: [], matched: [], locked: false, turns: 0 };
  let g = flip(fixed, 0);
  check("first card turns", g.open.join() === "0" && !g.locked);
  check("the same card again does nothing", flip(g, 0) === g);
  g = flip(g, 2);
  check("a pair stays open", g.matched.join() === "0,2" && g.open.length === 0 && !g.locked && g.turns === 1);
  g = flip(g, 1);
  g = flip(g, 3);
  check("two that do not match: shown and locked", g.open.join() === "1,3" && g.locked);
  check("locked: no card can be turned", flip(g, 4) === g && flip(g, 5) === g);
  check("a found card cannot be turned", flip(settle(g), 0).open.length === 0);
  g = settle(g);
  check("after the pause they turn back and it unlocks", g.open.length === 0 && !g.locked);
  check("settle does nothing when not locked", settle(g) === g);
  for (const [a, b] of [
    [1, 4],
    [3, 5],
  ]) g = flip(flip(g, a), b);
  check("all pairs found: won", isWon(g) && g.turns === 4);

  // --- The demo reply matches the draft -----------------------------------------------------
  check("walk draft gets a walk answer", demoReply(walkDraft("Alex")).kind === "walk" && demoReply(walkDraft("Alex")).text === "Yes, I can after lunch.");
  check("easier draft (talk) gets a talking answer", askKind(EASIER_DRAFT) === "talk" && /call|talk/i.test(demoReply(EASIER_DRAFT).text));
  check("a call is talking", askKind("Can you call me tonight?") === "talk");
  check("coffee is meeting", askKind("Coffee this afternoon?") === "meet");
  check("anything else gets a kind answer", askKind("Hello there") === "other" && demoReply("Hello there").text.length > 0);
  check("walk wins when both are asked", askKind("Want to walk and talk?") === "walk");

  // --- Plan defaults and the single-meal case -------------------------------------------------
  const d = resolvePlan(undefined);
  check("defaults: hobby", d.hobby.name === "Sketching" && d.hobby.smallestStep === "Get out paper and a pen.");
  check("defaults: meal with three steps", d.meal.steps.length === 3 && d.meal.smallest === "Get the banana");
  check("defaults: evening", d.eveningStep === DEMO_PLAN.eveningStep && d.eveningSmallest === "Put your phone on charge");
  check("defaults: after music, contact", d.firstStepAfterMusic === "Get out the sketchbook" && d.contact.name === "Alex");
  check("a trusted person's name is used when no contact is saved", resolvePlan(undefined, "Sam").contact.name === "Sam");
  check("a saved contact wins", resolvePlan({ contact: { name: "Kim" } }, "Sam").contact.name === "Kim");
  const single = resolvePlan({ meal: { name: "Porridge" } });
  check("only a meal name: one action, the name", mealActions(single).join() === "Porridge" && single.meal.smallest === "Porridge");
  check("a new meal never gets the demo's steps", single.meal.steps.length === 0);
  check("demo meal with its steps cleared is one action", mealActions(resolvePlan({ meal: { steps: [] } })).join() === DEMO_PLAN.meal.name);
  check("at most three meal steps", resolvePlan({ meal: { name: "Toast", steps: ["a", "b", "c", "d"] } }).meal.steps.length === 3);
  const knit = resolvePlan({ hobby: { name: "Knitting" } });
  check("a new hobby gets its own first step, not sketching's", !/paper/.test(knit.hobby.firstStep) && /knitting/.test(knit.hobby.firstStep));
  check("blank fields fall back", resolvePlan({ eveningStep: "   ", sound: "nope" }).eveningStep === DEMO_PLAN.eveningStep && resolvePlan({ sound: "nope" }).sound === DEMO_PLAN.sound);

  // --- activityForHelp --------------------------------------------------------------------
  const expected: Record<string, string> = { outdoors: "outside", music: "song", game: "game", light: "daylight", moving: "outside", making: "hobby", watching: "attention", talking: "ask" };
  check("every starting help has an activity", STARTING_HELPS.every((h) => activityForHelp(h.id) === expected[h.id]), JSON.stringify(FOR_HELP));
  check("own items by their words", activityForHelp("own-1", "Baking bread") === "eat" && activityForHelp("own-2", "Calling my sister") === "ask");
  check("nothing fits: null", activityForHelp("own-3", "Tax forms") === null);
  check("next activities skip the current one and repeats", nextActivities([{ id: "music", label: "Music", on: true }, { id: "outdoors", label: "x", on: true }, { id: "moving", label: "y", on: true }], ["song"]).join() === "outside,daylight");
  check("nine activities, one page each", ACTIVITIES.length === 9 && ACTIVITY_IDS.length === 9);

  // --- Did that help? -------------------------------------------------------------------
  const rec = (activity: string, feedback: "yes" | "a-little" | "no" | null) => ({ activity, feedback });
  const history = [rec("outside", "yes"), rec("outside", "yes"), rec("outside", "a-little"), rec("outside", "no"), rec("game", "no"), rec("song", null)];
  const st = activityHelpStats(history);
  check("counts done and answered", st.outside.done === 4 && st.outside.answered === 4 && st.song.done === 1 && st.song.answered === 0);
  check("yes counts 1, a little 0.5", st.outside.helped === 2.5);
  check("sentence", activityHelpSentence(st.outside) === "You've said a short walk helped 3 of 4 times.", activityHelpSentence(st.outside) ?? "");
  check("no history: no sentence", activityHelpSentence(undefined) === null);
  check("done but never answered", activityHelpSentence(st.song) === "You've done a song and a first step once before.");
  check("score: untried one half, helped above, not helped below", activityHelpScore(undefined) === 0.5 && activityHelpScore(st.outside) > 0.5 && activityHelpScore(st.game) < 0.5);
  const order = orderActivitiesByHelp(ACTIVITIES.map((a) => a.id), history);
  check("library order: helped first, untried next, not helped last", order[0] === "outside" && order[order.length - 1] === "game" && order[1] === "daylight", order.join(","));

  // --- The reaction check --------------------------------------------------------------------
  let s = initialReaction();
  s = tap(s, 0);
  check("first tap starts waiting", s.phase === "waiting");
  s = tap(s, 100);
  check("too early: discarded", s.phase === "early" && s.times.length === 0 && s.early === 1);
  s = arm(s);
  check("the round repeats", s.phase === "waiting" && s.times.length === 0);
  check("a change only comes while waiting", go(initialReaction(), 5).phase === "intro");
  for (let i = 0; i < ROUNDS; i++) {
    s = go(arm(s), 1000 * i);
    s = tap(s, 1000 * i + [300, 250, 400, 280, 320][i]);
  }
  check("five counted taps, then done", s.phase === "done" && s.times.join() === "300,250,400,280,320");
  check("median of five", median(s.times) === 300);
  check("median of an even list", median([200, 300]) === 250 && median([]) === 0);
  check("a tap when done does nothing", tap(s, 99_999) === s);
  const waits = Array.from({ length: 200 }, (_, i) => waitMs(seeded(i + 9)));
  check("each wait is 1 to 3 seconds", waits.every((w) => w >= 1000 && w <= 3000));
  check("fewer than five earlier: still learning", compareWithUsual(300, [300, 310, 290, 305]) === "learning" && COMPARE_LINE.learning === "Noted. I'm still learning your usual.");
  check("about the same", compareWithUsual(310, [300, 300, 300, 300, 300]) === "same");
  check("a little quicker", compareWithUsual(250, [300, 300, 300, 300, 300]) === "quicker");
  check("a little slower", compareWithUsual(360, [300, 300, 300, 300, 300]) === "slower");
  check("offered once a day", mayOfferReaction(undefined, "2026-11-14") && !mayOfferReaction("2026-11-14", "2026-11-14") && mayOfferReaction("2026-11-13", "2026-11-14"));

  // --- The guide -------------------------------------------------------------------------
  check("guide: line by time marker", lineAt(ATTENTION_GUIDE, 0) === 0 && lineAt(ATTENTION_GUIDE, 7) === 1 && lineAt(ATTENTION_GUIDE, 20) === 2);
  check("guide: waits for the marker", holdFor(ATTENTION_GUIDE, 0, 2000) === 6000);
  check("guide: never cuts speech short", holdFor(ATTENTION_GUIDE, 1, 12_000) === 12_000 + PAUSE_AFTER_LINE_MS);
}

// =============================================================================================
// The headless check
// =============================================================================================

async function browser(base: string) {
  const { createRequire } = await import("node:module");
  const { execSync } = await import("node:child_process");
  const { existsSync, readdirSync } = await import("node:fs");
  const path = await import("node:path");
  const require = createRequire(import.meta.url);
  let pw: typeof import("playwright-core") | null = null;
  for (const t of [process.env.PLAYWRIGHT_CORE, "playwright-core", path.join(execSync("npm root -g").toString().trim(), "@playwright/cli/node_modules/playwright-core")]) {
    if (!t) continue;
    try {
      pw = require(t);
      break;
    } catch {
      // next
    }
  }
  if (!pw) throw new Error("playwright-core not found; set PLAYWRIGHT_CORE");
  let exe: string | undefined = process.env.CHROMIUM_PATH;
  if (!exe) {
    const cache = path.join(process.env.HOME ?? "", "Library/Caches/ms-playwright");
    for (const dir of readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort().reverse()) {
      const p = path.join(cache, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
      if (existsSync(p)) {
        exe = p;
        break;
      }
    }
  }
  const b = await pw.chromium.launch({ headless: true, executablePath: exe, args: ["--autoplay-policy=no-user-gesture-required"] });
  const origin = new URL(base).origin;
  const PROFILE = JSON.stringify({
    version: 1,
    profile: { createdAt: "2026-11-01T10:00:00.000Z", earlySigns: [] },
    daily: [],
    weekly: [],
    reaction: [],
    typingSessions: [],
    activityDays: [],
    checkIns: [],
    settings: { muted: true },
  });
  const SIZES = [
    { width: 390, height: 844 },
    { width: 520, height: 820 },
    { width: 1366, height: 768 },
  ];
  const numbers = { screens: 0, scrolled: 0, feedbackShown: 0, audioLeftPlaying: 0, external: 0, errors: 0 };

  async function newPage(size: { width: number; height: number }) {
    const ctx = await b.newContext({ viewport: size });
    // Every request to another origin is refused and counted: the app must need none.
    await ctx.route("**/*", (route) => {
      if (new URL(route.request().url()).origin !== origin) {
        numbers.external++;
        return route.abort();
      }
      return route.continue();
    });
    await ctx.addInitScript((profile: string) => {
      if (!localStorage.getItem("companion.v1")) localStorage.setItem("companion.v1", profile);
      // Every media element that is ever played, to check it is paused and reset after leaving.
      const w = window as unknown as { __media: HTMLMediaElement[] };
      w.__media = [];
      const play = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        if (!w.__media.includes(this)) w.__media.push(this);
        return play.call(this);
      };
    }, PROFILE);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => {
      numbers.errors++;
      console.log(`     page error: ${String(e).slice(0, 160)}`);
    });
    page.on("console", (m) => {
      if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|ERR_INTERNET_DISCONNECTED/.test(m.text())) {
        numbers.errors++;
        console.log(`     console error: ${m.text().slice(0, 160)}`);
      }
    });
    return { ctx, page };
  }

  type P = Awaited<ReturnType<typeof newPage>>["page"];
  const fits = async (page: P, where: string) => {
    numbers.screens++;
    const m = await page.evaluate(() => ({
      y: document.scrollingElement!.scrollHeight - innerHeight,
      x: document.scrollingElement!.scrollWidth - innerWidth,
      groups: document.querySelector(".screen")?.children.length ?? 0,
      primaries: [...document.querySelectorAll(".btn-primary")].filter((e) => (e as HTMLElement).offsetParent !== null).length,
    }));
    const ok = m.y <= 0 && m.x <= 0 && m.groups <= 4 && m.primaries <= 1;
    if (!ok) {
      numbers.scrolled++;
      console.log(`     ${where}: ${JSON.stringify(m)}`);
    }
    return ok;
  };
  const go = async (page: P, p: string) => {
    await page.goto(base + p, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".screen", { timeout: 15_000 });
  };
  const click = async (page: P, sel: string) => {
    await page.locator(sel).first().click();
    await page.waitForTimeout(150);
  };
  const audioLeft = async (page: P) =>
    page.evaluate(() => {
      const w = window as unknown as { __media: HTMLMediaElement[] };
      return w.__media.filter((m) => !m.paused || m.currentTime > 0.05).length;
    });

  // How to start each activity, and how to reach its Done.
  const START: Record<string, string[]> = {
    outside: ["[data-act=start]"],
    daylight: ["[data-act=start]"],
    song: ["[data-act=start]"],
    attention: ["[data-act=start]"],
    eat: [".act-check"],
    game: ["[data-act=start]", "[data-card='0']"],
    hobby: ["[data-act=start]"],
    ask: ["[data-act=send]"],
    evening: ["[data-act=start]"],
  };

  for (const size of SIZES) {
    const label = `${size.width}x${size.height}`;
    const { ctx, page } = await newPage(size);

    // The library: three views of three plus the reaction check, paged, never scrolled.
    await go(page, "/activities/");
    let libOk = await fits(page, `${label} library`);
    const seen = new Set<string>();
    for (let i = 0; i < 4; i++) {
      for (const id of await page.$$eval(".act-library-item", (els) => els.map((e) => e.getAttribute("data-activity") ?? ""))) seen.add(id);
      libOk = (await fits(page, `${label} library ${i + 1}`)) && libOk;
      const next = page.locator(".pager button", { hasText: "Next" });
      if (await next.count()) await next.click();
    }
    check(`${label}: library pages through all nine and the reaction check without scrolling`, libOk && seen.size === 10, [...seen].join(","));

    for (const a of ACTIVITIES) {
      const id = a.id;
      let ok = true;
      const notes: string[] = [];
      // Start, then End: stops everything, and "Did any of it help?" once started.
      await go(page, `/activities/${id}/`);
      ok = (await fits(page, `${label} ${id} open`)) && ok;
      for (const sel of START[id]) await click(page, sel);
      await page.waitForTimeout(id === "song" || id === "evening" ? 1200 : 300);
      ok = (await fits(page, `${label} ${id} started`)) && ok;
      if (id === "song" || id === "evening") {
        const playing = await page.evaluate(() => (window as unknown as { __media: HTMLMediaElement[] }).__media.some((m) => !m.paused));
        if (!playing) notes.push("sound did not start");
        const light = await page.evaluate(() => document.querySelector(".act-edge-light[data-on]") !== null);
        if (!light) notes.push("no edge light");
      }
      await click(page, "[data-act=end]");
      await page.waitForSelector("[data-feedback]", { timeout: 5000 });
      if (await page.locator("text=Did any of it help?").count()) numbers.feedbackShown++;
      else notes.push("no gentle question after End");
      if ((await audioLeft(page)) > 0) {
        numbers.audioLeftPlaying++;
        notes.push("sound still playing after End");
      }
      if (await page.locator(".act-edge-light[data-on]").count()) notes.push("light still on after End");
      await click(page, "[data-act=skip-feedback]");

      // Open again, make it easier, do it: Done, then "Did that help?", then the close.
      await go(page, `/activities/${id}/`);
      await click(page, "[data-act=easier]");
      ok = (await fits(page, `${label} ${id} easier`)) && ok;
      if (id === "song") await click(page, "[data-act=skip]");
      if (id === "game") {
        await click(page, "[data-act=start]");
        // Find the two pairs by looking at the cards' labels as they turn.
        for (let guard = 0; guard < 12; guard++) {
          const won = await page.locator("[data-act=done]").count();
          if (won) break;
          const symbols: string[] = [];
          for (let i = 0; i < 4; i++) {
            const l = (await page.locator(`[data-card='${i}']`).getAttribute("aria-label")) ?? "";
            symbols.push(l);
          }
          const down = symbols.map((l, i) => (l.includes("face down") ? i : -1)).filter((i) => i >= 0);
          if (down.length < 2) break;
          await click(page, `[data-card='${down[0]}']`);
          await click(page, `[data-card='${down[1]}']`);
          await page.waitForTimeout(1000);
        }
      }
      if (id === "ask") {
        await click(page, "[data-act=send]");
        await page.waitForSelector("[data-act=reply]", { timeout: 5000 });
        const reply = (await page.locator("[data-act=reply]").textContent()) ?? "";
        if (!/talk|call/i.test(reply)) notes.push(`easier draft got "${reply}"`);
      }
      await click(page, "[data-act=done]");
      const q = await page.locator("text=Did that help?").count();
      if (q) numbers.feedbackShown++;
      else notes.push("no question after Done");
      ok = (await fits(page, `${label} ${id} feedback`)) && ok;
      await click(page, "[data-feedback=yes]");
      ok = (await fits(page, `${label} ${id} after`)) && ok;
      const stored = await page.evaluate((aid) => {
        const d = JSON.parse(localStorage.getItem("companion.v1") ?? "{}");
        const list = (d.activitiesDone ?? []).filter((r: { activity: string }) => r.activity === aid);
        return list[list.length - 1] ?? null;
      }, id);
      if (!stored || stored.feedback !== "yes" || stored.easier !== true) notes.push(`stored ${JSON.stringify(stored)}`);
      if ((await audioLeft(page)) > 0) {
        numbers.audioLeftPlaying++;
        notes.push("sound left playing");
      }

      // Opened again after all that: a fresh start with a "Did that help?" sentence.
      await go(page, `/activities/${id}/`);
      const history = (await page.locator("[data-act=history]").textContent()) ?? "";
      if (!history) notes.push("no history sentence");
      ok = (await fits(page, `${label} ${id} again`)) && ok;
      check(`${label}: ${id} starts, gets easier, ends, opens again`, ok && notes.length === 0, notes.join("; ") || history);
    }

    // Leaving a playing view by a link: the sound stops and goes back to the start.
    await go(page, "/activities/song/");
    await click(page, "[data-act=start]");
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() => (window as unknown as { __media: HTMLMediaElement[] }).__media.map((m) => ({ paused: m.paused, t: m.currentTime })));
    // Keep the element to check it after the view is gone.
    await page.evaluate(() => {
      (window as unknown as { __keep: HTMLMediaElement[] }).__keep = [...(window as unknown as { __media: HTMLMediaElement[] }).__media];
    });
    await page.locator("a.brand").click();
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => (window as unknown as { __keep: HTMLMediaElement[] }).__keep.map((m) => ({ paused: m.paused, t: m.currentTime })));
    const lightGone = await page.evaluate(() => document.querySelector(".act-edge-light") === null);
    check(
      `${label}: leaving a playing view pauses and resets the sound, and removes the light`,
      before.some((m) => !m.paused && m.t > 0.3) && after.length > 0 && after.every((m) => m.paused && m.t === 0) && lightGone,
      `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );

    // Hidden: the sound stops too.
    await go(page, "/activities/evening/");
    await click(page, "[data-act=start]");
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(300);
    const hiddenLeft = await audioLeft(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    check(`${label}: hiding the page stops and resets the sound`, hiddenLeft === 0);
    await ctx.close();

    // The timer, with a fake clock: hidden for two minutes, then closed past its end.
    const { ctx: c2, page: p2 } = await newPage(size);
    await p2.clock.install({ time: new Date("2026-11-14T12:00:00") });
    await go(p2, "/activities/outside/");
    await click(p2, "[data-act=start]");
    await p2.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p2.clock.setSystemTime(new Date("2026-11-14T12:02:00"));
    await p2.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await p2.clock.runFor(300);
    const shown = (await p2.locator(".act-timer-clock").textContent())?.trim();
    check(`${label}: timer after two minutes hidden shows 3:00`, shown === "3:00", shown ?? "");
    await p2.clock.setSystemTime(new Date("2026-11-14T12:30:00"));
    await go(p2, "/activities/outside/");
    await p2.clock.runFor(300);
    const finishText = (await p2.locator(".act-text").textContent()) ?? "";
    const keep = await p2.locator("[data-act=keep-going]").count();
    check(`${label}: ran out while closed: the finish view, said plainly`, keep === 1 && /were up at/.test(finishText), finishText);
    await c2.close();

    // Offline: the library, once loaded, still opens an activity and runs it.
    const { ctx: c3, page: p3 } = await newPage(size);
    await go(p3, "/activities/");
    await p3.waitForTimeout(1500);
    await c3.setOffline(true);
    let offlineOk = true;
    try {
      await p3.locator(".act-library-item").first().click();
      await p3.waitForSelector("[data-act=start]", { timeout: 5000 });
      await click(p3, "[data-act=start]");
      await p3.waitForSelector(".act-timer-clock", { timeout: 3000 });
      await click(p3, "[data-act=end]");
      await p3.waitForSelector("[data-feedback]", { timeout: 3000 });
    } catch (e) {
      offlineOk = false;
      console.log(`     offline: ${String(e).split("\n")[0]}`);
    }
    check(`${label}: offline after loading, the library opens an activity and it runs`, offlineOk);
    await c3.close();
  }

  // The reaction check: five taps, an early one discarded, a result in plain words.
  {
    const { ctx, page } = await newPage({ width: 390, height: 844 });
    await go(page, "/activities/reaction/");
    const pad = page.locator(".act-reaction-pad");
    await pad.dispatchEvent("pointerdown");
    await pad.dispatchEvent("pointerdown"); // too early
    const early = (await pad.getAttribute("data-phase")) === "early";
    let taps = 0;
    for (let guard = 0; guard < 400 && taps < 5; guard++) {
      if ((await pad.getAttribute("data-phase")) === "go") {
        await pad.dispatchEvent("pointerdown");
        taps++;
      }
      await page.waitForTimeout(25);
    }
    await page.waitForSelector(".act-reaction-line", { timeout: 5000 });
    const line = (await page.locator(".act-reaction-line").textContent()) ?? "";
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("companion.v1") ?? "{}").reactionChecks ?? []);
    check(
      "reaction check: early tap discarded, five counted, result stored with its context",
      early && taps === 5 && line === "Noted. I'm still learning your usual." && stored.length === 1 && stored[0].context === "own" && stored[0].trialsMs.length === 5,
      `${line} ${JSON.stringify(stored[0] ?? {})}`,
    );
    await fits(page, "reaction result");
    await ctx.close();
  }

  // Crisis words in the draft: the fixed help card, and the demo send still completes.
  {
    const { ctx, page } = await newPage({ width: 390, height: 844 });
    await go(page, "/activities/ask/");
    await page.fill("[data-act=draft]", "I want to die ");
    await page.waitForTimeout(200);
    const card = await page.locator("dialog[open] .crisis-card").count();
    await click(page, "[data-act=crisis-close]");
    await click(page, "[data-act=send]");
    await page.waitForSelector("[data-act=reply]", { timeout: 5000 });
    check("ask: crisis words show the fixed help card; the demo send still completes", card === 1);
    await ctx.close();
  }

  await b.close();
  console.log(
    `browser: ${numbers.screens} screens measured, ${numbers.scrolled} scrolled or broke the one-view rule, "Did that help?" shown ${numbers.feedbackShown} times, ` +
      `${numbers.audioLeftPlaying} sounds left playing, ${numbers.external} requests to other origins, ${numbers.errors} page errors`,
  );
  check("browser: no page errors and no requests to other origins", numbers.errors === 0 && numbers.external === 0);
}

const i = process.argv.indexOf("--browser");
if (i >= 0) await browser(process.argv[i + 1] ?? "http://localhost:3474");
else unit();
console.log(failed ? `${failed} failed` : "activities: all passed");
process.exit(failed ? 1 : 0);
