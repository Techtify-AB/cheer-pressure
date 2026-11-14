// Which of the character's moods to show. One mapping for the main window and the
// mascot window, so they always agree.

import type { CompanionState } from "@/components/companion/Companion";

export function moodFor(s: {
  speaking?: boolean;
  listening?: boolean;
  /** The companion would like to ask (lib/ladder.ts, speakUp). */
  wantsToAsk?: boolean;
  /** Quiet hours. */
  quiet?: boolean;
}): CompanionState {
  if (s.speaking) return "speaking";
  if (s.wantsToAsk) return "attention";
  if (s.listening) return "listening";
  if (s.quiet) return "sleeping";
  return "idle";
}
