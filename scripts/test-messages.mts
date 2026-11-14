/*
  Tests for the messages service and its client.

    npx tsx scripts/test-messages.mts [baseUrl]      (default http://localhost:3480)

  Starts nothing itself. Start the service first: cd server && pnpm dev
  Runs: the validators, the in-memory store's limits, that the shared files in server/ are
  exact copies, the whole story over HTTP, the refusals, and the local-first client
  (idempotent retry, outbox while offline, cache without network, poll after send).

  Expiry is tested when the service runs with a short lifetime:
    PAIR_TTL_SECONDS=8 pnpm dev      then run this script again (it detects the short lifetime).
*/
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  canSend,
  charLength,
  checkName,
  checkText,
  isValidPair,
  newClientId,
  parseDraft,
  validateEvent,
  type MessageEvent,
} from "../lib/events";
import { createMessagesClient, timeline, type Snapshot, type StorageLike } from "../lib/messages";
import { MemoryStore } from "../server/lib/store";

const BASE = (process.argv[2] ?? process.env.MESSAGES_URL ?? "http://localhost:3480").replace(/\/+$/, "");
// Each run gets its own bucket for the pair-creation limit.
const FAKE_IP = `10.${rand255()}.${rand255()}.${rand255()}`;

let passed = 0;
let failed = 0;
let skipped = 0;

function rand255() {
  return Math.floor(Math.random() * 255);
}

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`PASS ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? `: ${detail}` : ""}`);
  }
}

function skip(name: string, why: string) {
  skipped++;
  console.log(`SKIP ${name}: ${why}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(fn: () => boolean, ms: number, step = 50): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(step);
  }
  return fn();
}

// --- HTTP helpers ----------------------------------------------------------------------

type Res = { status: number; body: Record<string, unknown>; headers: Headers };

async function api(method: string, path: string, opts: { token?: string; body?: unknown; raw?: string; origin?: string; ip?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { "X-Forwarded-For": opts.ip ?? FAKE_IP };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined || opts.raw !== undefined) headers["Content-Type"] = "application/json";
  if (opts.origin) headers.Origin = opts.origin;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body, headers: res.headers };
}

interface Made {
  pair: string;
  userToken: string;
  inviteToken: string;
  inviteUrl: string;
  userUrl: string;
  expiresAt: string;
}

async function makePair(): Promise<Made> {
  const r = await api("POST", "/api/pairs", { body: {} });
  if (r.status !== 201) throw new Error(`create pair returned ${r.status}`);
  return r.body as unknown as Made;
}

async function join(p: Made, name = "Anna"): Promise<string> {
  const r = await api("POST", `/api/pairs/${p.pair}/join`, { body: { inviteToken: p.inviteToken, name } });
  if (r.status !== 200) throw new Error(`join returned ${r.status}`);
  return String(r.body.trustedToken);
}

const send = (p: Made, token: string, body: Record<string, unknown>) =>
  api("POST", `/api/pairs/${p.pair}/events`, { token, body: { clientId: newClientId(), ...body } });

const events = async (p: Made, token: string, since?: string) =>
  api("GET", `/api/pairs/${p.pair}/events${since ? `?since=${encodeURIComponent(since)}` : ""}`, { token });

const list = (r: Res) => (r.body.events as MessageEvent[]) ?? [];

// --- 1. Validators ---------------------------------------------------------------------

function testValidators() {
  check("validator: text of 1 character is fine", checkText("a").ok);
  check("validator: text of 280 characters is fine", checkText("x".repeat(280)).ok);
  check("validator: text of 281 characters is refused", !checkText("x".repeat(281)).ok);
  check("validator: empty and whitespace-only text are refused", !checkText("").ok && !checkText("   \n ").ok);
  check("validator: text is trimmed", checkText("  hi  ").ok && (checkText("  hi  ") as { value: string }).value === "hi");
  check("validator: an emoji counts as one character", charLength("👋") === 1 && checkText("👋".repeat(280)).ok && !checkText("👋".repeat(281)).ok);
  check("validator: control characters are refused, line breaks allowed", !checkText("a\u0007b").ok && checkText("a\nb").ok);
  check("validator: non-string text is refused", !checkText(42).ok && !checkText(null).ok);
  check("validator: name of 40 characters is fine, 41 refused", checkName("n".repeat(40)).ok && !checkName("n".repeat(41)).ok);
  check("validator: name must be one line and not empty", !checkName("An\nna").ok && !checkName(" ").ok);
  check("validator: pair codes use the unambiguous alphabet", isValidPair("ABC234") && !isValidPair("ABC10O") && !isValidPair("abc234") && !isValidPair("ABC23"));
  check(
    "validator: roles (greeting trusted only, contact_request user only, reply both)",
    canSend("trusted", "greeting") && !canSend("user", "greeting") && canSend("user", "contact_request") && !canSend("trusted", "contact_request") && canSend("user", "reply") && canSend("trusted", "reply"),
  );
  const cid = newClientId();
  check("validator: greeting draft accepted", parseDraft({ type: "greeting", clientId: cid, text: "Walk after lunch?", kind: "question" }).ok);
  check("validator: greeting with a bad kind refused", !parseDraft({ type: "greeting", clientId: cid, text: "hi", kind: "shout" }).ok);
  check("validator: greeting with replyTo refused", !parseDraft({ type: "greeting", clientId: cid, text: "hi", kind: "greeting", replyTo: "eabcdefgh" }).ok);
  check("validator: reply needs replyTo, answer yes/no/null", parseDraft({ type: "reply", clientId: cid, replyTo: "eabcdefgh", answer: "yes", text: "Yes" }).ok && !parseDraft({ type: "reply", clientId: cid, answer: "yes", text: "Yes" }).ok && !parseDraft({ type: "reply", clientId: cid, replyTo: "eabcdefgh", answer: "maybe", text: "x" }).ok);
  check("validator: missing or bad clientId refused", !parseDraft({ type: "contact_request", text: "hi" }).ok && !parseDraft({ type: "contact_request", clientId: "short", text: "hi" }).ok);
  check("validator: unknown type refused", !parseDraft({ type: "heart_rate", clientId: cid, text: "72" }).ok);
  const ev = { v: 1, id: "eabcdefgh12", ts: new Date().toISOString(), pair: "ABC234", clientId: cid, type: "greeting", from: { role: "trusted", name: "Anna" }, text: "Hi", kind: "greeting", replyTo: null };
  check("validator: a full event validates", validateEvent(ev).ok);
  check("validator: a greeting from the user is not a valid event", !validateEvent({ ...ev, from: { role: "user" } }).ok);
  check("validator: an unknown version is refused", !validateEvent({ ...ev, v: 2 }).ok);
}

// --- 2. Store limits (in-memory implementation) -----------------------------------------

async function testStore() {
  const s = new MemoryStore();
  const now = Date.now();
  await s.createPair({ pair: "ABC234", createdAt: now, expiresAt: now + 60_000, userTokenHash: "a", inviteTokenHash: "b", trustedTokenHash: null, trustedName: null });
  const mk = (i: number): MessageEvent => ({ v: 1, id: `e${String(i).padStart(10, "0")}`, ts: new Date(now).toISOString(), pair: "ABC234", clientId: `c${String(i).padStart(10, "0")}`, type: "contact_request", from: { role: "user" }, text: "hi" });
  let okCount = 0;
  let firstFull = -1;
  for (let i = 0; i < 510; i++) {
    const r = await s.appendEvent("ABC234", mk(i), { perMinute: 10_000, cap: 500, now: now + i });
    if (r.status === "ok") okCount++;
    else if (r.status === "full" && firstFull < 0) firstFull = i;
  }
  check("store: caps a pair at 500 events", okCount === 500 && firstFull === 500, `ok=${okCount} firstFull=${firstFull}`);
  const dup = await s.appendEvent("ABC234", mk(3), { perMinute: 10_000, cap: 500, now });
  check("store: the same clientId returns the original event", dup.status === "duplicate" && dup.event.id === mk(3).id);
  const s2 = new MemoryStore();
  await s2.createPair({ pair: "DEF234", createdAt: now, expiresAt: now + 600_000, userTokenHash: "a", inviteTokenHash: "b", trustedTokenHash: null, trustedName: null });
  const statuses: string[] = [];
  for (let i = 0; i < 31; i++) statuses.push((await s2.appendEvent("DEF234", { ...mk(i), pair: "DEF234" }, { perMinute: 30, cap: 500, now: now + i })).status);
  check("store: 30 per minute, the 31st is limited", statuses.slice(0, 30).every((x) => x === "ok") && statuses[30] === "rate_limited");
  const later = await s2.appendEvent("DEF234", { ...mk(99), pair: "DEF234" }, { perMinute: 30, cap: 500, now: now + 61_000 });
  check("store: the limit resets after a minute", later.status === "ok");
  check("store: an expired pair is gone", (await s.getPair("ABC234", now + 60_001)) === null && (await s.listEvents("ABC234", now + 60_001)).length === 0);
}

// --- 3. Shared files are exact copies ---------------------------------------------------

function testCopies() {
  const root = fileURLToPath(new URL("..", import.meta.url));
  for (const f of ["events.ts", "messages.ts"]) {
    const a = readFileSync(`${root}lib/${f}`, "utf8");
    const b = readFileSync(`${root}server/lib/${f}`, "utf8");
    check(`copy: server/lib/${f} is identical to lib/${f}`, a === b);
  }
}

// --- 4. The whole story over HTTP ---------------------------------------------------------

async function testStory() {
  const p = await makePair();
  check("story: create pair returns a 6-character code, tokens and links", isValidPair(p.pair) && p.userToken.length >= 40 && p.inviteToken.length >= 40 && p.inviteUrl.includes(`/t/${p.pair}?i=`) && p.userUrl.includes(`/u/${p.pair}?u=`));
  const hours = (Date.parse(p.expiresAt) - Date.now()) / 3_600_000;
  check("story: the pair expires 48 hours after creation", hours > 47.9 && hours <= 48.01, `hours=${hours.toFixed(3)}`);

  const trusted = await join(p, "Anna");
  check("story: trusted person joins", trusted.length >= 40);

  const req = await send(p, p.userToken, { type: "contact_request", text: "Could you get in touch?" });
  check("story: person sends a contact request (201)", req.status === 201);

  const seen = await events(p, trusted);
  const reqEv = list(seen).find((e) => e.type === "contact_request");
  check("story: trusted polls and sees the request", seen.status === 200 && !!reqEv && reqEv.text === "Could you get in touch?" && seen.body.trustedName === "Anna" && typeof seen.body.serverTime === "string");

  const q = await send(p, trusted, { type: "greeting", text: "Walk after lunch?", kind: "question" });
  const qEv = q.body.event as MessageEvent;
  check("story: trusted sends a question, server sets id, ts, pair and from", q.status === 201 && qEv.type === "greeting" && qEv.from.role === "trusted" && (qEv as { from: { name: string } }).from.name === "Anna" && qEv.pair === p.pair && !!qEv.id && !Number.isNaN(Date.parse(qEv.ts)));

  const userSees = await events(p, p.userToken, reqEv!.id);
  check("story: person polls with since=<id> and sees only the question", userSees.status === 200 && list(userSees).length === 1 && list(userSees)[0].id === qEv.id);

  const userSince = await events(p, p.userToken, reqEv!.ts);
  check("story: since=<ISO time> also works", list(userSince).some((e) => e.id === qEv.id) && !list(userSince).some((e) => e.id === reqEv!.id));

  const yes = await send(p, p.userToken, { type: "reply", replyTo: qEv.id, answer: "yes", text: "Yes" });
  check("story: person replies yes", yes.status === 201 && (yes.body.event as { answer: string }).answer === "yes");

  const trustedSees = await events(p, trusted, qEv.id);
  const ans = list(trustedSees).find((e) => e.type === "reply");
  check("story: trusted sees the reply", !!ans && ans.type === "reply" && ans.answer === "yes" && ans.replyTo === qEv.id);

  const all = list(await events(p, p.userToken));
  check("story: events come oldest first", all.map((e) => e.type).join(",") === "contact_request,greeting,reply");

  const keys = Object.keys(all[0]).sort().join(",");
  check("story: events hold only the message fields", keys === "clientId,from,id,pair,text,ts,type,v", keys);
}

// --- 5. Refusals --------------------------------------------------------------------------

async function testRefusals() {
  const p = await makePair();
  const trusted = await join(p, "Anna");
  const q = await send(p, trusted, { type: "greeting", text: "Call tonight?", kind: "question" });
  const qId = (q.body.event as MessageEvent).id;

  const noToken = await api("GET", `/api/pairs/${p.pair}/events`);
  check("refuse: no token is 401", noToken.status === 401 && typeof noToken.body.error === "string");
  const wrong = await events(p, "x".repeat(43));
  check("refuse: a wrong token is 401", wrong.status === 401);
  const badInvite = await api("POST", `/api/pairs/${p.pair}/join`, { body: { inviteToken: "y".repeat(43), name: "Eve" } });
  check("refuse: a wrong invite is 401", badInvite.status === 401);
  const inviteAsBearer = await events(p, p.inviteToken);
  check("refuse: the invite token is not a bearer token", inviteAsBearer.status === 401);

  const userGreets = await send(p, p.userToken, { type: "greeting", text: "Hi", kind: "greeting" });
  check("refuse: the person cannot send a greeting (403)", userGreets.status === 403);
  const trustedAsks = await send(p, trusted, { type: "contact_request", text: "Hi" });
  check("refuse: the trusted person cannot send a contact request (403)", trustedAsks.status === 403);
  const trustedDeletes = await api("DELETE", `/api/pairs/${p.pair}`, { token: trusted });
  check("refuse: the trusted person cannot delete the pair (403)", trustedDeletes.status === 403);

  const long = await send(p, trusted, { type: "greeting", text: "x".repeat(281), kind: "greeting" });
  check("refuse: text over 280 characters is 400", long.status === 400);
  const longName = await api("POST", `/api/pairs/${p.pair}/join`, { body: { inviteToken: p.inviteToken, name: "n".repeat(41) } });
  check("refuse: a name over 40 characters is 400", longName.status === 400);
  const junk = await api("POST", `/api/pairs/${p.pair}/events`, { token: trusted, raw: "{not json" });
  check("refuse: invalid JSON is 400", junk.status === 400);
  const big = await api("POST", `/api/pairs/${p.pair}/events`, { token: trusted, raw: JSON.stringify({ type: "greeting", clientId: newClientId(), kind: "greeting", text: "hi", pad: "z".repeat(5000) }) });
  check("refuse: a body over 4 KB is 413", big.status === 413);
  const ownReply = await send(p, trusted, { type: "reply", replyTo: qId, answer: null, text: "me again" });
  check("refuse: replying to your own message is 400", ownReply.status === 400);
  const ghost = await send(p, p.userToken, { type: "reply", replyTo: "eDoesNotExist1", answer: "yes", text: "Yes" });
  check("refuse: replyTo an unknown message is 400", ghost.status === 400);
  const badSince = await events(p, p.userToken, "not an id!");
  check("refuse: a malformed since is 400", badSince.status === 400);

  // Cross-pair access: B's token on A's pair.
  const b = await makePair();
  const trustedB = await join(b, "Bo");
  check("refuse: another pair's user token is 401", (await events(p, b.userToken)).status === 401);
  check("refuse: another pair's trusted token cannot post here", (await send(p, trustedB, { type: "greeting", text: "Hi", kind: "greeting" })).status === 401);
  check("refuse: another pair's invite cannot join here", (await api("POST", `/api/pairs/${p.pair}/join`, { body: { inviteToken: b.inviteToken, name: "Bo" } })).status === 401);
  check("refuse: an unknown pair is 404", (await api("GET", `/api/pairs/ZZZZZZ/events`, { token: p.userToken })).status === 404);
  check("refuse: a malformed pair code is 404", (await api("GET", `/api/pairs/abc/events`, { token: p.userToken })).status === 404);

  // Joining again replaces the name and the old trusted token.
  const again = await api("POST", `/api/pairs/${p.pair}/join`, { body: { inviteToken: p.inviteToken, name: "Annie" } });
  const newer = String(again.body.trustedToken);
  const nameNow = (await events(p, p.userToken)).body.trustedName;
  check("join again: the name is replaced", again.status === 200 && nameNow === "Annie");
  check("join again: the old trusted token stops working", (await events(p, trusted)).status === 401 && (await events(p, newer)).status === 200);

  // Idempotent POST.
  const cid = newClientId();
  const first = await api("POST", `/api/pairs/${p.pair}/events`, { token: p.userToken, body: { type: "contact_request", clientId: cid, text: "Ping" } });
  const second = await api("POST", `/api/pairs/${p.pair}/events`, { token: p.userToken, body: { type: "contact_request", clientId: cid, text: "Ping" } });
  const pings = list(await events(p, p.userToken)).filter((e) => e.clientId === cid);
  check("idempotent: a retried POST with the same clientId gives one event", first.status === 201 && second.status === 200 && second.body.duplicate === true && (second.body.event as MessageEvent).id === (first.body.event as MessageEvent).id && pings.length === 1);

  // CORS.
  const tauri = await api("GET", `/api/pairs/${p.pair}/events`, { token: p.userToken, origin: "tauri://localhost" });
  const other = await api("GET", `/api/pairs/${p.pair}/events`, { token: p.userToken, origin: "https://evil.example" });
  check("cors: tauri://localhost is allowed, other origins are not", tauri.headers.get("access-control-allow-origin") === "tauri://localhost" && other.headers.get("access-control-allow-origin") === null);

  // Rate limit: 30 per minute per pair.
  const r = await makePair();
  const rt = await join(r, "Rae");
  const codes: number[] = [];
  for (let i = 0; i < 31; i++) codes.push((await send(r, rt, { type: "greeting", text: `Hi ${i}`, kind: "greeting" })).status);
  check("refuse: the 31st event in a minute is 429", codes.slice(0, 30).every((c) => c === 201) && codes[30] === 429, codes.join(","));

  // Pair creation limit per client.
  const ip = `10.250.${rand255()}.${rand255()}`;
  const creates: number[] = [];
  for (let i = 0; i < 21; i++) creates.push((await api("POST", "/api/pairs", { body: {}, ip })).status);
  check("refuse: the 21st pair from one client in an hour is 429", creates.slice(0, 20).every((c) => c === 201) && creates[20] === 429);

  // Delete.
  const d = await makePair();
  const dt = await join(d, "Dee");
  await send(d, dt, { type: "greeting", text: "Hi", kind: "greeting" });
  const del = await api("DELETE", `/api/pairs/${d.pair}`, { token: d.userToken });
  check("delete: the person deletes the pair (200)", del.status === 200);
  check("delete: a deleted pair is 404 for both", (await events(d, d.userToken)).status === 404 && (await events(d, dt)).status === 404 && (await send(d, dt, { type: "greeting", text: "Hi", kind: "greeting" })).status === 404);
}

// --- 6. The local-first client -------------------------------------------------------------

function memStorage(): StorageLike & { dump(): Map<string, string> } {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), dump: () => m };
}

/** A fetch that can be switched off, can lose responses, and counts requests. */
function flakyFetch() {
  const state = { online: true, loseNextResponse: false, gets: 0, posts: 0 };
  const f: typeof fetch = async (input, init) => {
    if (!state.online) throw new TypeError("fetch failed");
    const method = init?.method ?? "GET";
    if (method === "GET") state.gets++;
    if (method === "POST") state.posts++;
    const headers = new Headers(init?.headers);
    headers.set("X-Forwarded-For", FAKE_IP);
    const res = await fetch(input, { ...init, headers });
    if (state.loseNextResponse && method === "POST") {
      state.loseNextResponse = false;
      throw new TypeError("connection reset");
    }
    return res;
  };
  return { state, f };
}

async function testClient() {
  // Retry after a lost response: the request reached the service, the answer did not.
  {
    const net = flakyFetch();
    const storage = memStorage();
    const c = createMessagesClient({ baseUrl: BASE, storage, fetch: net.f, storageKey: "t1" });
    const p = await c.createPair();
    const raw: Made = { pair: p.pair, userToken: p.token, inviteToken: new URL(p.inviteUrl!).searchParams.get("i")!, inviteUrl: p.inviteUrl!, userUrl: p.userUrl!, expiresAt: p.expiresAt! };
    const trusted = await join(raw, "Anna");
    check("client: createPair stores the pair under its own key", !!storage.getItem("t1") && c.pairing()?.pair === p.pair);

    net.state.loseNextResponse = true;
    const out = c.sendContactRequest();
    check("client: a send returns at once with status sending", out.status === "sending" && c.snapshot().outbox.length === 1);
    const done = await until(() => c.snapshot().outbox.length === 0, 6000);
    const onServer = list(await events(raw, trusted)).filter((e) => e.clientId === out.clientId);
    check("client: a retry after a lost response creates no duplicate", done && net.state.posts >= 2 && onServer.length === 1, `posts=${net.state.posts} onServer=${onServer.length}`);
    check("client: the delivered message is in the local cache", c.snapshot().events.some((e) => e.clientId === out.clientId));
  }

  // Queued while the service is unreachable, delivered once it is back.
  {
    const net = flakyFetch();
    const storage = memStorage();
    const c = createMessagesClient({ baseUrl: BASE, storage, fetch: net.f, storageKey: "t2" });
    const p = await c.createPair();
    const raw: Made = { pair: p.pair, userToken: p.token, inviteToken: new URL(p.inviteUrl!).searchParams.get("i")!, inviteUrl: "", userUrl: "", expiresAt: "" };
    const trusted = await join(raw, "Anna");
    const q = await send(raw, trusted, { type: "greeting", text: "Walk after lunch?", kind: "question" });
    const qId = (q.body.event as MessageEvent).id;

    net.state.online = false;
    const a = c.sendContactRequest("Could you call?");
    const b = c.sendReply(qId, "yes");
    check("offline: both messages are queued with status sending", a.status === "sending" && b.status === "sending" && c.snapshot().outbox.length === 2);
    const waiting = await until(() => c.snapshot().outbox[0]?.status === "waiting for connection", 9000);
    check("offline: after repeated failures the status is waiting for connection", waiting, JSON.stringify(c.snapshot().outbox.map((o) => [o.status, o.attempts])));
    check("offline: nothing reached the service yet", list(await events(raw, trusted)).length === 1);
    const stored = JSON.parse(storage.getItem("t2")!) as { outbox: unknown[] };
    check("offline: the outbox is kept in storage (survives a reload)", stored.outbox.length === 2);

    net.state.online = true;
    await c.flush();
    const delivered = await until(() => c.snapshot().outbox.length === 0, 5000);
    const after = list(await events(raw, trusted));
    check(
      "offline: queued messages are delivered once the service is back, once each, in order",
      delivered && after.length === 3 && after[1].clientId === a.clientId && after[2].clientId === b.clientId,
      after.map((e) => e.type).join(","),
    );
  }

  // Cached events render without the network; subscribe gives the cache first.
  {
    const net = flakyFetch();
    const storage = memStorage();
    const c = createMessagesClient({ baseUrl: BASE, storage, fetch: net.f, storageKey: "t3", pollMs: 60_000 });
    const p = await c.createPair();
    const raw: Made = { pair: p.pair, userToken: p.token, inviteToken: new URL(p.inviteUrl!).searchParams.get("i")!, inviteUrl: "", userUrl: "", expiresAt: "" };
    const trusted = await join(raw, "Anna");
    await send(raw, trusted, { type: "greeting", text: "Thinking of you", kind: "greeting" });
    await c.poll();
    check("cache: a poll fills the local cache", c.snapshot().events.length === 1 && c.snapshot().trustedName === "Anna");

    // A fresh client on the same storage, with the network down.
    const down = flakyFetch();
    down.state.online = false;
    const c2 = createMessagesClient({ baseUrl: BASE, storage, fetch: down.f, storageKey: "t3", pollMs: 60_000 });
    const got: Snapshot[] = [];
    const stop = c2.subscribe((s) => got.push(s));
    const firstSync = got[0];
    check(
      "cache: subscribe hands over the cached conversation at once, before any network answer",
      !!firstSync && firstSync.fromCache && firstSync.events.length === 1 && timeline(firstSync)[0].text === "Thinking of you" && firstSync.trustedName === "Anna",
    );
    const offline = await until(() => got.some((s) => s.connection === "offline"), 2000);
    check("cache: with the network down the state says offline, the cache stays", offline && got[got.length - 1].events.length === 1);
    stop();

    // Poll immediately after a send.
    const c3net = flakyFetch();
    const c3 = createMessagesClient({ baseUrl: BASE, storage, fetch: c3net.f, storageKey: "t3", pollMs: 60_000 });
    const stop3 = c3.subscribe(() => {});
    await until(() => c3net.state.gets >= 1, 2000);
    const before = c3net.state.gets;
    c3.sendContactRequest();
    const polledAfterSend = await until(() => c3net.state.posts >= 1 && c3net.state.gets > before, 2000);
    check("poll: a send triggers a poll right away (poll interval set to 60 s here)", polledAfterSend, `gets ${before} -> ${c3net.state.gets}`);
    const newOnes: string[] = [];
    const stop4 = c3.subscribe((s) => newOnes.push(...s.newEvents.map((e) => e.id)));
    await send(raw, trusted, { type: "greeting", text: "Call tonight?", kind: "question" });
    await c3.poll();
    check("subscribe: newEvents carries only what arrived since", newOnes.length === 1);
    stop3();
    stop4();

    await c3.deletePair();
    check("client: deletePair removes it on the service and on the device", storage.getItem("t3") === null && (await events(raw, trusted)).status === 404);
  }
}

// --- 7. Expiry (only when the service runs with a short lifetime) -------------------------

async function testExpiry(): Promise<boolean> {
  const p = await makePair();
  const ms = Date.parse(p.expiresAt) - Date.now();
  if (ms > 20_000) {
    skip("expiry: an expired pair is 404", "the service uses the full 48 hours; start it with PAIR_TTL_SECONDS=8 to test");
    return false;
  }
  const trusted = await join(p, "Anna");
  check("expiry: before expiry the pair works", (await events(p, trusted)).status === 200);
  await sleep(ms + 500);
  check("expiry: an expired pair is 404 for every call", (await events(p, p.userToken)).status === 404 && (await events(p, trusted)).status === 404 && (await api("POST", `/api/pairs/${p.pair}/join`, { body: { inviteToken: p.inviteToken, name: "A" } })).status === 404);
  return true;
}

// --- Run ------------------------------------------------------------------------------------

testValidators();
await testStore();
testCopies();
try {
  const probe = await fetch(BASE + "/api/pairs/ZZZZZZ/events").catch(() => null);
  if (!probe) {
    check(`service reachable at ${BASE}`, false, "start it first: cd server && pnpm dev");
  } else {
    const short = await testExpiry();
    if (!short) {
      await testStory();
      await testRefusals();
      await testClient();
    } else {
      skip("story, refusals and client", "skipped while the service runs with a short lifetime");
    }
  }
} catch (e) {
  check("no unexpected error", false, e instanceof Error ? e.message : String(e));
}
console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
process.exit(failed ? 1 : 0);
