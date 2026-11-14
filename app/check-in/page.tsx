"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Companion } from "@/components/companion/Companion";
import { CrisisCard } from "@/components/CrisisCard";
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

  const leaveFormStep = () => {
    if (!crisisCheck.full(note)) go(2);
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

  if (finished) {
    return (
      <div className="stack-lg">
        {finished.crisis ? (
          <>
            {finished.saved && <p className="muted">Your answers are saved. What you wrote in the note was not kept.</p>}
            <CrisisCard />
            <Link href="/" className="btn btn-secondary">
              Back to home
            </Link>
          </>
        ) : (
          <>
            <div className="companion-row">
              <Companion state={voice.state} size={150} />
              <div className="bubble" aria-live="polite">
                <p>{finished.line}</p>
              </div>
            </div>
            <div className="notice">
              <Link href="/" className="btn btn-quiet">
                Back to home
              </Link>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <div>
        <div className="progress" aria-hidden="true">
          {QUESTIONS.map((_, i) => (
            <span key={i} className={i <= step ? "on" : ""} />
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Step {step + 1} of {QUESTIONS.length}
        </p>
      </div>

      <div className="companion-row" style={{ flexDirection: "row", textAlign: "left", alignItems: "center" }}>
        <div style={{ flex: "0 0 auto" }}>
          <Companion state={voice.state} size={84} />
        </div>
        <div className="bubble" style={{ flex: 1 }} aria-live="polite">
          <h1 style={{ fontSize: "var(--font-size-lg)", marginBottom: 0 }}>{QUESTIONS[step]}</h1>
        </div>
      </div>

      {step === 0 && (
        <div className="stack">
          <TimeStepper id="bedtime" label="Went to bed" value={bedtime} onChange={setBedtime} />
          <TimeStepper id="waketime" label="Woke up" value={wakeTime} onChange={setWakeTime} />
          <button type="button" className="btn btn-primary" onClick={() => go(1)}>
            Next
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <ScaleButtons label="Today's form, 1 to 5" options={FORM_OPTIONS} value={form} onChange={setForm} />
          <div className="field">
            <label htmlFor="note">Anything you&apos;d like to note? Optional</label>
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
          </div>
          <button type="button" className="btn btn-primary" disabled={!form} onClick={leaveFormStep}>
            {form ? "Next" : "Pick a number to go on"}
          </button>
        </div>
      )}

      {step === 2 && <ReadAloudStep usualRate={usualRate} onListening={voice.setListening} onFinish={finish} />}

      {step > 0 && (
        <div className="notice">
          <button type="button" className="btn btn-quiet" onClick={back}>
            Back
          </button>
        </div>
      )}
    </div>
  );
}
