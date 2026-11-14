// "Did that help?": what the person said after each activity, summed up per activity.
//
// For other parts of the app (the ladder's step one in lib/helps.ts may use this to rank its
// suggestions): these names are stable.
//
//   activityHelpStats(records)            per activity: times done, times answered, and how
//                                         much it helped ("yes" counts 1, "a little" 0.5)
//   activityHelpSentence(stats)           one plain sentence for the interface, or null
//   activityHelpScore(stats)              (helped + 1) / (answered + 2): untried is one half,
//                                         helped is above it, did not help is below it
//   orderActivitiesByHelp(ids, records)   ids ordered by that score; ties keep the given order
//
// Pure, unit tested in scripts/test-activities.mts. Records come from AppData.activitiesDone.

import { activityById, type ActivityId } from "./index";
import type { ActivityDone, ActivityFeedback } from "../types";

export const HELP_WEIGHT: Record<ActivityFeedback, number> = { yes: 1, "a-little": 0.5, no: 0 };

export interface ActivityHelpStats {
  activity: string;
  /** Times the person said they did it (Done, or ended it partway). */
  done: number;
  /** Times they answered "Did that help?" (skips not counted). */
  answered: number;
  /** "yes" counts 1, "a little" 0.5. */
  helped: number;
  yes: number;
  aLittle: number;
  no: number;
}

/** Per activity, from the stored records. Activities never done are left out. */
export function activityHelpStats(records: Pick<ActivityDone, "activity" | "feedback">[]): Record<string, ActivityHelpStats> {
  const out: Record<string, ActivityHelpStats> = {};
  for (const r of records) {
    const s = (out[r.activity] ??= { activity: r.activity, done: 0, answered: 0, helped: 0, yes: 0, aLittle: 0, no: 0 });
    s.done += 1;
    if (r.feedback) {
      s.answered += 1;
      s.helped += HELP_WEIGHT[r.feedback];
      if (r.feedback === "yes") s.yes += 1;
      else if (r.feedback === "a-little") s.aLittle += 1;
      else s.no += 1;
    }
  }
  return out;
}

export function activityHelpScore(stats: Pick<ActivityHelpStats, "helped" | "answered"> | undefined): number {
  if (!stats) return 0.5;
  return (stats.helped + 1) / (stats.answered + 2);
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/**
 * One plain sentence: "You've said a short walk helped 3 of 4 times." Counts "yes" and
 * "a little" as helped; says "a little" when that is all it was. Null with no history.
 */
export function activityHelpSentence(stats: ActivityHelpStats | undefined): string | null {
  if (!stats || stats.done === 0) return null;
  const a = activityById(stats.activity);
  const phrase = a?.phrase ?? "this";
  const Phrase = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  if (stats.answered === 0) return `You've done ${phrase} ${times(stats.done)} before.`;
  const any = stats.yes + stats.aLittle;
  if (stats.answered === 1) {
    if (stats.yes) return `You've said ${phrase} helped last time.`;
    if (stats.aLittle) return `You've said ${phrase} helped a little last time.`;
    return `Last time you said ${phrase} didn't help much. ${Phrase} is here if you want to try again.`;
  }
  if (any === 0) return `You've said ${phrase} didn't help much so far.`;
  if (stats.yes === 0) return `You've said ${phrase} helped a little ${any} of ${stats.answered} times.`;
  return `You've said ${phrase} helped ${any} of ${stats.answered} times.`;
}

/** The ids ordered so that what the person said helps comes first; untried before not helping. */
export function orderActivitiesByHelp<T extends string>(ids: T[], records: Pick<ActivityDone, "activity" | "feedback">[]): T[] {
  const stats = activityHelpStats(records);
  const index = new Map(ids.map((id, i) => [id, i]));
  return [...ids].sort(
    (a, b) => activityHelpScore(stats[b]) - activityHelpScore(stats[a]) || index.get(a)! - index.get(b)!,
  );
}

export type { ActivityId };
