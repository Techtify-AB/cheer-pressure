"use client";

// "Things to do": the activities, three to a view, paged instead of scrolled. Each opens its
// own page. Step one of the ladder opens the one that fits the suggestion directly.

import Link from "next/link";
import { useState } from "react";
import { Pager, Screen } from "@/components/Screen";
import { ACTIVITIES, activityHref } from "@/lib/activities";

const PER_VIEW = 3;

export default function ActivitiesPage() {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(ACTIVITIES.length / PER_VIEW);
  const shown = ACTIVITIES.slice(page * PER_VIEW, page * PER_VIEW + PER_VIEW);
  return (
    <Screen
      lead={
        <div className="act-lead">
          <h1 className="act-title">Things to do</h1>
          <p className="act-text muted">Small things for you, a minute or a few. Pick one, or none.</p>
        </div>
      }
      actions={
        <>
          <Pager index={page} total={pages} onChange={setPage} secondary />
          <div className="links">
            <Link href="/activities/plan/" className="btn btn-quiet">
              My plan
            </Link>
            <Link href="/" className="btn btn-quiet">
              Back to home
            </Link>
          </div>
        </>
      }
    >
      <ul className="act-library" aria-label={`Things to do, ${page + 1} of ${pages}`}>
        {shown.map((a) => (
          <li key={a.id}>
            <Link href={activityHref(a.id)} className="act-library-item" data-activity={a.id}>
              <span className="act-library-title">{a.title}</span>
              <span className="act-library-line">{a.line}</span>
              <span className="act-library-takes">{a.takes}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
