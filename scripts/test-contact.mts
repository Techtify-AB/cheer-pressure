// Unit tests for the real contact adapter (lib/contact.ts) against a fake messages client:
// which implementation is chosen, the request and its delivery status from the outbox, the
// reply, the answer going back through sendReply, and which message home shows.
// Run: pnpm test:contact (also part of pnpm test).
import {
  answerTo,
  chooseContact,
  contactState,
  CONTACT_REQUEST_TEXT,
  createMessagesContact,
  pendingMessage,
  type MessagesPort,
} from "../lib/contact.ts";
import type { Answer, EventDraft, MessageEvent } from "../lib/events.ts";
import type { Connection, Outgoing, OutgoingStatus, Pairing, Snapshot } from "../lib/messages.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
}

const PAIR = "ABC234";
let clock = Date.parse("2026-11-14T12:00:00.000Z");
const tick = () => new Date((clock += 1000)).toISOString();
let ids = 0;
const nextId = () => `evt${String(++ids).padStart(6, "0")}`;

/** A messages client in memory: what the adapter sees, and a record of what it sent. */
function fakeClient(opts: { paired?: boolean; role?: "user" | "trusted"; trustedName?: string | null } = {}) {
  let pairing: Pairing | null =
    opts.paired === false ? null : { baseUrl: "http://fake", pair: PAIR, role: opts.role ?? "user", token: "t".repeat(43) };
  const events: MessageEvent[] = [];
  const outbox: Outgoing[] = [];
  let connection: Connection = "online";
  let trustedName = opts.trustedName === undefined ? "Sara" : opts.trustedName;
  const listeners = new Set<(s: Snapshot) => void>();
  const sent: EventDraft[] = [];
  let subscribes = 0;

  const snap = (newEvents: MessageEvent[] = []): Snapshot => ({
    pairing,
    trustedName,
    events: [...events],
    outbox: outbox.map((o) => ({ ...o })),
    connection,
    newEvents,
    fromCache: false,
  });
  const emit = (added: MessageEvent[] = []) => listeners.forEach((l) => l(snap(added)));
  const enqueue = (draft: EventDraft): Outgoing => {
    sent.push(draft);
    const o: Outgoing = { clientId: draft.clientId, draft, createdAt: tick(), status: "sending", attempts: 0, nextAttemptAt: 0 };
    outbox.push(o);
    emit();
    return { ...o };
  };

  const port: MessagesPort = {
    pairing: () => pairing,
    snapshot: () => snap(),
    subscribe(cb) {
      subscribes++;
      listeners.add(cb);
      cb(snap());
      return () => listeners.delete(cb);
    },
    sendContactRequest(text = "Could you get in touch?") {
      return enqueue({ type: "contact_request", clientId: `c${++ids}xxxxxxxx`, text });
    },
    sendReply(replyTo: string, answer: Answer | null, text?: string) {
      return enqueue({ type: "reply", clientId: `c${++ids}xxxxxxxx`, replyTo, answer, text: text ?? (answer === "yes" ? "Yes" : "No") });
    },
  };

  return {
    port,
    sent,
    get subscribers() {
      return listeners.size;
    },
    get subscribes() {
      return subscribes;
    },
    /** The service confirmed the oldest outbox item. */
    deliver() {
      const o = outbox.shift();
      if (!o) return;
      const d = o.draft;
      const base = { v: 1 as const, id: nextId(), ts: tick(), pair: PAIR, clientId: d.clientId };
      const e: MessageEvent =
        d.type === "reply"
          ? { ...base, type: "reply", from: { role: "user" }, replyTo: d.replyTo, answer: d.answer, text: d.text }
          : d.type === "contact_request"
            ? { ...base, type: "contact_request", from: { role: "user" }, text: d.text }
            : { ...base, type: "greeting", from: { role: "trusted", name: trustedName ?? "Sara" }, text: d.text, kind: d.kind, replyTo: null };
      events.push(e);
      emit();
    },
    setStatus(i: number, status: OutgoingStatus) {
      outbox[i].status = status;
      emit();
    },
    setConnection(c: Connection) {
      connection = c;
      emit();
    },
    /** The trusted person sends a greeting or question. */
    greet(text: string, kind: "greeting" | "question" = "question") {
      const e: MessageEvent = { v: 1, id: nextId(), ts: tick(), pair: PAIR, clientId: `g${ids}xxxxxxxx`, type: "greeting", from: { role: "trusted", name: trustedName ?? "Sara" }, text, kind, replyTo: null };
      events.push(e);
      emit([e]);
      return e;
    },
    /** The trusted person's own reply to something (not from the person). */
    trustedReply(replyTo: string) {
      const e: MessageEvent = { v: 1, id: nextId(), ts: tick(), pair: PAIR, clientId: `r${ids}xxxxxxxx`, type: "reply", from: { role: "trusted" }, replyTo, answer: null, text: "ok" };
      events.push(e);
      emit([e]);
    },
    end() {
      connection = "ended";
      emit();
    },
    unpair() {
      pairing = null;
      trustedName = null;
      emit();
    },
  };
}

// Never any network: the adapter only talks to the client it is given.
let fetched = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  fetched++;
  throw new Error("no network in these tests");
}) as typeof fetch;

// --- Choosing --------------------------------------------------------------------------
{
  const none = chooseContact({ client: fakeClient({ paired: false }).port, demo: true, replyAfterMs: 5 });
  check("choose: no pair in demo mode gives the stand-in, marked simulated", none.simulated && !none.connected);
  const noClient = chooseContact({ client: null, demo: false });
  check("choose: no client outside demo mode gives the stand-in, not connected", noClient.simulated && noClient.status() === "not-connected");
  const real = chooseContact({ client: fakeClient().port, demo: true });
  check("choose: a pair gives the real one, even in demo mode", !real.simulated && real.connected && real.status() === "ready");
  const f = fakeClient();
  f.end();
  check("choose: an ended pair gives the stand-in", chooseContact({ client: f.port, demo: false }).simulated);
}

// --- The request and its delivery status ---------------------------------------------
{
  const f = fakeClient();
  const c = createMessagesContact(f.port);
  const seen: string[] = [];
  const stop = c.onChange((s) => seen.push(s.status));
  await c.requestContact();
  check("request: one contact request with the fixed text", f.sent.length === 1 && f.sent[0].type === "contact_request" && f.sent[0].text === CONTACT_REQUEST_TEXT);
  check("request: shows Sending at once", c.status() === "sending");
  f.setStatus(0, "waiting for connection");
  check("request: shows Waiting for connection from the outbox", c.status() === "waiting for connection");
  f.deliver();
  check("request: shows Sent once the service confirmed it", c.status() === "sent");
  const steps = seen.filter((x, i) => x !== seen[i - 1]).join(",");
  check("request: every change reached the listener, in order", steps === "ready,sending,waiting for connection,sent", steps);
  stop();
  check("request: stopping the last listener ends the subscription", f.subscribers === 0);
}
{
  const f = fakeClient();
  f.port.sendReply("evt999999", "yes");
  f.setStatus(0, "waiting for connection");
  const c = createMessagesContact(f.port);
  c.onChange(() => {});
  await c.requestContact();
  check("request: queued behind a message waiting for connection, it shows waiting too", c.status() === "waiting for connection");
  const g = fakeClient();
  const c2 = createMessagesContact(g.port);
  c2.onChange(() => {});
  await c2.requestContact();
  g.setConnection("offline");
  check("request: shows waiting while the client is offline", c2.status() === "waiting for connection");
  g.setStatus(0, "not sent");
  check("request: a refused request shows Not sent", c2.status() === "not sent");
}

// --- The reply and the answer ------------------------------------------------------------
{
  const f = fakeClient();
  const c = createMessagesContact(f.port);
  const replies: string[] = [];
  c.onReply((r) => replies.push(`${r.fromName}: ${r.text}`));
  c.onChange(() => {});
  f.greet("Thinking of you", "greeting"); // before the request: not its reply
  await c.requestContact();
  f.deliver();
  check("reply: a greeting from before the request is not its reply", c.status() === "sent" && c.state().reply === null);
  const q = f.greet("Walk after lunch?");
  const st = c.state();
  check("reply: the next greeting is the reply, with name, kind and id", st.status === "replied" && st.reply?.text === "Walk after lunch?" && st.reply.fromName === "Sara" && st.reply.kind === "question" && st.reply.id === q.id && !st.reply.simulated);
  check("reply: onReply called once for it", replies.length === 1 && replies[0] === "Sara: Walk after lunch?", replies.join(" | "));
  c.answer("yes");
  const last = f.sent[f.sent.length - 1];
  check("answer: Yes goes back through sendReply, to that message", last.type === "reply" && last.replyTo === q.id && last.answer === "yes" && last.text === "Yes");
  check("answer: the state shows the answer and its delivery", c.state().answered?.answer === "yes" && c.state().answered?.status === "sending");
  f.deliver();
  check("answer: Sent once confirmed", c.state().answered?.status === "sent");
  check("answer: nothing waits on home after it", pendingMessage(f.port.snapshot()) === null);
}
{
  const f = fakeClient();
  const c = createMessagesContact(f.port);
  c.onChange(() => {});
  await c.requestContact();
  f.deliver();
  const q = f.greet("Call tonight?");
  c.answer(null, "Maybe tomorrow instead");
  const last = f.sent[f.sent.length - 1];
  check("answer: a few written words go back with answer null", last.type === "reply" && last.replyTo === q.id && last.answer === null && last.text === "Maybe tomorrow instead");
  c.answer("no");
  check("answer: a second answer to the same message is not sent", f.sent.filter((d) => d.type === "reply").length === 1);
}
{
  const f = fakeClient();
  const c = createMessagesContact(f.port);
  c.onChange(() => {});
  c.answer("yes");
  check("answer: without a reply nothing is sent", f.sent.length === 0);
}

// --- What home shows ------------------------------------------------------------------
{
  const f = fakeClient();
  check("home: nothing before anything arrives", pendingMessage(f.port.snapshot()) === null);
  const a = f.greet("Thinking of you", "greeting");
  check("home: a greeting waits for an answer", pendingMessage(f.port.snapshot())?.id === a.id);
  const b = f.greet("Walk after lunch?");
  const p = pendingMessage(f.port.snapshot());
  check("home: only the newest unanswered one is shown", p?.id === b.id && p.text === "Walk after lunch?" && p.fromName === "Sara");
  f.trustedReply(b.id);
  check("home: the trusted person's own reply does not count as an answer", pendingMessage(f.port.snapshot())?.id === b.id);
  f.port.sendReply(b.id, "no");
  check("home: answered (still sending) means done, and the older one is not brought back", pendingMessage(f.port.snapshot()) === null);
  check("home: answerTo reads the answer", answerTo(f.port.snapshot(), b.id)?.answer === "no");
  f.setStatus(0, "not sent");
  check("home: a refused answer shows the message again", pendingMessage(f.port.snapshot())?.id === b.id);
  const t = fakeClient({ role: "trusted" });
  t.greet("Hello");
  check("home: never on the trusted person's side", pendingMessage(t.port.snapshot()) === null);
  const e = fakeClient();
  e.greet("Hello");
  e.end();
  check("home: nothing once the pair has ended", pendingMessage(e.port.snapshot()) === null);
  check("state: not connected without a pair", contactState(fakeClient({ paired: false }).port.snapshot()).status === "not-connected");
  check("state: the trusted person's name, or null before they open the invite", contactState(fakeClient({ trustedName: null }).port.snapshot()).trustedName === null && contactState(fakeClient().port.snapshot()).trustedName === "Sara");
}

globalThis.fetch = realFetch;
check("no network call from the adapter", fetched === 0);

if (failed) {
  console.log(`${failed} failed`);
  process.exit(1);
}
console.log("contact: all passed");
