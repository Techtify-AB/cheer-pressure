"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { CrisisCard } from "@/components/CrisisCard";
import { Says, Screen, StepCount } from "@/components/Screen";
import { useCompanionVoice, useCrisisCheck, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { ReadAloudStep } from "@/components/ReadAloudStep";
import { ScaleButtons } from "@/components/ScaleButtons";
import { brain } from "@/lib/brain";
import { containsCrisisWords } from "@/lib/crisis";
import { newId, shiftClock } from "@/lib/dates";
import { saveDaily, useData } from "@/lib/storage";
import type { AppData, DailyEntry } from "@/lib/types";

const QUESTIONS = [
  "How did you sleep? When did you go to bed, and when did you wake up?",
  "How is your form today?",
  "Anything you'd like to note? It's optional.",
  "Last one. Please read this sentence aloud.",
];

const FORM_OPTIONS: { value: DailyEntry["form"]; label: string }[] = [
  { value: 1, label: "Very low" },
  { value: 2, label: "Low" },
  { value: 3, label: "Okay" },
  { value: 4, label: "Good" },
  { value: 5, label: "Very good" },
];

export default function CheckInPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  if (!data || !ready) return null;
  return <CheckInFlow data={data} />;
}

function TimeStepper({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="stepper">
        <button type="button" aria-label={`${label}: 15 minutes earlier`} onClick={() => onChange(shiftClock(value, -15))}>
          −
        </button>
        <input id={id} type="time" step={300} value={value} required onChange={(e) => e.target.value && onChange(e.target.value)} />
        <button type="button" aria-label={`${label}: 15 minutes later`} onClick={() => onChange(shiftClock(value, 15))}>
          +
        </button>
      </div>
    </div>
  );
}

function CheckInFlow({ data }: { data: AppData }) {
  const router = useRouter();
  const today = useToday();
  const voice = useCompanionVoice();
  const { levels } = useReflection(data);
  // Only the person's own entries pre-fill the form, never made-up demo ones.
  const own = data.daily.filter((e) => e.source === "user");
  const existing = own.find((e) => e.date === today);
  const previous = existing ?? own[own.length - 1];

  const [step, setStep] = useState(0);
  const [bedtime, setBedtime] = useState(previous?.bedtime ?? "23:00");
  const [wakeTime, setWakeTime] = useState(previous?.wakeTime ?? "07:00");
  const [form, setForm] = useState<DailyEntry["form"] | null>(existing?.form ?? null);
  const [note, setNote] = useState(existing?.note ?? "");
  const [finished, setFinished] = useState<null | { crisis: boolean; line: string; saved: boolean }>(null);

  const { say, quiet } = voice;
  // Read the first question once when the check-in opens.
  useEffect(() => {
    say(QUESTIONS[0]);
  }, [say]);

  const go = (next: number) => {
    setStep(next);
    say(QUESTIONS[next]);
  };

  const save = useCallback(
    (speechRate: number | null, text: string) => {
      if (!form) return false;
      const trimmed = text.trim();
      // A note with crisis wording is never stored; the rest of the check-in is.
      const keep = trimmed && !containsCrisisWords(trimmed) ? trimmed : undefined;
      saveDaily({
        id: existing?.id ?? newId(),
        date: today,
        bedtime,
        wakeTime,
        form,
        speechRate,
        note: keep,
        source: "user",
        savedAt: new Date().toISOString(),
      });
      return true;
    },
    [form, existing, today, bedtime, wakeTime],
  );

  /** Crisis words in the note: the handoff card right away, no read-aloud step. */
  const handOff = (text: string) => {
    if (finished) return;
    quiet();
    const saved = save(null, text);
    setFinished({ crisis: true, line: "", saved });
  };

  // Checked while typing, when typing pauses, on blur, on Next and Back, and on any link
  // that leaves the page. Once the card shows, links work as usual again.
  const crisisCheck = useCrisisCheck(handOff, () => (finished ? "" : note));

  const onNoteChange = (value: string) => {
    setNote(value);
    crisisCheck.typed(value);
  };

  const leaveNoteStep = () => {
    if (!crisisCheck.full(note)) go(3);
  };

  const back = () => {
    if (!crisisCheck.full(note)) go(step - 1);
  };

  const finish = useCallback(
    (speechRate: number | null) => {
      if (!save(speechRate, note)) return;
      const crisis = containsCrisisWords(note);
      const line = brain.closingLine("daily", today);
      setFinished({ crisis, line, saved: true });
      if (!crisis) say(line);
      else quiet();
    },
    [save, note, today, say, quiet],
  );

  // The check-in ends by itself: back home a few seconds after the closing line.
  useEffect(() => {
    if (!finished || finished.crisis) return;
    const t = window.setTimeout(() => router.push("/"), 4000);
    return () => window.clearTimeout(t);
  }, [finished, router]);

  const usualRate = levels?.metrics.find((m) => m.key === "speech")?.usual?.median ?? null;

  const home = (
    <Link href="/" className="btn btn-primary">
      Back to home
    </Link>
  );

  if (finished) {
    if (finished.crisis) {
      return (
        <Screen
          lead={
            finished.saved ? (
              <p className="muted">Your answers are saved. What you wrote in the note was not kept.</p>
            ) : null
          }
          actions={home}
        >
          <CrisisCard />
        </Screen>
      );
    }
    return (
      <Screen
        lead={
          <Says state={voice.state} size={88}>
            <p>{finished.line}</p>
          </Says>
        }
        actions={home}
      />
    );
  }

  const lead = (
    <>
      <Says state={voice.state}>
        <h1 id="question">{QUESTIONS[step]}</h1>
      </Says>
      <StepCount index={step} total={QUESTIONS.length} />
    </>
  );

  const backLink =
    step > 0 ? (
      <button type="button" className="btn btn-quiet" onClick={back}>
        Back
      </button>
    ) : (
      <Link href="/" className="btn btn-quiet">
        Not now
      </Link>
    );

  if (step === 3) {
    return (
      <div className="screen">
        <div className="screen-lead">{lead}</div>
        <ReadAloudStep usualRate={usualRate} onListening={voice.setListening} onFinish={finish} links={backLink} />
      </div>
    );
  }

  const next =
    step === 0 ? (
      <button type="button" className="btn btn-primary" onClick={() => go(1)}>
        Next
      </button>
    ) : step === 1 ? (
      <button type="button" className="btn btn-primary" disabled={!form} onClick={() => go(2)}>
        {form ? "Next" : "Pick a number to go on"}
      </button>
    ) : (
      <button type="button" className="btn btn-primary" onClick={leaveNoteStep}>
        Next
      </button>
    );

  return (
    <Screen
      lead={lead}
      actions={
        <>
          {next}
          <div className="links">{backLink}</div>
        </>
      }
    >
      {step === 0 && (
        <>
          <TimeStepper id="bedtime" label="Went to bed" value={bedtime} onChange={setBedtime} />
          <TimeStepper id="waketime" label="Woke up" value={wakeTime} onChange={setWakeTime} />
        </>
      )}
      {step === 1 && <ScaleButtons label="Today's form, 1 to 5" options={FORM_OPTIONS} value={form} onChange={setForm} />}
      {step === 2 && (
        <div className="field">
          <label htmlFor="note">Your note, in your own words</label>
          <textarea
            id="note"
            value={note}
            maxLength={500}
            onFocus={() => voice.setListening(true)}
            onBlur={(e) => {
              voice.setListening(false);
              crisisCheck.full(e.target.value);
            }}
            onChange={(e) => onNoteChange(e.target.value)}
          />
          <p className="small muted">Kept on this device only. Leave it empty if you like.</p>
        </div>
      )}
    </Screen>
  );
}
