// The seam for reaching someone the person trusts (ladder step 2).
//
// The real service is being built separately and will be wired in later by writing
// another implementation of `Contact`. For now the only implementation is a local
// stand-in: it never touches the network. In demo mode it simulates a reply after a
// few seconds, and the screen says so plainly.

export type ContactStatus = "not-connected" | "requested" | "replied";

export interface ContactReply {
  text: string;
  /** True for the stand-in's made-up reply. */
  simulated: boolean;
  at: string; // ISO
}

export interface Contact {
  /** False until a real service is connected. */
  readonly connected: boolean;
  /** Asks the trusted person to check in. The stand-in sends nothing. */
  requestContact(): Promise<void>;
  /** Called when the trusted person replies. Returns a function that stops listening. */
  onReply(callback: (reply: ContactReply) => void): () => void;
  status(): ContactStatus;
}

export const SIMULATED_REPLY = "Walk after lunch?";
export const SIMULATED_REPLY_AFTER_MS = 3500;

/** The local stand-in. `demo` makes it simulate a reply; otherwise nothing ever happens. */
export function createLocalContact({ demo, replyAfterMs = SIMULATED_REPLY_AFTER_MS }: { demo: boolean; replyAfterMs?: number }): Contact {
  let state: ContactStatus = "not-connected";
  let reply: ContactReply | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(r: ContactReply) => void>();

  return {
    connected: false,
    async requestContact() {
      state = "requested";
      if (!demo || timer) return;
      timer = setTimeout(() => {
        reply = { text: SIMULATED_REPLY, simulated: true, at: new Date().toISOString() };
        state = "replied";
        listeners.forEach((l) => l(reply!));
      }, replyAfterMs);
    },
    onReply(callback) {
      listeners.add(callback);
      if (reply) callback(reply);
      return () => {
        listeners.delete(callback);
      };
    },
    status: () => state,
  };
}
