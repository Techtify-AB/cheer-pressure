"use client";

// Lives in the main window only (components/AppShell.tsx). Follows the pair with the trusted
// person once, for the whole app, while a pair exists. When a greeting or question arrives:
//
// - home and the mascot show it (they read lib/trusted.ts), and the companion looks glad;
// - a connected robot gets one line (lib/robot.ts); with no robot connected nothing happens;
// - outside quiet hours, and unless the voice is off or everything is paused, the companion
//   reads it aloud once. In quiet hours it stays silent, but the greeting is still shown.

import { useEffect } from "react";
import { inQuietHours, quietHoursOf } from "@/lib/settings";
import { readData } from "@/lib/storage";
import { follow, onArrival, unfollow, messagesClient } from "@/lib/trusted";
import { dayKey } from "@/lib/dates";
import { saveContactDays } from "@/lib/storage";
import { sourcesOf } from "@/lib/settings";
import type { Snapshot } from "@/lib/messages";

import { GREETING_LINE, sendIfConnected } from "@/lib/robot";
import { speak } from "@/lib/voice";

const spoken = new Set<string>();

/**
 * Social, from data the app already has: how many messages passed with the person they trust
 * on each day while a pair existed (both ways). Today is written even when it is 0. Never what
 * the messages say.
 */
function recordContact(s: Snapshot) {
  if (!s.pairing || s.connection === "ended" || !sourcesOf(readData().settings).contact) return;
  const today = dayKey(new Date());
  const counts = new Map<string, number>([[today, 0]]);
  for (const e of s.events) {
    const d = dayKey(new Date(e.ts));
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  saveContactDays([...counts.entries()].map(([date, exchanged]) => ({ date, exchanged, source: "user" as const })));
}


export function TrustedBridge() {
  useEffect(() => {
    follow();
    const client = messagesClient();
    const stopContact = client.subscribe(recordContact);
    const stop = onArrival((events) => {
      const greetings = events.filter((e) => e.type === "greeting");
      const newest = greetings[greetings.length - 1];
      if (!newest || newest.type !== "greeting") return;
      void sendIfConnected(GREETING_LINE);
      if (spoken.has(newest.id)) return;
      spoken.add(newest.id);
      const d = readData();
      const now = new Date();
      const quiet = inQuietHours(now.getHours() * 60 + now.getMinutes(), quietHoursOf(d.settings));
      if (quiet || d.settings.pausedAll || d.settings.muted) return;
      speak(`${newest.from.name} says: ${newest.text}`, { muted: false, onEnd: () => {} });
    });
    return () => {
      stopContact();
      stop();
      unfollow();
    };
  }, []);
  return null;
}
