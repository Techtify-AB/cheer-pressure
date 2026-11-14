"use client";

// The one screen every activity uses (components/Screen.tsx underneath): the title and the
// first thing to do, the activity itself, then one primary button and the quiet links
// "Make it easier" and "End". At most four groups, no page scrolling.

import { Screen } from "@/components/Screen";
import { activityHelpSentence, activityHelpStats } from "@/lib/activities/feedback";
import { useData } from "@/lib/storage";
import type { ActivityRun } from "./useActivity";

export function ActivityScreen({
  run,
  title,
  text,
  eyebrow,
  primary,
  secondary,
  links,
  hideEasier = false,
  children,
}: {
  run: ActivityRun;
  title: string;
  /** The first thing to do, said plainly. */
  text?: React.ReactNode;
  eyebrow?: string;
  /** The one primary button. */
  primary?: React.ReactNode;
  /** At most one secondary button. */
  secondary?: React.ReactNode;
  /** More quiet links before "Make it easier" and "End". */
  links?: React.ReactNode;
  /** No "Make it easier" here (the easier version is already on, or there is nothing smaller). */
  hideEasier?: boolean;
  children?: React.ReactNode;
}) {
  const data = useData();
  // What the person said before, on the opening screen only.
  const history = !run.started && !run.easier ? activityHelpSentence(activityHelpStats(data?.activitiesDone ?? [])[run.id]) : null;
  return (
    <Screen
      lead={
        <div className="act-lead" data-activity={run.id} data-easier={run.easier ? "" : undefined}>
          <p className="act-eyebrow">{eyebrow ?? (run.easier ? "A smaller step" : "Something for you")}</p>
          <h1 className="act-title">{title}</h1>
          {text ? <div className="act-text">{text}</div> : null}
          {history ? (
            <p className="act-history" data-act="history">
              {history}
            </p>
          ) : null}
        </div>
      }
      actions={
        <>
          {primary}
          {secondary}
          <div className="links">
            {links}
            {!run.easier && !hideEasier && (
              <button type="button" className="btn btn-quiet" onClick={run.makeEasier} data-act="easier">
                Make it easier
              </button>
            )}
            <button type="button" className="btn btn-quiet" onClick={run.end} data-act="end">
              End
            </button>
          </div>
        </>
      }
    >
      {children}
    </Screen>
  );
}
