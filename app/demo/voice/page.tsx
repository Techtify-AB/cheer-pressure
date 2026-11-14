"use client";

// "Voice, live", the deeper view behind the Mood panel of Live (/live/). Everything lives in components/voice/ and lib/voice/; the
// microphone starts only when the person presses "Start listening".

import { VoiceLive } from "@/components/voice/VoiceLive";

export default function VoicePage() {
  return <VoiceLive />;
}
