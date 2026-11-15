// "My values" and the clinic report, made on this device from the same evaluation the
// companion uses (lib/passive.ts). Pure code: give it the stored data and today's date.
//
// The report is what the person may choose to save as a PDF or print for their clinic. It is
// never sent anywhere: there is no clinic integration, and the messages service never receives
// it. It holds only values relevant to a clinician, compared with the person's own usual:
// no raw events, no app names, no text the person typed except their answers to Cheri.
//
// Every number in the report comes from measureNumbers below, which "My values" shows too, or
// is a count of days or a date; scripts/test-report.mts checks that.

import { addDays, daysBetween, formatDay } from "./dates";
import {
  evaluatePassive,
  LEARNING_DAYS,
  MIN_DAY_PRESSES,
  MIN_RECENT_DAYS,
  MIN_USUAL_DAYS,
  PASSIVE_DEFS,
  SOURCES,
  enoughToAsk,
  movementPoints,
  onlyQuietSources,
  type Evaluation,
  type PassiveMetric,
  type SourceId,
} from "./passive";
import type { AppData, CheckInAnswer, DayKey, RoutineId } from "./types";

/** The highest PHQ-2 total: two items, 0 to 3 each. */
const PHQ_ITEMS_MAX = 6;

/** The report covers the last eight weeks, today included. */
export const REPORT_DAYS = 56;

export const DISCLAIMER = "A prototype. Not a diagnosis and not for clinical decisions on its own.";

const DEF = new Map(PASSIVE_DEFS.map((d) => [d.key, d]));

/** The numbers a measure is shown with, formatted once, for the screen and the report alike. */
export function measureNumbers(m: PassiveMetric) {
  return {
    recent: m.recent ? m.format(m.recent.median) : null,
    recentDays: m.recent?.n ?? 0,
    usualLow: m.usual ? m.format(m.usual.low) : null,
    usualHigh: m.usual ? m.format(m.usual.high) : null,
    usualDays: m.usual?.n ?? 0,
  };
}

/** The first day of the last week that lies on the changed side of the usual range. */
export function changedSince(m: PassiveMetric, today: DayKey): DayKey | null {
  if (m.status !== "changed" || !m.usual || !m.direction) return null;
  const u = m.usual;
  const hit = m.points
    .filter((p) => daysBetween(p.date, today) >= 0 && daysBetween(p.date, today) < 7)
    .find((p) => (m.direction === "up" ? p.value > u.high : p.value < u.low));
  return hit?.date ?? m.points.filter((p) => daysBetween(p.date, today) < 7)[0]?.date ?? null;
}

/** One line for one measure. `who` is "my" in the report and "your" on the person's screen. */
export function measureLine(m: PassiveMetric, today: DayKey, who: "my" | "your"): string {
  const d = DEF.get(m.key)!;
  const n = measureNumbers(m);
  if (m.status === "learning") {
    return `Not enough days yet for ${who} usual (${MIN_USUAL_DAYS} needed before the last week).`;
  }
  if (m.status === "no-recent" || !n.recent) {
    return `Too few days in the last week to compare (${MIN_RECENT_DAYS} needed).`;
  }
  const usual = `${who} usual ${n.usualLow} to ${n.usualHigh} (${n.usualDays} days before${m.split ? ", weekdays and weekends apart" : ""})`;
  const week = `last week's middle ${n.recent} (${n.recentDays} days)`;
  if (m.status === "changed" && m.direction) {
    const since = changedSince(m, today);
    const word = m.direction === "up" ? d.upWord : d.downWord;
    return `${word[0].toUpperCase()}${word.slice(1)} than ${who} usual${since ? ` since ${formatDay(since)}` : ""}: ${week}; ${usual}.`;
  }
  return `Within ${who} usual: ${week}; ${usual}.`;
}

export interface SourceView {
  id: SourceId;
  label: string;
  reportLabel: string;
  standsOut: boolean;
  metrics: PassiveMetric[];
}

export function sourcesOfEvaluation(e: Evaluation): SourceView[] {
  return SOURCES.map((s) => {
    const metrics = e.metrics.filter((m) => m.source === s.id);
    return { id: s.id, label: s.label, reportLabel: s.reportLabel, standsOut: metrics.some((m) => m.status === "changed"), metrics };
  });
}

/** One sentence for the top of "My values". */
export function valuesSummary(e: Evaluation, who: "my" | "your"): string {
  if (e.learning) return `Not enough days yet to compare with ${who} usual (${e.daysOfData} of ${LEARNING_DAYS} days).`;
  const out = sourcesOfEvaluation(e).filter((s) => s.standsOut);
  if (!out.length) return `Over the last week ${who} values were within ${who} own usual.`;
  if (onlyQuietSources(e.changed)) {
    return `Over the last week only ${out.map((s) => s.label).join(" and ")} stood out, which on its own never makes Cheri ask.`;
  }
  const names = out.map((s) => (who === "my" ? s.reportLabel : s.label)).join(" and ");
  return `Over the last week ${names} stood out from ${who} own usual${enoughToAsk(e.changed) ? ", enough for Cheri to ask" : ""}.`;
}

const ANSWER_WORDS: Record<CheckInAnswer, string> = {
  okay: "I'm okay",
  "not-best": "Not my best",
  someone: "I'd like someone to check in on me",
  "not-now": "Not now",
};

const ROUTINE_WORDS: Record<RoutineId, string> = {
  walk: "a walk in daylight",
  "morning-light": "some morning light",
  "regular-bedtime": "a regular bedtime",
  music: "some music",
  "call-someone": "calling someone",
};

export interface Report {
  period: { from: DayKey; to: DayKey; text: string };
  /** False when there is too little data for a comparison yet. */
  enoughData: boolean;
  summary: string;
  sources: { id: SourceId; label: string; standsOut: boolean; lines: { label: string; text: string }[] }[];
  quality: string[];
  answers: string[];
  weekly: string[];
  ladder: string[];
  legend: { label: string; is: string; isNot: string }[];
  disclaimer: string;
  /** True when any of it is made-up demo data. */
  simulated: boolean;
}

/** The daily question per week, last four weeks, newest last, in plain words. */
export function answerWeeks(data: AppData, today: DayKey): { label: string; text: string }[] {
  const out: { label: string; text: string }[] = [];
  for (let w = 3; w >= 0; w--) {
    const end = addDays(today, -7 * w);
    const start = addDays(end, -6);
    const week = (data.dailyAnswers ?? []).filter((a) => a.date >= start && a.date <= end);
    const count = (v: string) => week.filter((a) => a.answer === v).length;
    const unanswered = 7 - week.filter((a) => a.answer).length;
    out.push({
      label: `Week from ${formatDay(start)}`,
      text: `${count("good")} Good, ${count("okay")} Okay, ${count("not-so-good")} Not so good, ${unanswered} without an answer.`,
    });
  }
  return out;
}

/** Each input in the report's first person. */
const REPORT_INPUT: Record<string, string> = {
  "computer-use": "estimate from this computer",
  "phone-app": "phone app",
  watch: "watch or band",
  bedside: "a bedside device",
  movement: "body movement (camera)",
  "voice-pace": "pace of the voice (microphone)",
  typing: "typing rhythm",
  "trusted-contact": "contact with the person I trust",
  "saw-someone": "seeing or talking to someone (my own answer)",
  "home-or-out": "time out of my home",
  "phone-talk": "calls and conversations on my phone (how many)",
  "home-talk": "talking at home (desktop app)",
  "daily-answer": "my daily answer",
  expression: "face movement (camera)",
  posture: "posture (camera)",
  "voice-tone": "tone of voice (microphone)",
};

/** The clinic report, in the first person: the person shares it about themselves. */
export function clinicReport(data: AppData, today: DayKey, evaluation?: Evaluation): Report {
  const e = evaluation ?? evaluatePassive(data, today);
  const from = addDays(today, -(REPORT_DAYS - 1));
  const inPeriod = (d: DayKey) => d >= from && d <= today;

  // All four categories, each with every one of its inputs: the measures with values in this
  // period, then one line naming the inputs that gave nothing (off, or not connected yet).
  const sources = sourcesOfEvaluation(e).map((s) => {
    const measured = s.metrics.filter((m) => m.points.some((p) => p.date >= from));
    const cat = SOURCES.find((c) => c.id === s.id)!;
    const without = cat.inputs.filter((i) => !i.retired && !measured.some((m) => i.measures.includes(m.key)));
    const lines = [
      ...measured.map((m) => ({ label: m.label, text: measureLine(m, today, "my") })),
      ...(s.id === "mood" && (data.dailyAnswers ?? []).some((a) => a.answer && a.date >= from) ? answerWeeks(data, today) : []),
      ...(without.length
        ? [{ label: "Not measured", text: `${without.map((i) => `${REPORT_INPUT[i.id] ?? i.label.toLowerCase()} (${i.setting ? "no values" : "not connected yet"})`).join(", ")}.` }]
        : []),
    ];
    return { id: s.id, label: s.reportLabel, standsOut: s.standsOut, lines };
  });

  // Data quality: how many days each category rests on, in category order.
  const typingRows = (data.typingDays ?? []).filter((t) => inPeriod(t.date) && t.kind === "all");
  const typingDates = new Map<DayKey, number>();
  for (const t of typingRows) typingDates.set(t.date, Math.max(typingDates.get(t.date) ?? 0, t.presses));
  const enoughTyping = [...typingDates.values()].filter((p) => p >= MIN_DAY_PRESSES).length;
  const littleTyping = [...typingDates.values()].filter((p) => p < MIN_DAY_PRESSES).length;
  const activity = new Set(data.activityDays.filter((a) => inPeriod(a.date)).map((a) => a.date)).size;
  const movementDays = movementPoints(data, "movementLevel", today).filter((p) => inPeriod(p.date)).length;
  const contactDays = new Set((data.contactDays ?? []).filter((c) => inPeriod(c.date)).map((c) => c.date)).size;
  const answeredDays = new Set((data.dailyAnswers ?? []).filter((a) => a.answer && inPeriod(a.date)).map((a) => a.date)).size;
  const quality = [
    `Sleep, estimated from this computer: ${activity} of ${REPORT_DAYS} days measured.`,
    `Energy, movement (camera): ${movementDays} of ${REPORT_DAYS} days with enough time in frame.`,
    `Energy, typing: ${enoughTyping} of ${REPORT_DAYS} days counted, ${littleTyping} with too little writing (under ${MIN_DAY_PRESSES} key presses), ${REPORT_DAYS - enoughTyping - littleTyping} without typing.`,
    `Social, contact with the person I trust: ${contactDays} of ${REPORT_DAYS} days counted.`,
    `Mood, my own answers: ${answeredDays} of ${REPORT_DAYS} days answered.`,
  ];

  const answers = data.checkIns
    .filter((c) => inPeriod(c.date))
    .map((c) => `${formatDay(c.date)}: "${ANSWER_WORDS[c.answer]}"${c.simulated ? " (made-up demo data)" : ""}`);

  const weekly = data.weekly
    .filter((w) => inPeriod(w.date))
    .map((w) => `${formatDay(w.date)}: PHQ-2 total ${w.down + w.interest} of ${PHQ_ITEMS_MAX}${w.source === "demo" ? " (made-up demo data)" : ""}`);

  const ladder: string[] = [];
  const l = data.ladder;
  if (l && (inPeriod(l.startedOn) || (l.closedOn && inPeriod(l.closedOn)) || !l.closedOn)) {
    ladder.push(`${formatDay(l.startedOn)}: I told Cheri it was not my best.`);
    if (l.smallThing) {
      const what = l.smallThing.label ? `"${l.smallThing.label}", from my own list` : l.smallThing.routine ? ROUTINE_WORDS[l.smallThing.routine] : "one small thing";
      ladder.push(
        `One small thing was offered (${what}); ${l.smallThing.answer === "try" ? "I said I'd try it" : l.smallThing.answer === "not-now" ? "I said not now" : "no answer yet"}.`,
      );
    }
    if (l.someone?.answer === "yes") ladder.push(`${formatDay(l.someone.offeredOn)}: I asked someone I trust to check in on me.`);
    else if (l.someone?.answer === "not-now") ladder.push(`${formatDay(l.someone.offeredOn)}: someone I trust was offered; I said not now.`);
    if (l.clinic?.answer) ladder.push(`${formatDay(l.clinic.offeredOn)}: a summary for my clinic was offered; I ${l.clinic.answer === "approve" ? "said yes" : "said not now"}.`);
    ladder.push(l.closedOn ? `${formatDay(l.closedOn)}: the values came back to my usual.` : "The values have not come back to my usual yet.");
  }

  return {
    period: { from, to: today, text: `${formatDay(from)} to ${formatDay(today)} (${REPORT_DAYS} days)` },
    enoughData: !e.learning,
    summary: valuesSummary(e, "my"),
    sources,
    quality,
    answers,
    weekly,
    ladder,
    legend: [
      {
        label: "Sleep",
        is: "An estimate from my first and last key press each day",
        isNot: "Not measured sleep; a watch or phone would give real sleep (not connected yet)",
      },
      ...PASSIVE_DEFS.map((d) => ({ label: d.label, is: d.is, isNot: d.isNot })),
      // The face model's own card: made for AR and avatars, "not intended for human life-critical decisions".
      { label: "Face and posture", is: "Experimental measures", isNot: "Never used on their own" },
    ],
    disclaimer: DISCLAIMER,
    simulated: e.simulated,
  };
}

/** The report as plain text, for tests and for a quick copy. */
export function reportText(r: Report): string {
  const out: string[] = [];
  out.push("My values from Cheer Pressure, compared only with my own usual, never with other people.");
  out.push(`Period: ${r.period.text}.`);
  if (r.simulated) out.push("Includes made-up demo data.");
  out.push(r.summary);
  for (const s of r.sources) {
    out.push(`${s.label}${s.standsOut ? " (stands out)" : ""}:`);
    for (const l of s.lines) out.push(`- ${l.label}: ${l.text}`);
  }
  out.push("How many days this rests on:", ...r.quality.map((q) => `- ${q}`));
  out.push("My answers to Cheri:", ...(r.answers.length ? r.answers.map((a) => `- ${a}`) : ["- None in this period."]));
  if (r.weekly.length) out.push("Weekly questions (PHQ-2, 0 to 6):", ...r.weekly.map((w) => `- ${w}`));
  out.push("Steps Cheri offered:", ...(r.ladder.length ? r.ladder.map((x) => `- ${x}`) : ["- None in this period."]));
  out.push("What each value is:", ...r.legend.map((g) => `- ${g.label}: ${g.is}. ${g.isNot}.`));
  out.push(r.disclaimer);
  return out.join("\n");
}

// --- "Shared with my clinic" (a demo recipient: nothing is sent) ----------------------------
//
// What the clinic is told, by the person's choice (lib/settings.ts clinicOf):
// - "Always": a short weekly summary, and a note when two categories stand out (at most weekly).
// - The ladder's step three, told automatically when the person said yes to "tell my clinic for
//   me", or approved when Cheri asked first.
// Each one is an entry holding exactly the report as it was that day. In this version the
// clinic is a demo recipient: nothing leaves the device, and every screen says so.

export const DEMO_RECIPIENT_LINE = "Demo recipient. Nothing was actually sent.";
/** Days between two "Always" summaries, and between two notes. */
export const ALWAYS_EVERY_DAYS = 7;

export type SharedKind = "weekly" | "note" | "automatic" | "approved";

/** The entry to store: exactly the report as it is today. */
export function sharedEntry(data: AppData, today: DayKey, kind: SharedKind, id: string, at = new Date().toISOString(), evaluation?: Evaluation) {
  const report = clinicReport(data, today, evaluation);
  return { id, date: today, at, kind, demoRecipient: true as const, report, simulated: report.simulated };
}

/**
 * Which "Always" entry is due today, if any: the weekly summary once every seven days, or a note
 * when the rule asks (two categories stand out) and no note went in the last seven days.
 * Nothing unless the person chose "Always", has finished setup, and nothing is paused.
 */
export function alwaysShareDue(data: AppData, today: DayKey, askNow: boolean, share: "always" | "when-i-say" | "never"): "weekly" | "note" | null {
  if (share !== "always" || !data.profile || data.settings.pausedAll) return null;
  const entries = data.clinicShared ?? [];
  const recent = (kind: SharedKind) => entries.some((e) => e.kind === kind && daysBetween(e.date, today) < ALWAYS_EVERY_DAYS && daysBetween(e.date, today) >= 0);
  if (askNow && !recent("note")) return "note";
  if (!recent("weekly")) return "weekly";
  return null;
}

export const SHARED_KIND_WORDS: Record<SharedKind, string> = {
  weekly: "Weekly summary",
  note: "A note: two categories stood out",
  automatic: "Told for you, as you asked",
  approved: "You approved it",
};
