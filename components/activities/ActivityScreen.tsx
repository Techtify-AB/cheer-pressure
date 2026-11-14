"use client";

// The one screen every activity uses (components/Screen.tsx underneath): the title and the
// first thing to do, the activity itself, then one primary button and the quiet links
// "Make it easier" and "End". At most four groups, no page scrolling.

import Link from "next/link";
import { Says, Screen } from "@/components/Screen";
import type { ActivityRun } from "./useActivity";
import { LIBRARY_HREF } from "./useActivity";

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
  return (
    <Screen
      lead={
        <div className="act-lead" data-activity={run.id} data-easier={run.easier ? "" : undefined}>
          <p className="act-eyebrow">{eyebrow ?? (run.easier ? "A smaller step" : "Something for you")}</p>
          <h1 className="act-title">{title}</h1>
          {text ? <div className="act-text">{text}</div> : null}
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

/** After "Done": what was recorded, said briefly, and the way back. */
export function DoneView({ message }: { message?: string }) {
  return (
    <Screen
      lead={
        <Says state="joy" size={80}>
          <h1 className="act-done-title">{message ?? "Good. That was one thing for you."}</h1>
        </Says>
      }
      actions={
        <>
          <Link href="/" className="btn btn-primary" data-act="home">
            Back to home
          </Link>
          <div className="links">
            <Link href={LIBRARY_HREF} className="btn btn-quiet">
              Something else
            </Link>
          </div>
        </>
      }
    >
      <p className="muted act-done-note">Noted on this device. Only you see it.</p>
    </Screen>
  );
}
