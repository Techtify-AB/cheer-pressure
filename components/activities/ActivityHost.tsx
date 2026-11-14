"use client";

// Opens one activity: reads the person's plan (lib/plan.ts), runs the shared flow
// (useActivity) and shows "Done" when the person says they did it.

import { useState } from "react";
import { activityById, type ActivityId } from "@/lib/activities";
import { planOf, type Plan } from "@/lib/plan";
import { useData } from "@/lib/storage";
import { messagesClient } from "@/lib/trusted";
import { AfterView, FeedbackView } from "./Feedback";
import { ACTIVITY_VIEWS } from "./views";
import { useActivity, type ActivityRun } from "./useActivity";

export type ActivityView = (props: { run: ActivityRun; plan: Plan }) => React.ReactNode;

/** The name of the person they trust, when one is connected (read-only). */
function trustedName(): string | null {
  try {
    return messagesClient().snapshot().trustedName;
  } catch {
    return null;
  }
}

export function ActivityHost({ id }: { id: ActivityId }) {
  const data = useData();
  const run = useActivity(id);
  const [trusted] = useState(trustedName);
  if (!data || !activityById(id)) return null;
  if (run.done) return run.done.stage === "feedback" ? <FeedbackView run={run} /> : <AfterView run={run} />;
  const View = ACTIVITY_VIEWS[id];
  return <View run={run} plan={planOf(data, trusted)} />;
}
