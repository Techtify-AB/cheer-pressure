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
import { follow, onArrival, unfollow } from "@/lib/trusted";
import { GREETING_LINE, sendIfConnected } from "@/lib/robot";
import { speak } from "@/lib/voice";

const spoken = new Set<string>();

export function TrustedBridge() {
  useEffect(() => {
    follow();
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
      stop();
      unfollow();
    };
  }, []);
  return null;
}
