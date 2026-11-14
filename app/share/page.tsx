"use client";

// "Share with my clinic": the exact report first, one part at a time, then the person's own
// act: Save as PDF or Print, or Not now. Nothing is sent over the network from here; there
// is no clinic integration in this version and the messages service never receives this.
// The ladder's third step opens this screen (?from=ladder).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequireProfile, useToday } from "@/components/hooks";
import { Pager, Screen } from "@/components/Screen";
import { answerClinic, isActive } from "@/lib/ladder";
import { printPage } from "@/lib/platform";
import { clinicReport, type Report } from "@/lib/report";
import { hasDemo, readData, saveLadder, useData } from "@/lib/storage";

type Part = { title: string; body: React.ReactNode };

function parts(r: Report): Part[] {
  return [
    {
      title: "What they would get",
      body: (
        <>
          <p>{r.summary}</p>
          <p className="small muted">
            {r.period.text}. Compared only with my own usual, never with other people.
            {r.simulated ? " Includes made-up demo data." : ""}
          </p>
          <p className="small report-disclaimer">{r.disclaimer}</p>
        </>
      ),
    },
    ...r.sources.map((s) => ({
      title: `${s.label}${s.standsOut ? ", stands out" : ""}`,
      body: (
        <ul className="report-list">
          {s.lines.map((l) => (
            <li key={l.label}>
              <strong>{l.label}.</strong> {l.text}
            </li>
          ))}
        </ul>
      ),
    })),
    {
      title: "How many days it rests on",
      body: (
        <ul className="report-list">
          {r.quality.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      ),
    },
    {
      title: "My answers and the steps Cheri offered",
      body: (
        <ul className="report-list">
          {(r.answers.length ? r.answers : ["No answers to Cheri in this period."]).slice(-4).map((a) => (
            <li key={a}>{a}</li>
          ))}
          {r.weekly.slice(-2).map((w) => (
            <li key={w}>{w}</li>
          ))}
          {(r.ladder.length ? r.ladder : ["No steps were offered in this period."]).slice(-3).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ),
    },
    {
      title: "What each value is, and is not",
      body: (
        <ul className="report-list">
          {r.legend.map((g) => (
            <li key={g.label}>
              <strong>{g.label}.</strong> {g.isNot}.
            </li>
          ))}
        </ul>
      ),
    },
  ];
}

/** The whole report on one A4 page, shown only when printing. */
function PrintReport({ r }: { r: Report }) {
  return (
    <article className="print-report" aria-hidden="true">
      <header>
        <h1>My values from Cheer Pressure</h1>
        <p>
          {r.period.text}. Shared by me. Compared only with my own usual, never with other people.
          {r.simulated ? " Includes made-up demo data." : ""}
        </p>
        <p className="report-disclaimer">{r.disclaimer}</p>
      </header>
      <section>
        <h2>Summary</h2>
        <p>{r.summary}</p>
      </section>
      {r.sources.map((s) => (
        <section key={s.id}>
          <h2>
            {s.label}
            {s.standsOut ? ": stands out" : ""}
          </h2>
          <ul>
            {s.lines.map((l) => (
              <li key={l.label}>
                <strong>{l.label}.</strong> {l.text}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <section>
        <h2>How many days this rests on</h2>
        <ul>
          {r.quality.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>My answers to Cheri</h2>
        <ul>
          {(r.answers.length ? r.answers : ["None in this period."]).map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
        {r.weekly.length ? (
          <>
            <h2>Weekly questions (PHQ-2, 0 to 6)</h2>
            <ul>
              {r.weekly.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </>
        ) : null}
        <h2>Steps Cheri offered</h2>
        <ul>
          {(r.ladder.length ? r.ladder : ["None in this period."]).map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
      <section>
        <h2>What each value is</h2>
        <ul>
          {r.legend.map((g) => (
            <li key={g.label}>
              <strong>{g.label}:</strong> {g.is}. {g.isNot}.
            </li>
          ))}
        </ul>
      </section>
      <footer>{r.disclaimer}</footer>
    </article>
  );
}

export default function SharePage() {
  const data = useData();
  const ready = useRequireProfile(data);
  const today = useToday();
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [fromLadder, setFromLadder] = useState(false);
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setFromLadder(new URLSearchParams(window.location.search).get("from") === "ladder"), 0);
    return () => window.clearTimeout(id);
  }, []);
  if (!data || !ready) return null;

  const report = clinicReport(data, today);
  const list = parts(report);
  const part = list[Math.min(index, list.length - 1)];
  const demo = hasDemo(data) || !!data.settings.simulatedChangeAt;
  const answerLadder = (a: "approve" | "not-now") => {
    const l = readData().ladder;
    if (fromLadder && isActive(l)) saveLadder(answerClinic(l, a, today));
  };

  if (approved) {
    return (
      <Screen
        lead={
          <>
            <span className="placeholder-tag">Demo</span>
            <h1 className="item-title">Marked as a demo recipient. Nothing was sent.</h1>
          </>
        }
        actions={
          <Link href="/" className="btn btn-primary">
            Back to home
          </Link>
        }
      />
    );
  }

  return (
    <>
      <Screen
        lead={
          <div className="item-lead">
            <p className="small muted">Share with my clinic: exactly what they would get</p>
            <h1>{part.title}</h1>
          </div>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                answerLadder("approve");
                void printPage();
              }}
            >
              Save as PDF or print
            </button>
            <Pager index={index} total={list.length} onChange={setIndex} secondary />
            <div className="links">
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  answerLadder("not-now");
                  router.push(fromLadder ? "/" : "/values/");
                }}
              >
                Not now
              </button>
              {fromLadder && demo && (
                <button
                  type="button"
                  className="btn btn-quiet"
                  onClick={() => {
                    answerLadder("approve");
                    setApproved(true);
                  }}
                >
                  Approve for the demo clinic
                </button>
              )}
            </div>
          </>
        }
      >
        <section className="card stack-sm report-part" aria-live="polite">
          {part.body}
          {index === 0 && (
            <p className="small muted report-note">
              Nothing is sent from here. You save or print it yourself, each time you choose to.
            </p>
          )}
        </section>
      </Screen>
      <PrintReport r={report} />
    </>
  );
}
