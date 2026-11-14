"use client";

// "Voice, live" under the demo area. Everything lives in components/voice/ and lib/voice/; the
// microphone starts only when the person presses "Start listening".

import { VoiceLive } from "@/components/voice/VoiceLive";

export default function VoicePage() {
  return <VoiceLive />;
}
