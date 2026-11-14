// Fixed list of crisis words and phrases. If typed text contains any of them,
// the app shows the pre-written handoff card (components/CrisisCard.tsx) instead
// of a generated reply. Edit this list here only.

export const CRISIS_PHRASES: string[] = [
  "suicide",
  "suicidal",
  "kill myself",
  "killing myself",
  "end my life",
  "ending my life",
  "take my life",
  "want to die",
  "wanna die",
  "wish i was dead",
  "wish i were dead",
  "better off dead",
  "better off without me",
  "don't want to live",
  "dont want to live",
  "no reason to live",
  "not worth living",
  "end it all",
  "hurt myself",
  "hurting myself",
  "harm myself",
  "self harm",
  "self-harm",
  "cut myself",
  "overdose",
];

function normalise(text: string): string {
  return text.toLowerCase().replace(/[‘’`]/g, "'").replace(/\s+/g, " ");
}

export function containsCrisisWords(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = ` ${normalise(text)} `;
  return CRISIS_PHRASES.some((p) => {
    const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(t);
  });
}

/**
 * For checking on every key press: ignores a word that is still being typed, so
 * "want to die" does not match while someone is typing "want to diet". The full
 * text is checked again with containsCrisisWords when they move on.
 */
export function containsCrisisWordsWhileTyping(text: string | null | undefined): boolean {
  if (!text) return false;
  return containsCrisisWords(text.replace(/[\p{L}'’-]+$/u, ""));
}
