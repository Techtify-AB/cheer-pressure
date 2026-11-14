"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Companion } from "@/components/companion/Companion";
import { CrisisCard } from "@/components/CrisisCard";
import { useCompanionVoice } from "@/components/hooks";
import { containsCrisisWords, containsCrisisWordsWhileTyping } from "@/lib/crisis";
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
  "Hi. I'm a small companion for the time after treatment. I'm a tool, not a therapist: I help you notice changes compared with your own usual days.";
const QUESTION = "What did you notice first last time?";

export default function SetupPage() {
  const data = useData();
  const router = useRouter();
  const voice = useCompanionVoice();
  const [step, setStep] = useState<"intro" | "signs">("intro");
  const [signs, setSigns] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const [crisis, setCrisis] = useState(false);

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
    // Checked on every change, so the handoff card shows as soon as the words are typed.
    if (containsCrisisWordsWhileTyping(value)) {
      voice.quiet();
      setCrisis(true);
    }
  };

  const addCustom = () => {
    const text = tidy(custom);
    if (!text) return;
    if (containsCrisisWords(text)) {
      setCrisis(true);
      return;
    }
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
      <div className="stack-lg">
        <div className="companion-row">
          <Companion state={voice.state} size={150} />
          <div className="bubble" aria-live="polite">
            <p>{INTRO}</p>
          </div>
        </div>
        <div className="card stack">
          <p style={{ marginBottom: 0 }}>
            Your answers stay in this browser. There is no account, and nothing is sent anywhere.
          </p>
        </div>
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
        <div className="notice">
          <button type="button" className="btn btn-quiet" onClick={() => voice.say(INTRO)}>
            Read this aloud
          </button>
        </div>
      </div>
    );
  }

  const full = signs.length >= MAX_SIGNS;
  const customOnly = signs.filter((s) => !COMMON_SIGNS.includes(s));

  return (
    <div className="stack-lg">
      <div className="companion-row">
        <Companion state={voice.state} size={110} />
        <div className="bubble" aria-live="polite">
          <p>{QUESTION}</p>
          <p className="small muted">
            Before things got harder last time, what changed first? Pick or type up to three. I&apos;ll keep
            these in mind and ask about them only when something seems to have changed.
          </p>
        </div>
      </div>

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
                onBlur={() => voice.setListening(false)}
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

          <p className="small muted" aria-live="polite">
            {signs.length === 0
              ? "Nothing picked yet. You can also skip this and add nothing."
              : `${signs.length} of ${MAX_SIGNS} picked${full ? ". Tap one to unpick it." : "."}`}
          </p>
        </>
      )}

      <button type="button" className="btn btn-primary" onClick={finish}>
        {signs.length || (!crisis && tidy(custom)) ? "Save and continue" : "Skip for now"}
      </button>
    </div>
  );
}
