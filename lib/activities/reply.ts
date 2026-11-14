// "Ask someone to get in touch" is a local demo: nothing is sent. The made-up reply matches
// what the draft asks for, so the demo reads true: a walk gets a walk answer, a call or a talk
// gets a talking answer. Pure, unit tested in scripts/test-activities.mts.

export type AskKind = "walk" | "talk" | "meet" | "other";

const PATTERNS: { kind: Exclude<AskKind, "other">; re: RegExp }[] = [
  { kind: "walk", re: /\b(walk|walks|walking|stroll|wander|go out|outside|fresh air)\b/i },
  { kind: "talk", re: /\b(talk|talking|call|ring|phone|chat|speak|catch up)\b/i },
  { kind: "meet", re: /\b(meet|coffee|tea|lunch|dinner|come over|visit|see you|hang out)\b/i },
];

export const DEMO_REPLIES: Record<AskKind, string> = {
  walk: "Yes, I can after lunch.",
  talk: "Yes, I have time. I'll call you in ten minutes.",
  meet: "Yes, I'd like that. Does this afternoon work?",
  other: "Good to hear from you. Yes, let's.",
};

/** Seconds before the made-up reply arrives. */
export const DEMO_REPLY_DELAY_MS = 1800;

export function askKind(draft: string): AskKind {
  for (const p of PATTERNS) if (p.re.test(draft)) return p.kind;
  return "other";
}

export function demoReply(draft: string): { kind: AskKind; text: string } {
  const kind = askKind(draft);
  return { kind, text: DEMO_REPLIES[kind] };
}

export function walkDraft(name: string): string {
  return `Hi ${name}, do you want to take a short walk with me today?`;
}

export const EASIER_DRAFT = "Hi, do you have time to talk for a bit?";
