"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createMessagesClient, type MessagesClient, type Snapshot } from "../lib/messages";

/**
 * The local-first client for one pair on this phone. `init` runs once in the browser (read the
 * link, clean the address) and says whether there is a pair to follow yet.
 * The first snapshot comes from the local cache, before any network answer.
 */
export function useMessages(storageKey: string, init: (client: MessagesClient) => "follow" | "wait") {
  const [client, setClient] = useState<MessagesClient | null>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const initRef = useRef(init);

  const follow = useCallback((c: MessagesClient) => {
    stop.current?.();
    stop.current = c.subscribe(setSnap);
  }, []);

  useEffect(() => {
    const c = createMessagesClient({ storageKey, baseUrl: window.location.origin });
    const next = initRef.current(c);
    // Set state after the effect has run, not inside it.
    queueMicrotask(() => {
      setClient(c);
      if (next === "follow") follow(c);
    });
    return () => {
      stop.current?.();
      stop.current = null;
    };
  }, [storageKey, follow]);

  return { client, snap, follow };
}

/** Reads one query parameter, then removes the query from the address bar. */
export function takeParam(name: string): string | null {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  if (url.search) window.history.replaceState(null, "", url.pathname);
  return value;
}
