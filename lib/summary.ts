// Builds the plain-text summary for "Share with my clinic". What you see on the
// share screen is exactly this text. Typed notes are left out on purpose.

import { formatDay } from "./dates";
import type { Levels } from "./levels";
import { WEEKLY_ITEM_LABELS } from "./levels";
import type { AppData } from "./types";

const SCALE = ["not at all", "several days", "more than half the days", "nearly every day"];

export function buildSummary(data: AppData, levels: Levels, companionSays: string): string {
  const lines: string[] = [];
  lines.push("Summary from my Cheer Pressure app");
  lines.push(`Made on ${formatDay(levels.today)}. Compared only with my own earlier entries.`);
  if ([...data.daily, ...data.weekly, ...data.reaction].some((e) => e.source === "demo")) {
    lines.push("Note: this includes made-up demo data, not real entries.");
  }
  lines.push("");

  if (data.profile?.earlySigns.length) {
    lines.push("My personal early signs:");
    for (const s of data.profile.earlySigns) lines.push(`- ${s}`);
    lines.push("");
  }

  lines.push("Last 7 days compared with my usual level:");
  for (const m of levels.metrics) {
    const label = m.experimental ? `${m.label} (experiment)` : m.label;
    if (!m.recent && !m.usual && !m.recentValues.length) {
      lines.push(`- ${label}: nothing in the last 7 days`);
      continue;
    }
    const recent = m.recent
      ? m.format(m.recent.median)
      : m.recentValues.length
        ? `${m.recentValues.map(m.format).join(", ")} (${m.recentValues.length} ${m.recentValues.length === 1 ? "day" : "days"}, too few to compare)`
        : "nothing in the last 7 days";
    const usual = m.usual ? m.format(m.usual.median) : "not enough earlier entries";
    lines.push(`- ${label}: last 7 days ${recent}, usual ${usual}`);
  }
  lines.push("");

  const weekly = data.weekly.slice(-6);
  if (weekly.length) {
    lines.push("Weekly answers (0 not at all, 1 several days, 2 more than half the days, 3 nearly every day):");
    for (const w of weekly) {
      const parts = WEEKLY_ITEM_LABELS.map((i) => `${i.label.toLowerCase()} ${w[i.key]}`);
      for (const s of w.signs) parts.push(`${s.sign.toLowerCase()} ${s.value}`);
      lines.push(`- ${formatDay(w.date)}: ${parts.join(", ")}`);
    }
    const latest = weekly[weekly.length - 1];
    lines.push(`  Latest: feeling down or hopeless "${SCALE[latest.down]}", little interest or pleasure "${SCALE[latest.interest]}".`);
    lines.push("");
  }

  lines.push(`What the companion noticed: ${companionSays}`);
  lines.push("");
  lines.push(`Daily check-ins in total: ${data.daily.length}.`);
  lines.push("My typed notes are not included.");
  return lines.join("\n");
}
