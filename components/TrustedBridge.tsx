"use client";

// Lives in the main window only (components/AppShell.tsx). Follows every person the user
// trusts once, for the whole app (each their own pair). When a greeting or question arrives:
//
// - home and the mascot show it (they read lib/trusted.ts), and the companion looks glad;
// - outside quiet hours, and unless the voice is off or everything is paused, the companion
//   reads it aloud once. In quiet hours it stays silent, but the greeting is still shown.

import { useEffect } from "react";
import { inQuietHours, quietHoursOf } from "@/lib/settings";
import { readData } from "@/lib/storage";
import { follow, onArrival, unfollow, watchPeople } from "@/lib/trusted";
import { dayKey } from "@/lib/dates";
import { saveContactDays } from "@/lib/storage";
import { sourcesOf } from "@/lib/settings";
import type { PersonView } from "@/lib/messages";

import { speak } from "@/lib/voice";

const spoken = new Set<string>();

/**
 * Social, from data the app already has: how many messages passed with the people they trust
 * on each day while a pair existed (both ways, everyone together). Today is written even when it
 * is 0. Never what the messages say, and never who.
 */
let lastCounts = "";
function recordContact(vs: PersonView[]) {
  const live = vs.filter((v) => v.snapshot.pairing && v.snapshot.connection !== "ended");
  if (!live.length || !sourcesOf(readData().settings).contact) return;
  const today = dayKey(new Date());
  const counts = new Map<string, number>([[today, 0]]);
  for (const v of live) {
    for (const e of v.snapshot.events) {
      const d = dayKey(new Date(e.ts));
      counts.set(d, (counts.get(d) ?? 0) + 1);
    }
  }
  const key = JSON.stringify([...counts]);
  if (key === lastCounts) return;
  lastCounts = key;
  saveContactDays([...counts.entries()].map(([date, exchanged]) => ({ date, exchanged, source: "user" as const })));
}


export function TrustedBridge() {
  useEffect(() => {
    const stopContact = watchPeople(recordContact);
    follow();
    const stop = onArrival((events) => {
      const greetings = events.filter((e) => e.type === "greeting");
      const newest = greetings[greetings.length - 1];
      if (!newest || newest.type !== "greeting") return;
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
