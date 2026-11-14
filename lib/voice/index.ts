// The seam for tone of voice (Mood). Everything the rest of the app will need later comes from
// here; nothing outside lib/voice/ and components/voice/ uses it yet.
//
//   import { onToneSession, type ToneSession } from "@/lib/voice/index";
//   onToneSession((s) => addToneSession(s)); // storing it is not done yet (see the report)
//
// Note the "/index": "@/lib/voice" on its own resolves to lib/voice.ts, the read-aloud module,
// which is a different thing and is left as it is.
//
// Listening starts only through startListening(), which only a person's press may call. No
// audio is kept or sent and no words are recognised; only the numbers in ToneSession exist.
// They describe how the voice sounds compared with the person's own usual, never a feeling.

export {
  getServerVoiceView,
  getVoiceView,
  onToneSession,
  playVoiceExample,
  resetVoice,
  startListening,
  stopListening,
  stopVoiceExample,
  subscribeVoice,
  type VoicePhase,
  type VoiceView,
} from "./controller";
export type { AudioFrame, ToneLive, ToneSession } from "./tone";
export { MIN_SPEAKING_MINUTES, createToneTracker } from "./tone";
