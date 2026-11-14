"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useCompanionVoice, useRequireProfile, useToday } from "@/components/hooks";
import { Says, Screen, StepCount } from "@/components/Screen";
import { OptionList } from "@/components/ScaleButtons";
import { brain } from "@/lib/brain";
import { formatDay, newId } from "@/lib/dates";
import { saveWeekly, useData } from "@/lib/storage";
import type { AppData, Scale03 } from "@/lib/types";

// Standard PHQ-2 answer scale.
const SCALE: { value: Scale03; label: string }[] = [
  { value: 0, label: "Not at all" },
  { value: 1, label: "Several days" },
  { value: 2, label: "More than half the days" },
  { value: 3, label: "Nearly every day" },
];

type ItemKey = "down" | "interest" | "sleep" | "tense";
interface Item {
  key: ItemKey | `sign:${string}`;
  text: string;
  stem: string;
}

const STEM = "Over the last week, how often have you been bothered by this?";
const SIGN_STEM = "Over the last week, how often have you noticed this early sign?";

export default function WeeklyPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  if (!data || !ready) return null;
  return <WeeklyFlow data={data} />;
}

function WeeklyFlow({ data }: { data: AppData }) {
  const router = useRouter();
  const today = useToday();
  const voice = useCompanionVoice();
  const { say } = voice;

  const items: Item[] = [
    { key: "down", text: "Feeling down, depressed or hopeless", stem: STEM },
    { key: "interest", text: "Little interest or pleasure in doing things", stem: STEM },
    { key: "sleep", text: "Trouble falling or staying asleep, or sleeping too much", stem: STEM },
    { key: "tense", text: "Feeling tense, nervous or on edge", stem: STEM },
    ...(data.profile?.earlySigns ?? []).map((s) => ({
      key: `sign:${s}` as const,
      text: s,
      stem: SIGN_STEM,
    })),
  ];

  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Scale03>>({});
  const [doneLine, setDoneLine] = useState<string | null>(null);
  const last = data.weekly[data.weekly.length - 1];

  const spoken = (i: number) => `${items[i].stem} ${items[i].text}.`;
  const busy = useRef(false);

  useEffect(() => {
    say(`${items[0].stem} ${items[0].text}.`);
    // only when the questions open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [say]);

  useEffect(() => {
    if (!doneLine) return;
    const t = window.setTimeout(() => router.push("/"), 4000);
    return () => window.clearTimeout(t);
  }, [doneLine, router]);

  const save = (all: Record<string, Scale03>) => {
    saveWeekly({
      id: newId(),
      date: today,
      down: all.down,
      interest: all.interest,
      sleep: all.sleep,
      tense: all.tense,
      signs: (data.profile?.earlySigns ?? []).map((s) => ({ sign: s, value: all[`sign:${s}`] ?? 0 })),
      source: "user",
      savedAt: new Date().toISOString(),
    });
    const line = brain.closingLine("weekly", today);
    setDoneLine(line);
    say(line);
  };

  const answer = (v: Scale03) => {
    if (busy.current) return;
    busy.current = true;
    const next = { ...answers, [items[index].key]: v };
    setAnswers(next);
    window.setTimeout(() => {
      busy.current = false;
      if (index + 1 < items.length) {
        setIndex(index + 1);
        say(spoken(index + 1));
      } else {
        save(next);
      }
    }, 220);
  };

  if (doneLine) {
    return (
      <Screen
        lead={
          <Says state={voice.state} size={88}>
            <p>{doneLine}</p>
            <p className="small muted">Saved for {formatDay(today)}, on this device only.</p>
          </Says>
        }
        actions={
          <Link href="/" className="btn btn-primary">
            Back to home
          </Link>
        }
      />
    );
  }

  const item = items[index];
  const current = answers[item.key] ?? null;

  return (
    <Screen
      lead={
        <>
          <Says state={voice.state}>
            <p className="small muted" style={{ marginBottom: "var(--space-1)" }}>
              {item.stem}
            </p>
            <h1>{item.text}</h1>
          </Says>
          <StepCount index={index} total={items.length} label="Weekly questions" />
        </>
      }
      actions={
        <div className="links">
          {index > 0 && (
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => {
                setIndex(index - 1);
                say(spoken(index - 1));
              }}
            >
              Back
            </button>
          )}
          <Link href="/" className="btn btn-quiet">
            Not now
          </Link>
        </div>
      }
    >
      <OptionList label={item.text} options={SCALE} value={current} onChange={answer} />
      {last && <p className="small muted">You last answered these on {formatDay(last.date)}.</p>}
    </Screen>
  );
}
