"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CrisisCard } from "@/components/CrisisCard";
import { Says, Screen, StepCount } from "@/components/Screen";
import { useCompanionVoice, useCrisisCheck } from "@/components/hooks";
import { containsCrisisWords } from "@/lib/crisis";
import { saveProfile, useData } from "@/lib/storage";

const MAX_SIGNS = 3;

const COMMON_SIGNS = [
  "Going to bed later",
  "Waking up too early",
  "Pulling away from people",
  "Losing interest in things",
  "Feeling tired all the time",
  "Finding it hard to focus",
  "Eating more or less",
  "Feeling tense",
];

const INTRO =
  "Hi, I'm Cheri. I'm a tool, not a therapist: a small companion for the time after treatment that helps you notice changes compared with your own usual days.";
const QUESTION = "What did you notice first last time?";

export default function SetupPage() {
  const data = useData();
  const router = useRouter();
  const voice = useCompanionVoice();
  const [step, setStep] = useState<"intro" | "signs">("intro");
  const [signs, setSigns] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [crisis, setCrisis] = useState(false);
  const crisisCheck = useCrisisCheck(() => {
    voice.quiet();
    setCrisis(true);
  });

  // Already set up: go home.
  useEffect(() => {
    if (data?.profile) router.replace("/");
  }, [data, router]);

  if (!data || data.profile) return null;

  const toggle = (sign: string) => {
    setSigns((cur) => (cur.includes(sign) ? cur.filter((s) => s !== sign) : cur.length < MAX_SIGNS ? [...cur, sign] : cur));
  };

  const tidy = (raw: string) => raw.trim().replace(/\s+/g, " ").slice(0, 60);

  /** The signs with the typed text added, if it is new and there is room. */
  const withCustom = (text: string): string[] => {
    if (!text || signs.length >= MAX_SIGNS || signs.some((s) => s.toLowerCase() === text.toLowerCase())) return signs;
    return [...signs, text];
  };

  const onCustomChange = (value: string) => {
    setCustom(value);
    // Checked on every change, so the handoff card shows as soon as the words are typed,
    // and again with the last word included when typing pauses.
    crisisCheck.typed(value);
  };

  const addCustom = () => {
    const text = tidy(custom);
    if (!text) return;
    if (crisisCheck.full(text)) return;
    setSigns(withCustom(text));
    setCustom("");
  };

  const finish = () => {
    const text = tidy(custom);
    // Typed but not added: never dropped in silence. Crisis words show the card first
    // and are never saved as an early sign.
    if (containsCrisisWords(text) && !crisis) {
      voice.quiet();
      setCrisis(true);
      return;
    }
    const earlySigns = crisis || !text ? signs : withCustom(text);
    voice.quiet();
    saveProfile({ createdAt: new Date().toISOString(), earlySigns });
    router.replace("/");
  };

  if (step === "intro") {
    return (
      <Screen
        lead={
          <>
            <Says state={voice.state} size={88}>
              <p>{INTRO}</p>
            </Says>
            <StepCount index={0} total={2} />
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setStep("signs");
                voice.say(QUESTION);
              }}
            >
              Get started
            </button>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={() => voice.say(INTRO)}>
                Read this aloud
              </button>
            </div>
          </>
        }
      >
        <div className="card">
          <p style={{ marginBottom: 0 }}>
            Your measurements stay on this device unless you choose to save or print a report for your clinic, and there is no account. Only messages with someone you trust, if you connect one, pass through a messages service.
          </p>
        </div>
      </Screen>
    );
  }

  const full = signs.length >= MAX_SIGNS;
  const customOnly = signs.filter((s) => !COMMON_SIGNS.includes(s));

  return (
    <Screen
      lead={
        <>
          <Says state={voice.state}>
            <h1>{QUESTION}</h1>
            <p className="small muted" hidden={crisis}>
              Pick or type up to three. I&apos;ll keep them in mind and ask about them only when something seems to
              have changed.
            </p>
          </Says>
          <StepCount index={1} total={2} />
        </>
      }
      actions={
        <>
          <button type="button" className="btn btn-primary" onClick={finish}>
            {signs.length || (!crisis && tidy(custom)) ? "Save and continue" : "Skip for now"}
          </button>
          <div className="links">
            <button type="button" className="btn btn-quiet" onClick={() => setStep("intro")}>
              Back
            </button>
          </div>
        </>
      }
    >
      {crisis ? (
        <CrisisCard />
      ) : (
        <>
          <fieldset className="bare-fieldset">
            <legend className="sr-only">Early signs to pick from</legend>
            <div className="chips">
              {[...COMMON_SIGNS, ...customOnly].map((s) => {
                const on = signs.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    disabled={!on && full}
                    onClick={() => toggle(s)}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="custom-sign">Something else? Type it in your own words</label>
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
              <input
                id="custom-sign"
                type="text"
                value={custom}
                maxLength={60}
                disabled={full}
                placeholder={full ? "You've picked three" : "For example: stopped cooking"}
                onFocus={() => voice.setListening(true)}
                onBlur={(e) => {
                  voice.setListening(false);
                  crisisCheck.full(e.target.value);
                }}
                onChange={(e) => onCustomChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustom();
                  }
                }}
              />
              <button type="button" className="btn btn-secondary" onClick={addCustom} disabled={full || !custom.trim()}>
                Add
              </button>
            </div>
          </div>

          <p className="small muted" aria-live="polite" style={{ marginBottom: 0 }}>
            {signs.length === 0
              ? "Nothing picked yet. You can also skip this."
              : `${signs.length} of ${MAX_SIGNS} picked${full ? ". Tap one to unpick it." : "."}`}
          </p>
        </>
      )}
    </Screen>
  );
}
