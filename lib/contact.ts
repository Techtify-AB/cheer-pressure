// The seam for reaching someone the person trusts (ladder step 2), and for the few words that
// person sends from their own phone.
//
// Two implementations of `Contact`:
//
// - createMessagesContact: the real one, on top of lib/messages.ts. The request goes into the
//   messages client's local outbox and on to the messages service; its delivery status
//   ("sending", "sent", "waiting for connection") comes from the outbox. The trusted person's
//   reply is the newest greeting or question they send after it, and the person's Yes, No or
//   few words go back with sendReply. Only these short texts ever reach the service.
// - createLocalContact: a local stand-in, used only when no pair exists. It never touches the
//   network. In demo mode it makes up a reply after a few seconds, marked `simulated`, and the
//   screen says so plainly; outside demo mode nothing ever happens.
//
// chooseContact picks: the real one when a pair exists, otherwise the stand-in. With several
// people (lib/trusted.ts), each has their own pair and client, so the ladder makes one Contact
// per person asked, and each request, reply and answer stays with that person.
//
// The pure functions at the bottom (pendingMessage, contactState) read a messages snapshot, so
// home, the mascot and the ladder agree on what is waiting for an answer.

import type { Answer } from "./events";
import type { Outgoing, OutgoingStatus, Pairing, Snapshot } from "./messages";

export type ContactStatus =
  | "not-connected"
  | "ready"
  | "sending"
  | "sent"
  | "waiting for connection"
  | "not sent"
  | "replied";

/** A greeting or question from the trusted person. */
export interface ContactReply {
  /** The event id to answer. Null for the stand-in's made-up reply. */
  id: string | null;
  text: string;
  kind: "greeting" | "question";
  /** The trusted person's first name, as they typed it. */
  fromName: string | null;
  /** True for the stand-in's made-up reply. */
  simulated: boolean;
  at: string; // ISO
}

export interface ContactAnswer {
  answer: Answer | null;
  text: string;
  status: OutgoingStatus;
}

export interface ContactState {
  status: ContactStatus;
  /** The reply to the newest request, once it arrived. */
  reply: ContactReply | null;
  /** What the person answered to that reply, once they did. */
  answered: ContactAnswer | null;
  /** The trusted person's first name, once they opened the invite. */
  trustedName: string | null;
}

export interface Contact {
  /** True when a pair exists, so a request really goes to someone. */
  readonly connected: boolean;
  /** True for the stand-in: nothing is sent, and any reply is made up. */
  readonly simulated: boolean;
  /** Asks the trusted person to get in touch. Returns at once; delivery runs in the background. */
  requestContact(): Promise<void>;
  /** Calls back at once and on every change. Returns a function that stops listening. */
  onChange(callback: (state: ContactState) => void): () => void;
  /** Called when the trusted person replies. Returns a function that stops listening. */
  onReply(callback: (reply: ContactReply) => void): () => void;
  /** Answers the reply: yes, no, or a few written words (answer null). */
  answer(answer: Answer | null, text?: string): void;
  state(): ContactState;
  status(): ContactStatus;
}

export const SIMULATED_REPLY = "Walk after lunch?";
export const SIMULATED_REPLY_AFTER_MS = 3500;
/** The request at step two (the same text as the messages client's default). */
export const CONTACT_REQUEST_TEXT = "Could we talk or meet up soon?";

/** The part of the messages client (lib/messages.ts) the real contact uses. Tests pass a fake. */
export interface MessagesPort {
  pairing(): Pairing | null;
  snapshot(): Snapshot;
  subscribe(callback: (s: Snapshot) => void): () => void;
  sendContactRequest(text?: string): Outgoing;
  sendReply(replyTo: string, answer: Answer | null, text?: string): Outgoing;
}

// --- Reading a snapshot ------------------------------------------------------------------

/**
 * The status to show for an outbox item. The outbox delivers oldest first, so an item queued
 * behind one that is waiting for a connection is waiting too, even before its own first try.
 */
function shown(s: Snapshot, status: OutgoingStatus): OutgoingStatus {
  if (status !== "sending") return status;
  if (s.connection === "offline" || s.outbox.some((o) => o.status === "waiting for connection")) return "waiting for connection";
  return status;
}

interface OwnReply {
  replyTo: string;
  answer: Answer | null;
  text: string;
  status: OutgoingStatus;
  ts: string;
}

/** The person's own replies, confirmed or still in the outbox. A refused one ("not sent") does not count. */
function ownReplies(s: Snapshot): OwnReply[] {
  const out: OwnReply[] = [];
  for (const e of s.events) {
    if (e.type === "reply" && e.from.role === "user") out.push({ replyTo: e.replyTo, answer: e.answer, text: e.text, status: "sent", ts: e.ts });
  }
  for (const o of s.outbox) {
    if (o.draft.type === "reply" && o.status !== "not sent") {
      out.push({ replyTo: o.draft.replyTo, answer: o.draft.answer, text: o.draft.text, status: shown(s, o.status), ts: o.createdAt });
    }
  }
  return out;
}

function toReply(s: Snapshot, e: Snapshot["events"][number]): ContactReply | null {
  if (e.type !== "greeting") return null;
  return { id: e.id, text: e.text, kind: e.kind, fromName: e.from.name || s.trustedName, simulated: false, at: e.ts };
}

/** The newest greeting or question from the trusted person, whether answered or not. */
function newestGreeting(s: Snapshot, after?: string): ContactReply | null {
  for (let i = s.events.length - 1; i >= 0; i--) {
    const e = s.events[i];
    if (e.type !== "greeting") continue;
    if (after && Date.parse(e.ts) < Date.parse(after)) return null;
    return toReply(s, e);
  }
  return null;
}

/** What the person answered to a message, if they did. */
export function answerTo(s: Snapshot, id: string): ContactAnswer | null {
  const mine = ownReplies(s).filter((r) => r.replyTo === id);
  const last = mine[mine.length - 1];
  return last ? { answer: last.answer, text: last.text, status: last.status } : null;
}

/**
 * The one message to show: the newest greeting or question from the trusted person, if the
 * person has not answered it yet. Older ones are never shown; the conversation history stays
 * out of the interface. Only on the person's own device (role "user").
 */
export function pendingMessage(s: Snapshot | null | undefined): ContactReply | null {
  if (!s?.pairing || s.pairing.role !== "user" || s.connection === "ended") return null;
  const g = newestGreeting(s);
  if (!g || !g.id) return null;
  return answerTo(s, g.id) ? null : g;
}

/** The newest contact request this device sent, with its delivery status. */
function newestRequest(s: Snapshot): { at: string; status: OutgoingStatus } | null {
  let best: { at: string; status: OutgoingStatus } | null = null;
  const consider = (at: string, status: OutgoingStatus) => {
    if (!best || Date.parse(at) >= Date.parse(best.at)) best = { at, status };
  };
  for (const e of s.events) if (e.type === "contact_request" && e.from.role === "user") consider(e.ts, "sent");
  for (const o of s.outbox) if (o.draft.type === "contact_request") consider(o.createdAt, shown(s, o.status));
  return best;
}

/** Where the newest request stands: its delivery status, the reply to it, and the answer to that. */
export function contactState(s: Snapshot | null | undefined): ContactState {
  if (!s?.pairing || s.connection === "ended") return { status: "not-connected", reply: null, answered: null, trustedName: null };
  const req = newestRequest(s);
  if (!req) return { status: "ready", reply: null, answered: null, trustedName: s.trustedName };
  const reply = req.status === "sent" ? newestGreeting(s, req.at) : null;
  const answered = reply?.id ? answerTo(s, reply.id) : null;
  return { status: reply ? "replied" : req.status, reply, answered, trustedName: s.trustedName };
}

// --- The real one ------------------------------------------------------------------------

export function createMessagesContact(client: MessagesPort): Contact {
  let snap: Snapshot = client.snapshot();
  const listeners = new Set<(s: ContactState) => void>();
  const replyListeners = new Set<(r: ContactReply) => void>();
  let lastReplyId: string | null = contactState(snap).reply?.id ?? null;
  let stop: (() => void) | null = null;

  const emit = () => {
    const st = contactState(snap);
    listeners.forEach((l) => l(st));
    if (st.reply && st.reply.id !== lastReplyId) {
      lastReplyId = st.reply.id;
      replyListeners.forEach((l) => l(st.reply!));
    }
  };

  const follow = () => {
    if (stop) return;
    stop = client.subscribe((s) => {
      snap = s;
      emit();
    });
  };
  const unfollowIfIdle = () => {
    if (listeners.size || replyListeners.size) return;
    stop?.();
    stop = null;
  };

  return {
    get connected() {
      return !!client.pairing();
    },
    simulated: false,
    async requestContact() {
      client.sendContactRequest(CONTACT_REQUEST_TEXT);
      snap = client.snapshot();
      emit();
    },
    onChange(callback) {
      listeners.add(callback);
      follow();
      callback(contactState(snap));
      return () => {
        listeners.delete(callback);
        unfollowIfIdle();
      };
    },
    onReply(callback) {
      replyListeners.add(callback);
      follow();
      const r = contactState(snap).reply;
      if (r) callback(r);
      return () => {
        replyListeners.delete(callback);
        unfollowIfIdle();
      };
    },
    answer(answer, text) {
      const st = contactState(snap);
      const r = st.reply;
      // One answer per message: a second tap does not send it twice.
      if (!r?.id || st.answered) return;
      client.sendReply(r.id, answer, text);
      snap = client.snapshot();
      emit();
    },
    state: () => contactState(snap),
    status: () => contactState(snap).status,
  };
}

// --- The local stand-in ------------------------------------------------------------------

/** The local stand-in. `demo` makes it simulate a reply; otherwise nothing ever happens. */
export function createLocalContact({ demo, replyAfterMs = SIMULATED_REPLY_AFTER_MS }: { demo: boolean; replyAfterMs?: number }): Contact {
  let state: ContactState = { status: "not-connected", reply: null, answered: null, trustedName: null };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(s: ContactState) => void>();
  const replyListeners = new Set<(r: ContactReply) => void>();
  const set = (next: Partial<ContactState>) => {
    state = { ...state, ...next };
    listeners.forEach((l) => l(state));
  };

  return {
    connected: false,
    simulated: true,
    async requestContact() {
      if (!demo || timer) return;
      timer = setTimeout(() => {
        const reply: ContactReply = { id: null, text: SIMULATED_REPLY, kind: "question", fromName: null, simulated: true, at: new Date().toISOString() };
        set({ status: "replied", reply });
        replyListeners.forEach((l) => l(reply));
      }, replyAfterMs);
    },
    onChange(callback) {
      listeners.add(callback);
      callback(state);
      return () => {
        listeners.delete(callback);
      };
    },
    onReply(callback) {
      replyListeners.add(callback);
      if (state.reply) callback(state.reply);
      return () => {
        replyListeners.delete(callback);
      };
    },
    answer(answer, text) {
      if (!state.reply) return;
      // Kept on this device only: there is nobody to send it to.
      set({ answered: { answer, text: text ?? (answer === "yes" ? "Yes" : answer === "no" ? "No" : ""), status: "not sent" } });
    },
    state: () => state,
    status: () => state.status,
  };
}

/** The real contact when a pair exists; otherwise the stand-in (with a made-up reply only in demo mode). */
export function chooseContact({ client, demo, replyAfterMs }: { client: MessagesPort | null; demo: boolean; replyAfterMs?: number }): Contact {
  const s = client?.snapshot();
  if (client && s?.pairing && s.connection !== "ended") return createMessagesContact(client);
  return createLocalContact({ demo, replyAfterMs });
}
