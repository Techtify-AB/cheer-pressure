"use client";

// "Things to do": the activities, three to a view, paged instead of scrolled. Each opens its
// own page. Step one of the ladder opens the one that fits the suggestion directly.
// Ordered by what was learned (lib/helps.ts, through lib/activities/learning.ts): mainly whether
// the person's days moved back towards their usual in the three days after, then what they said
// when asked "Did that help?". Those followed by better days first, untried ones next, ones that
// did not seem to help last. The quick reaction check is last.

import Link from "next/link";
import { useMemo, useState } from "react";
import { Pager, Screen } from "@/components/Screen";
import { ACTIVITIES, activityHref } from "@/lib/activities";
import { learnFromValues, orderActivities } from "@/lib/activities/learning";
import { useToday } from "@/components/hooks";
import { useData } from "@/lib/storage";

const REACTION = {
  id: "reaction",
  href: "/activities/reaction/",
  title: "A quick reaction check",
  line: "Five taps, as fast as you can. Experimental.",
  takes: "15 seconds",
};

const PER_VIEW = 3;

export default function ActivitiesPage() {
  const data = useData();
  const [page, setPage] = useState(0);
  const today = useToday();
  const occasions = useMemo(() => (data ? learnFromValues(data, today) : []), [data, today]);
  const order = orderActivities(
    ACTIVITIES.map((a) => a.id),
    occasions,
    data?.activitiesDone ?? [],
  );
  const items = [
    ...order.map((id) => {
      const a = ACTIVITIES.find((x) => x.id === id)!;
      return { id: a.id as string, href: activityHref(a.id), title: a.title, line: a.line, takes: a.takes };
    }),
    REACTION,
  ];
  const pages = Math.ceil(items.length / PER_VIEW);
  const shown = items.slice(page * PER_VIEW, page * PER_VIEW + PER_VIEW);
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
            <Link href={a.href} className="act-library-item" data-activity={a.id}>
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
