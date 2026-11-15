// "What a clinic could see", for the demo only: made-up patients who each chose to share their
// values, put in an order of who to look at first. Every patient's days come from the replay's
// generator (lib/replay.ts) with a drift that began a different number of days ago (or never),
// run through the real rule. The order uses only how many categories stand out and for how long;
// it is not a score, it shows no percentages, and it decides nothing.

import { addDays, daysBetween } from "./dates";
import { daysWithData, enoughToAsk, evaluatePassive, SOURCES, sourceOf } from "./passive";
import { makeReplayData, REPLAY_DAYS } from "./replay";
import type { AppData, DayKey } from "./types";

export interface DemoPatient {
  name: string;
  /** Categories standing out today, in plain words. */
  reason: string;
  /** How many days in a row the values have stood out the way Cheri asks about. */
  daysStandingOut: number;
  sourcesOut: number;
  /** Days with any measured value in the last five weeks. */
  measuredDays: number;
  /** The four categories in their fixed order, each changed or as usual against this person's own usual. */
  categories: { label: string; changed: boolean }[];
}

/** Days since each made-up patient's drift began; 0 means no drift. */
const DRIFT_AGO = [0, 9, 3, 0, 13, 6, 1, 0];
const SEEDS = [11, 23, 37, 41, 53, 67, 71, 89];

function appData(r: ReturnType<typeof makeReplayData>, upTo: DayKey): AppData {
  return {
    version: 1,
    profile: { createdAt: "", earlySigns: [] },
    daily: [],
    weekly: [],
    reaction: [],
    typingSessions: [],
    typingDays: r.typingDays.filter((d) => d.date <= upTo),
    activityDays: r.activityDays.filter((d) => d.date <= upTo),
    dailyAnswers: r.dailyAnswers.filter((d) => d.date <= upTo),
    movementSessions: r.movementSessions.filter((d) => d.date <= upTo),
    contactDays: r.contactDays.filter((d) => d.date <= upTo),
    outDays: r.outDays.filter((d) => d.date <= upTo),
    seenDays: r.seenDays.filter((d) => d.date <= upTo),
    checkIns: [],
    settings: { muted: false },
  };
}

export function demoPatients(today: DayKey): DemoPatient[] {
  const list = DRIFT_AGO.map((ago, i) => {
    const steadyDays = ago === 0 ? REPLAY_DAYS : REPLAY_DAYS - ago;
    const r = makeReplayData(today, SEEDS[i], { steadyDays, days: REPLAY_DAYS });
    const e = evaluatePassive(appData(r, today), today);
    const out = SOURCES.filter((s) => e.changed.some((m) => sourceOf(m.key) === s.id));
    let streak = 0;
    for (let back = 0; back < 21; back++) {
      const day = addDays(today, -back);
      const ev = back === 0 ? e : evaluatePassive(appData(r, day), day);
      if (ev.learning || !enoughToAsk(ev.changed)) break;
      streak++;
    }
    const data = appData(r, today);
    const measured = daysWithData({ ...data, typingDays: data.typingDays?.filter((d) => daysBetween(d.date, today) < 35), activityDays: data.activityDays.filter((d) => daysBetween(d.date, today) < 35) }, today);
    const what = out.map((s) => s.label).join(" and ");
    const reason = !out.length
      ? "Within their own usual"
      : streak
        ? `${what}, ${streak} ${streak === 1 ? "day" : "days"} in a row`
        : `${what}, not enough to ask`;
    return { name: `Made-up patient ${String.fromCharCode(65 + i)}`, reason, daysStandingOut: streak, sourcesOut: out.length,
      measuredDays: measured,
      categories: SOURCES.map((c) => ({ label: c.label, changed: out.some((o) => o.id === c.id) })),
    };
  });
  const sorted = list.sort((a, b) => b.daysStandingOut - a.daysStandingOut || b.sourcesOut - a.sourcesOut || a.name.localeCompare(b.name));
  // The first one is the person the phone demo follows: Sleep and Energy, as on their phone.
  const first = sorted[0];
  if (first) first.categories = first.categories.map((c) => ({ ...c, changed: c.label === "Sleep" || c.label === "Energy" }));
  return sorted;
}
