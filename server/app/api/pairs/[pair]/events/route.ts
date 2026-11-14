import { EVENT_VERSION, canSend, isValidId, parseDraft, type MessageEvent } from "../../../../../lib/events";
import {
  EVENT_CAP,
  EVENTS_PER_MINUTE,
  authorize,
  error,
  guarded,
  json,
  newEventId,
  preflight,
  readJson,
  store,
} from "../../../../../lib/service";

type Ctx = { params: Promise<{ pair: string }> };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

// GET /api/pairs/[pair]/events?since=<event id or ISO time>
// Cheap by design, for polling every 1.5 s: one read of the pair and one of its events.
export const GET = guarded(async (req: Request, ctx: Ctx) => {
  const { pair } = await ctx.params;
  const auth = await authorize(req, pair);
  if (auth instanceof Response) return auth;
  const since = new URL(req.url).searchParams.get("since");
  const all = await store().listEvents(pair, Date.now());
  let events = all;
  if (since) {
    if (ISO_RE.test(since) && !Number.isNaN(Date.parse(since))) {
      const t = Date.parse(since);
      events = all.filter((e) => Date.parse(e.ts) > t);
    } else if (isValidId(since)) {
      const at = all.findIndex((e) => e.id === since);
      // An unknown id (for example from before a restart) returns everything; clients dedupe by id.
      events = at === -1 ? all : all.slice(at + 1);
    } else {
      return error(req, 400, "since must be an event id or an ISO time");
    }
  }
  return json(req, 200, {
    events,
    role: auth.role,
    trustedName: auth.rec.trustedName,
    serverTime: new Date().toISOString(),
    expiresAt: new Date(auth.rec.expiresAt).toISOString(),
  });
});

// POST /api/pairs/[pair]/events: one greeting, reply or contact request.
// The server sets v, id, ts, pair and from. A repeated clientId returns the original event (200).
export const POST = guarded(async (req: Request, ctx: Ctx) => {
  const { pair } = await ctx.params;
  const auth = await authorize(req, pair);
  if (auth instanceof Response) return auth;
  const parsed = parseDraft(await readJson(req));
  if (!parsed.ok) return error(req, 400, parsed.error);
  const draft = parsed.value;
  if (!canSend(auth.role, draft.type)) return error(req, 403, `${auth.role} cannot send ${draft.type}`);

  const now = Date.now();
  const existing = await store().listEvents(pair, now);
  const same = existing.find((e) => e.clientId === draft.clientId);
  if (same) return json(req, 200, { event: same, duplicate: true });

  const base = { v: EVENT_VERSION, id: newEventId(), ts: new Date(now).toISOString(), pair, clientId: draft.clientId };
  let event: MessageEvent;
  if (draft.type === "greeting") {
    if (!auth.rec.trustedName) return error(req, 403, "join the pair first");
    event = { ...base, type: "greeting", from: { role: "trusted", name: auth.rec.trustedName }, text: draft.text, kind: draft.kind, replyTo: null };
  } else if (draft.type === "reply") {
    const target = existing.find((e) => e.id === draft.replyTo);
    if (!target) return error(req, 400, "replyTo does not match a message in this pair");
    if (target.from.role === auth.role) return error(req, 400, "replyTo must be a message from the other person");
    if (draft.answer !== null && !(target.type === "greeting" && target.kind === "question")) {
      return error(req, 400, "yes or no only answers a question");
    }
    event = { ...base, type: "reply", from: { role: auth.role }, replyTo: draft.replyTo, answer: draft.answer, text: draft.text };
  } else {
    event = { ...base, type: "contact_request", from: { role: "user" }, text: draft.text };
  }

  const r = await store().appendEvent(pair, event, { perMinute: EVENTS_PER_MINUTE, cap: EVENT_CAP, now });
  switch (r.status) {
    case "ok":
      return json(req, 201, { event: r.event, duplicate: false });
    case "duplicate":
      return json(req, 200, { event: r.event, duplicate: true });
    case "rate_limited":
      return error(req, 429, "too many messages, wait a minute", { "Retry-After": "60" });
    case "full":
      return error(req, 403, `this pair has reached its limit of ${EVENT_CAP} messages`);
    case "missing":
      return error(req, 404, "pair not found");
    case "retry":
      return error(req, 503, "busy, try again", { "Retry-After": "1" });
  }
});

export const OPTIONS = (req: Request) => preflight(req);
