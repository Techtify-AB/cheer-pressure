"use client";

// Read-aloud with the browser's built-in speech synthesis. Only voices that the
// browser reports as on-device (localService) are used, so no text is sent
// anywhere to be spoken. If there is no on-device voice, nothing is spoken.
//
// There is no voice input in this version.

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.localService);
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return en.find((v) => v.default) ?? en[0] ?? null;
}

export function canSpeak(): boolean {
  return pickVoice() !== null;
}

/** Browsers block speech before the first tap or key press on the page. */
function hasUserActivation(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return ua ? ua.hasBeenActive : true;
}

export function stopSpeaking() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}

/**
 * Speaks the text if possible. Always calls onEnd, also when muted or unavailable,
 * so callers can treat it as "the companion has finished talking".
 */
export function speak(text: string, opts: { muted: boolean; onEnd: () => void }): () => void {
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
