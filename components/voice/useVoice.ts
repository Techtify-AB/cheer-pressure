"use client";

import { useSyncExternalStore } from "react";
import { getServerVoiceView, getVoiceView, subscribeVoice, type VoiceView } from "@/lib/voice/index";

/** The microphone's state and live tone values, updated about 10 times a second while it runs. */
export function useVoice(): VoiceView {
  return useSyncExternalStore(subscribeVoice, getVoiceView, getServerVoiceView);
}
