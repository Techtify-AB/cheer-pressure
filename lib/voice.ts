"use client";

// Read-aloud with the browser's built-in speech synthesis. Only voices that the
// browser reports as on-device (localService) are used, so no text is sent
// anywhere to be spoken. If there is no on-device voice, nothing is spoken.
//
// There is no voice input in this version.

/**
 * Natural English voices by the start of their name, best first. A Mac lists its English
 * voices by name, and the list opens with the novelty ones (Albert, Bahh, Bells...), whose
 * names are translated on a Mac that is not set to English, so they cannot be told apart by
 * name. The people's names below are the same everywhere.
 */
const GOOD_VOICES = [
  "samantha", "ava", "allison", "susan", "zoe", "evan", "nathan", "tom", "alex", "victoria",
  "daniel", "kate", "serena", "oliver", "karen", "moira", "tessa", "fiona", "rishi",
  "microsoft aria", "microsoft jenny", "microsoft zira", "microsoft david", "microsoft mark",
  "english united states", "english united kingdom",
];
/** Novelty and mechanical-sounding voices under their English names, for when no voice above is installed. */
const ODD_VOICES =
  /^(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|junior|ralph|fred|kathy|princess|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

type VoiceLike = Pick<SpeechSynthesisVoice, "name" | "lang" | "default" | "localService">;

/**
 * The voice to read aloud with: on-device and English. The person's own default voice when it
 * is English; otherwise the best natural voice that is installed (a "Premium" or "Enhanced"
 * download before the standard one); otherwise any English voice that is not a novelty one.
 */
export function chooseVoice<V extends VoiceLike>(all: readonly V[]): V | null {
  const en = all.filter((v) => v.localService && v.lang.toLowerCase().startsWith("en"));
  const own = en.find((v) => v.default);
  if (own) return own;
  for (const name of GOOD_VOICES) {
    const named = en.filter((v) => v.name.toLowerCase().startsWith(name));
    if (named.length) return named.find((v) => v.name.includes("(")) ?? named[0];
  }
  return en.find((v) => !ODD_VOICES.test(v.name)) ?? en[0] ?? null;
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return chooseVoice(window.speechSynthesis.getVoices());
}

export function canSpeak(): boolean {
  return pickVoice() !== null;
}

// Whether there is an on-device voice. Some browsers (Chrome) list their voices a
// moment after the page loads, so "checking" lasts until they are listed or 1.5 s
// have passed. After that, no voice means "no".

export type VoiceAvailability = "checking" | "yes" | "no";

const VOICE_WAIT_MS = 1500;
let voicesSettled = false;
const voiceListeners = new Set<() => void>();

function hasSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function notifyVoices() {
  voiceListeners.forEach((l) => l());
}

function onVoicesChanged() {
  voicesSettled = true;
  notifyVoices();
}

export function subscribeVoices(listener: () => void): () => void {
  voiceListeners.add(listener);
  if (voiceListeners.size === 1 && hasSynthesis()) {
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    if (!voicesSettled) {
      window.setTimeout(() => {
        voicesSettled = true;
        notifyVoices();
      }, VOICE_WAIT_MS);
    }
  }
  return () => {
    voiceListeners.delete(listener);
    if (voiceListeners.size === 0 && hasSynthesis()) {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
    }
  };
}

export function voiceAvailability(): VoiceAvailability {
  if (!hasSynthesis()) return "no";
  if (canSpeak()) return "yes";
  return voicesSettled ? "no" : "checking";
}

/** Browsers block speech before the first tap or key press on the page. */
function hasUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

/**
 * Lines recorded in Cheri's own voice (public/demo/voice), by their exact text. Only the demo's
 * made-up person hears these texts; any other text is read by the device's voice as before.
 */
const RECORDED: Record<string, string> = {
  "Sleep and Energy have changed compared with your usual: over the last week your nights have been shorter, you've woken up earlier and you've taken fewer steps than in the four weeks before. This compares 7 days this week with 28 days in the four weeks before.":
    "/demo/voice/asks-explain.m4a",
  "How are you doing?": "/demo/voice/asks-question.m4a",
};
let recording: HTMLAudioElement | null = null;

export function stopSpeaking() {
  recording?.pause();
  recording = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/**
 * Speaks the text if possible. Always calls onEnd, also when muted or unavailable,
 * so callers can treat it as "the companion has finished talking".
 */
export function speak(text: string, opts: { muted: boolean; onEnd: () => void }): () => void {
  const clip = opts.muted || !hasUserActivation() ? undefined : RECORDED[text];
  if (clip) {
    stopSpeaking();
    const a = new Audio(clip);
    recording = a;
    let ended = false;
    const end = () => {
      if (!ended) {
        ended = true;
        opts.onEnd();
      }
    };
    a.onended = end;
    a.onerror = end;
    void a.play().catch(end);
    return () => {
      ended = true;
      a.pause();
    };
  }
  const fallback = window.setTimeout(opts.onEnd, Math.min(6000, 900 + text.length * 45));
  const voice = opts.muted || !hasUserActivation() ? null : pickVoice();
  if (!voice) return () => window.clearTimeout(fallback);
  window.clearTimeout(fallback);
  stopSpeaking();
  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.95;
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      opts.onEnd();
    }
  };
  u.onend = finish;
  u.onerror = finish;
  const guard = window.setTimeout(finish, 15000);
  window.speechSynthesis.speak(u);
  return () => {
    window.clearTimeout(guard);
    done = true;
    stopSpeaking();
  };
}
