// "Did that help?": what the person said after each activity, summed up per activity. This is
// the second signal; the first is whether the days that followed moved back towards the
// person's usual (lib/helps.ts followedBy). Both are combined, and shown apart, in lib/helps.ts
// (activityStats, orderActivities, followedLines; re-exported in lib/activities/learning.ts).
//
//   activityHelpStats(records)   per activity: times done, times answered, yes / a little / no
//
// Pure, unit tested in scripts/test-activities.mts. Records come from AppData.activitiesDone.

import type { ActivityId } from "./index";
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

export type { ActivityId };
