/*
  Cheer Pressure messages: a small client for the messages service. No UI.

  Local first. Everything renders from what is stored on this device:
  - Outgoing messages go into a local outbox first and come back at once with status
    "sending". Delivery runs in the background with retry and backoff; the status becomes
    "sent", or "waiting for connection" after repeated failures. Nothing is dropped: waiting
    messages are retried on a timer, when the page becomes visible and when the network returns.
    Each message carries a clientId, and the service treats a repeated clientId as the same
    message, so a retry never creates a duplicate.
  - Received messages are cached, so subscribe() hands over the conversation at once on load,
    before the first poll has answered.
  - Polling runs every 1.5 s while the page is visible, right away after a send and when the
    page becomes visible again, with exponential backoff while the network is down.

  Storage: one localStorage key per client (default "cheerpressure.messages.v1"), holding the
  pair, its token, the cached messages and the outbox. Nothing about health is ever sent: only
  the short texts defined in ./events.

  Safe to import during static export: nothing touches window, document or localStorage until
  a function is called. Nothing Tauri-specific is imported.

  `server/lib/messages.ts` is a byte-for-byte copy used by the phone pages
  (scripts/test-messages.mts checks that they are identical). Edit this one, then copy it.
*/
import {
  checkName,
  checkText,
  newClientId,
  validateEvent,
  type Answer,
  type EventDraft,
  type MessageEvent,
  type Role,
} from "./events";

export const DEFAULT_STORAGE_KEY = "cheerpressure.messages.v1";
export const POLL_MS = 1500;
const MAX_POLL_BACKOFF_MS = 60_000;
const MAX_SEND_BACKOFF_MS = 30_000;
const ATTEMPTS_BEFORE_WAITING = 3;
const CACHE_LIMIT = 200;

export type OutgoingStatus = "sending" | "sent" | "waiting for connection" | "not sent";
export type Connection = "online" | "offline" | "ended";

export interface Outgoing {
  clientId: string;
  draft: EventDraft;
  createdAt: string;
  status: OutgoingStatus;
  attempts: number;
  nextAttemptAt: number;
  /** Set when status is "not sent": the service refused it and retrying cannot help. */
  error?: string;
}

export interface Pairing {
  baseUrl: string;
  pair: string;
  role: Role;
  token: string;
  /** Only on the device that created the pair. */
  inviteUrl?: string;
  userUrl?: string;
  expiresAt?: string;
}

interface Saved extends Pairing {
  v: 1;
  trustedName: string | null;
  lastId: string | null;
  events: MessageEvent[];
  outbox: Outgoing[];
  ended: boolean;
}

export interface Snapshot {
  pairing: Pairing | null;
  trustedName: string | null;
  /** Cached and received messages, oldest first. */
  events: MessageEvent[];
  /** Own messages not yet confirmed by the service ("sending", "waiting for connection", "not sent"). */
  outbox: Outgoing[];
  connection: Connection;
  /** Messages that arrived since the previous snapshot this subscriber saw. Empty for the cached first one. */
  newEvents: MessageEvent[];
  /** True for the snapshot built from the local cache only, before any poll. */
  fromCache: boolean;
}

export interface TimelineItem {
  key: string;
  own: boolean;
  status: OutgoingStatus;
  type: EventDraft["type"];
  text: string;
  kind?: "greeting" | "question";
  answer?: Answer | null;
  replyTo?: string | null;
  id: string | null;
  ts: string;
  fromName?: string;
  error?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ClientOptions {
  baseUrl?: string;
  storageKey?: string;
  storage?: StorageLike;
  fetch?: typeof fetch;
  pollMs?: number;
  /** Whether polling should run now. Defaults to the page's visibility. */
  isVisible?: () => boolean;
}

export class MessagesError extends Error {
  constructor(
    public kind: "network" | "http" | "not-paired",
    public status = 0,
    message: string = kind,
  ) {
    super(message);
  }
}

function envBaseUrl(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_MESSAGES_URL || undefined;
  } catch {
    return undefined;
  }
}

export function defaultBaseUrl(): string {
  return envBaseUrl() ?? "http://localhost:3480";
}

function memoryStorage(): StorageLike {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

function browserStorage(): StorageLike {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Storage can be blocked (private mode, sandboxed frame). Fall back to memory.
  }
  return memoryStorage();
}

const transient = (status: number) => status === 0 || status === 408 || status === 429 || status >= 500;

/** Builds a client. Most apps use the default functions at the bottom of this file. */
export function createMessagesClient(options: ClientOptions = {}) {
  const key = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const pollMs = options.pollMs ?? POLL_MS;
  let storage: StorageLike | null = options.storage ?? null;
  const store = () => (storage ??= browserStorage());
  const doFetch: typeof fetch = (input, init) => (options.fetch ?? fetch)(input, init);
  const isVisible =
    options.isVisible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");

  let connection: Connection = "online";
  const listeners = new Set<{ cb: (s: Snapshot) => void; seen: Set<string> }>();
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollFailures = 0;
  let polling = false;
  let pollAgain = false;
  let sendTimer: ReturnType<typeof setTimeout> | null = null;
  let delivering = false;
  let deliverAgain = false;
  let detach: (() => void) | null = null;

  // --- Local state ----------------------------------------------------------------------

  function load(): Saved | null {
    try {
      const raw = store().getItem(key);
      if (!raw) return null;
      const s = JSON.parse(raw) as Saved;
      if (s?.v !== 1 || typeof s.pair !== "string" || typeof s.token !== "string") return null;
      s.events = (s.events ?? []).filter((e) => validateEvent(e).ok);
      s.outbox = s.outbox ?? [];
      return s;
    } catch {
      return null;
    }
  }

  function save(s: Saved) {
    try {
      store().setItem(key, JSON.stringify(s));
    } catch {
      // Full or blocked storage: keep going in memory for this session.
    }
  }

  function mustLoad(): Saved {
    const s = load();
    if (!s) throw new MessagesError("not-paired", 0, "no pair on this device");
    return s;
  }

  function begin(p: Pairing, trustedName: string | null = null) {
    const s: Saved = { v: 1, ...p, trustedName, lastId: null, events: [], outbox: [], ended: false };
    save(s);
    connection = "online";
    emit([]);
    return toPairing(s);
  }

  const toPairing = (s: Saved): Pairing => ({
    baseUrl: s.baseUrl,
    pair: s.pair,
    role: s.role,
    token: s.token,
    inviteUrl: s.inviteUrl,
    userUrl: s.userUrl,
    expiresAt: s.expiresAt,
  });

  function merge(s: Saved, incoming: unknown[]): MessageEvent[] {
    const added: MessageEvent[] = [];
    const ids = new Set(s.events.map((e) => e.id));
    for (const raw of incoming) {
      const r = validateEvent(raw);
      if (!r.ok || r.value.pair !== s.pair || ids.has(r.value.id)) continue;
      ids.add(r.value.id);
      s.events.push(r.value);
      added.push(r.value);
      s.outbox = s.outbox.filter((o) => o.clientId !== r.value.clientId);
    }
    if (s.events.length > CACHE_LIMIT) s.events = s.events.slice(-CACHE_LIMIT);
    if (incoming.length) {
      const last = validateEvent(incoming[incoming.length - 1]);
      if (last.ok) s.lastId = last.value.id;
    }
    return added;
  }

  function snapshot(fromCache = false): Snapshot {
    const s = load();
    return {
      pairing: s ? toPairing(s) : null,
      trustedName: s?.trustedName ?? null,
      events: s?.events ?? [],
      outbox: s?.outbox ?? [],
      connection: s?.ended ? "ended" : connection,
      newEvents: [],
      fromCache,
    };
  }

  function emit(added: MessageEvent[]) {
    if (!listeners.size) return;
    const snap = snapshot();
    for (const l of listeners) {
      const fresh = added.filter((e) => !l.seen.has(e.id));
      for (const e of fresh) l.seen.add(e.id);
      l.cb({ ...snap, newEvents: fresh });
    }
  }

  function markEnded() {
    const s = load();
    if (!s) return;
    s.ended = true;
    for (const o of s.outbox) if (o.status !== "not sent") Object.assign(o, { status: "not sent", error: "this pairing has ended" });
    save(s);
    connection = "ended";
    stopPolling();
  }

  // --- Network ------------------------------------------------------------------------

  async function request(s: Pairing, method: string, path: string, body?: unknown, token = s.token) {
    let res: Response;
    try {
      res = await doFetch(s.baseUrl.replace(/\/+$/, "") + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch {
      throw new MessagesError("network");
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = (data as { error?: string } | null)?.error ?? `status ${res.status}`;
      throw new MessagesError("http", res.status, msg);
    }
    return data as Record<string, unknown>;
  }

  async function poll(since?: string) {
    const s = mustLoad();
    const q = since ?? s.lastId;
    let data: Record<string, unknown>;
    try {
      data = await request(s, "GET", `/api/pairs/${s.pair}/events${q ? `?since=${encodeURIComponent(q)}` : ""}`);
    } catch (e) {
      if (e instanceof MessagesError && (e.status === 401 || e.status === 404)) {
        markEnded();
        emit([]);
      }
      throw e;
    }
    const fresh = load() ?? s;
    const added = merge(fresh, Array.isArray(data.events) ? data.events : []);
    fresh.trustedName = typeof data.trustedName === "string" ? data.trustedName : null;
    if (typeof data.expiresAt === "string") fresh.expiresAt = data.expiresAt;
    save(fresh);
    connection = "online";
    emit(added);
    return { events: added, trustedName: fresh.trustedName, serverTime: String(data.serverTime ?? "") };
  }

  // --- Outbox -------------------------------------------------------------------------

  function enqueue(draft: EventDraft): Outgoing {
    const s = mustLoad();
    if (s.ended) throw new MessagesError("http", 404, "this pairing has ended");
    const item: Outgoing = {
      clientId: draft.clientId,
      draft,
      createdAt: new Date().toISOString(),
      status: "sending",
      attempts: 0,
      nextAttemptAt: 0,
    };
    s.outbox.push(item);
    save(s);
    emit([]);
    queueMicrotask(() => void deliver());
    return { ...item };
  }

  function scheduleDeliver(ms: number) {
    if (sendTimer) clearTimeout(sendTimer);
    sendTimer = setTimeout(() => {
      sendTimer = null;
      void deliver();
    }, ms);
    (sendTimer as { unref?: () => void }).unref?.();
  }

  /** Tries to deliver everything waiting in the outbox, oldest first. */
  async function deliver(force = false): Promise<void> {
    if (delivering) {
      deliverAgain = true;
      return;
    }
    delivering = true;
    let delivered = false;
    try {
      for (;;) {
        const s = load();
        if (!s || s.ended) return;
        const now = Date.now();
        const next = s.outbox.find((o) => o.status !== "not sent");
        if (!next) break;
        if (!force && next.nextAttemptAt > now) {
          scheduleDeliver(next.nextAttemptAt - now);
          break;
        }
        try {
          const data = await request(s, "POST", `/api/pairs/${s.pair}/events`, next.draft);
          const fresh = load() ?? s;
          // Delivered: the confirmed event replaces the outbox item.
          fresh.outbox = fresh.outbox.filter((o) => o.clientId !== next.clientId);
          const ev = validateEvent(data.event);
          if (ev.ok && !fresh.events.some((e) => e.id === ev.value.id)) fresh.events.push(ev.value);
          save(fresh);
          delivered = true;
          emit([]);
        } catch (e) {
          const err = e instanceof MessagesError ? e : new MessagesError("network");
          const fresh = load() ?? s;
          const item = fresh.outbox.find((o) => o.clientId === next.clientId);
          if (!item) continue;
          if (err.status === 401 || err.status === 404) {
            save(fresh);
            markEnded();
            emit([]);
            return;
          }
          if (err.kind === "http" && !transient(err.status)) {
            item.status = "not sent";
            item.error = err.message;
            save(fresh);
            emit([]);
            continue;
          }
          item.attempts += 1;
          const wait = Math.min(1000 * 2 ** (item.attempts - 1), MAX_SEND_BACKOFF_MS) * (0.8 + Math.random() * 0.4);
          item.nextAttemptAt = Date.now() + wait;
          item.status = item.attempts >= ATTEMPTS_BEFORE_WAITING ? "waiting for connection" : "sending";
          save(fresh);
          if (err.kind === "network") connection = "offline";
          emit([]);
          scheduleDeliver(wait);
          break;
        }
        force = false;
      }
    } finally {
      delivering = false;
      if (deliverAgain) {
        deliverAgain = false;
        queueMicrotask(() => void deliver());
      }
    }
    if (delivered) kick();
  }

  // --- Polling ------------------------------------------------------------------------

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedulePoll(ms: number) {
    stopPolling();
    if (!listeners.size) return;
    pollTimer = setTimeout(() => void tick(), ms);
    (pollTimer as { unref?: () => void }).unref?.();
  }

  async function tick() {
    pollTimer = null;
    if (!listeners.size || !isVisible()) return;
    const s = load();
    if (!s || s.ended) return;
    if (polling) {
      pollAgain = true;
      return;
    }
    polling = true;
    try {
      await poll();
      pollFailures = 0;
      schedulePoll(pollMs);
    } catch (e) {
      if (load()?.ended) return;
      pollFailures += 1;
      if (e instanceof MessagesError && e.kind === "network" && connection !== "offline") {
        connection = "offline";
        emit([]);
      }
      schedulePoll(Math.min(pollMs * 2 ** pollFailures, MAX_POLL_BACKOFF_MS));
    } finally {
      polling = false;
      if (pollAgain) {
        pollAgain = false;
        void tick();
      }
    }
  }

  /** Poll now (after a send, on becoming visible, on reconnect). */
  function kick() {
    if (!listeners.size) return;
    pollFailures = 0;
    stopPolling();
    void tick();
  }

  function attach() {
    if (detach || typeof window === "undefined") return;
    const onVisible = () => {
      if (!isVisible()) return stopPolling();
      void deliver(true);
      kick();
    };
    const onOnline = () => {
      void deliver(true);
      kick();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("focus", onVisible);
    detach = () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("focus", onVisible);
      detach = null;
    };
  }

  // --- Public API ---------------------------------------------------------------------

  return {
    /** The person's device creates a pair. Returns the links to share. */
    async createPair(baseUrl = options.baseUrl ?? defaultBaseUrl()): Promise<Pairing> {
      const data = await request({ baseUrl, pair: "", role: "user", token: "" }, "POST", "/api/pairs", {}, "");
      return begin({
        baseUrl,
        pair: String(data.pair),
        role: "user",
        token: String(data.userToken),
        inviteUrl: String(data.inviteUrl),
        userUrl: String(data.userUrl),
        expiresAt: String(data.expiresAt),
      });
    },

    /** The trusted person joins with the invite. */
    async join(baseUrl: string, pair: string, inviteToken: string, name: string): Promise<Pairing> {
      const n = checkName(name);
      if (!n.ok) throw new MessagesError("http", 400, n.error);
      const data = await request({ baseUrl, pair, role: "trusted", token: "" }, "POST", `/api/pairs/${pair}/join`, { inviteToken, name: n.value }, "");
      return begin({ baseUrl, pair, role: "trusted", token: String(data.trustedToken) }, String(data.name ?? n.value));
    },

    /** Uses a pair and token this device already has (for example from a link). Keeps the cache if it is the same pair. */
    adopt(p: Pairing): Pairing {
      const s = load();
      if (s && s.pair === p.pair && s.token === p.token) return toPairing(s);
      return begin(p);
    },

    pairing: (): Pairing | null => {
      const s = load();
      return s ? toPairing(s) : null;
    },

    snapshot: () => snapshot(true),

    poll,

    /** Answer or reply to a message from the other person. Returns at once with status "sending". */
    sendReply(replyTo: string, answer: Answer | null, text?: string): Outgoing {
      const t = checkText(text ?? (answer === "yes" ? "Yes" : answer === "no" ? "No" : ""));
      if (!t.ok) throw new MessagesError("http", 400, t.error);
      return enqueue({ type: "reply", clientId: newClientId(), replyTo, answer, text: t.value });
    },

    /** The person asks the trusted person to get in touch. */
    sendContactRequest(text = "Could you get in touch when you have a moment?"): Outgoing {
      const t = checkText(text);
      if (!t.ok) throw new MessagesError("http", 400, t.error);
      return enqueue({ type: "contact_request", clientId: newClientId(), text: t.value });
    },

    /** The trusted person sends a greeting, or a question the person can answer yes or no. */
    sendGreeting(text: string, kind: "greeting" | "question"): Outgoing {
      const t = checkText(text);
      if (!t.ok) throw new MessagesError("http", 400, t.error);
      return enqueue({ type: "greeting", clientId: newClientId(), text: t.value, kind });
    },

    /** Retry everything waiting in the outbox now. */
    flush: () => deliver(true),

    /** Deletes the pair on the service and everything about it on this device. */
    async deletePair(): Promise<void> {
      const s = load();
      if (!s) return;
      try {
        await request(s, "DELETE", `/api/pairs/${s.pair}`);
      } catch (e) {
        // Already gone on the service is fine; anything else is reported and nothing is removed.
        if (!(e instanceof MessagesError && e.status === 404)) throw e;
      }
      store().removeItem(key);
      stopPolling();
      emit([]);
    },

    /** Removes the pair from this device only. */
    forget() {
      store().removeItem(key);
      stopPolling();
      emit([]);
    },

    /**
     * Calls back at once with the cached conversation (fromCache: true), then on every change.
     * Polls every 1.5 s while the page is visible. Returns a function that stops it.
     */
    subscribe(cb: (s: Snapshot) => void): () => void {
      const first = snapshot(true);
      const entry = { cb, seen: new Set(first.events.map((e) => e.id)) };
      listeners.add(entry);
      cb(first);
      attach();
      void deliver();
      kick();
      return () => {
        listeners.delete(entry);
        if (!listeners.size) {
          stopPolling();
          detach?.();
        }
      };
    },
  };
}

export type MessagesClient = ReturnType<typeof createMessagesClient>;

/** Own and received messages in one list, oldest first, with a delivery status for each. */
export function timeline(s: Snapshot): TimelineItem[] {
  const role = s.pairing?.role;
  const items: TimelineItem[] = s.events.map((e) => ({
    key: e.clientId,
    own: e.from.role === role,
    status: "sent",
    type: e.type,
    text: e.text,
    kind: e.type === "greeting" ? e.kind : undefined,
    answer: e.type === "reply" ? e.answer : undefined,
    replyTo: e.type === "reply" ? e.replyTo : null,
    id: e.id,
    ts: e.ts,
    fromName: e.type === "greeting" ? e.from.name : undefined,
  }));
  for (const o of s.outbox) {
    items.push({
      key: o.clientId,
      own: true,
      status: o.status,
      type: o.draft.type,
      text: o.draft.text,
      kind: o.draft.type === "greeting" ? o.draft.kind : undefined,
      answer: o.draft.type === "reply" ? o.draft.answer : undefined,
      replyTo: o.draft.type === "reply" ? o.draft.replyTo : null,
      id: null,
      ts: o.createdAt,
      error: o.error,
    });
  }
  // Stable sort by time: own messages confirmed locally can land in the cache before older ones.
  return items.map((it, i) => ({ it, i })).sort((a, b) => Date.parse(a.it.ts) - Date.parse(b.it.ts) || a.i - b.i).map((x) => x.it);
}

// --- Default client for the desktop app, created on first use --------------------------

let shared: MessagesClient | null = null;
const client = () => (shared ??= createMessagesClient());

export const createPair = (baseUrl?: string) => client().createPair(baseUrl);
export const poll = (since?: string) => client().poll(since);
export const sendReply = (replyTo: string, answer: Answer | null, text?: string) => client().sendReply(replyTo, answer, text);
export const sendContactRequest = (text?: string) => client().sendContactRequest(text);
export const deletePair = () => client().deletePair();
export const subscribe = (cb: (s: Snapshot) => void) => client().subscribe(cb);
export const getPairing = () => client().pairing();
export const flushOutbox = () => client().flush();
