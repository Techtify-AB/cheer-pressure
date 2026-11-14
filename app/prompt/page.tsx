"use client";

// The check-in the companion proposes when at least two passive measures stand out
// from the person's own range (lib/passive.ts). First a plain explanation of what
// changed, then one question with three tap answers. No percentages, no score.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ClinicContactPlaceholder } from "@/components/ClinicContactPlaceholder";
import { Companion } from "@/components/companion/Companion";
import { useCompanionVoice, useReflection, useRequireProfile, useToday } from "@/components/hooks";
import { newId } from "@/lib/dates";
import { evaluatePassive } from "@/lib/passive";
import { saveCheckIn, useData } from "@/lib/storage";
import type { AppData, CheckInAnswer } from "@/lib/types";

const QUESTION = "How are you doing?";

const ANSWERS: { value: Exclude<CheckInAnswer, "not-now">; label: string }[] = [
  { value: "okay", label: "I'm okay" },
  { value: "not-best", label: "Not my best" },
  { value: "someone", label: "I'd like someone to check in on me" },
];

export default function PromptPage() {
  const data = useData();
  const ready = useRequireProfile(data);
  if (!data || !ready) return null;
  return <PromptFlow data={data} />;
}

function PromptFlow({ data }: { data: AppData }) {
  const router = useRouter();
  const today = useToday();
  const voice = useCompanionVoice();
  // Judged once when the page opens, so saving the answer does not change the text.
  const [evaluation] = useState(() => evaluatePassive(data, today));
  const [answer, setAnswer] = useState<CheckInAnswer | null>(null);
  // What to say comes from the brain (lib/brain.ts); whether to ask came from lib/passive.ts.
  const { reflection } = useReflection(data, evaluation);

  const record = (value: CheckInAnswer) => {
    saveCheckIn({
      id: newId(),
      date: today,
      at: new Date().toISOString(),
      answer: value,
      triggeredBy: evaluation.changed.map((m) => ({ key: m.key, direction: m.direction ?? "up" })),
      basedOn: evaluation.basedOn,
      simulated: evaluation.simulated,
    });
    setAnswer(value);
  };

  // "I'm okay" ends by itself after a short closing line.
  useEffect(() => {
    if (answer !== "okay") return;
    const t = window.setTimeout(() => router.push("/"), 4000);
    return () => window.clearTimeout(t);
  }, [answer, router]);

  const demoTag = evaluation.simulated && (
    <p className="notice">
      <span className="placeholder-tag">Demo</span>
      <span>This change is simulated with made-up data.</span>
    </p>
  );

  if (!evaluation.askNow && answer === null) {
    return (
      <div className="stack-lg">
        <div className="companion-row">
          <Companion state="idle" size={150} />
          <div className="bubble">
            <p>Nothing stands out compared with your usual right now. Nothing is needed from you.</p>
          </div>
        </div>
        <div className="notice">
          <Link href="/check-in/">Tell me how you&apos;re doing anyway</Link>
          <Link href="/">Back to home</Link>
        </div>
      </div>
    );
  }

  if (answer === "okay") {
    return (
      <div className="stack-lg">
        <div className="companion-row">
          <Companion state="idle" size={150} />
          <div className="bubble" aria-live="polite">
            <p>Good to hear. Thanks for telling me. That&apos;s all for now.</p>
          </div>
        </div>
        <div className="notice">
          <Link href="/" className="btn btn-quiet">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  if (answer === "not-best") {
    return (
      <div className="stack-lg">
        <div className="companion-row">
          <Companion state="idle" size={130} />
          <div className="bubble" aria-live="polite">
            <p>Thanks for telling me. Not every day is a good one.</p>
            <p className="suggestion">
              <strong>One small thing to try:</strong> {reflection?.passive.suggestion.text}
            </p>
          </div>
        </div>
        <section className="card stack" aria-labelledby="weekly-offer">
          <h2 id="weekly-offer" style={{ fontSize: "var(--font-size-lg)", marginBottom: 0 }}>
            A few more questions, if you like
          </h2>
          <p style={{ marginBottom: 0 }}>
            A few short questions about the last week. They help you and your clinic see how things are going. Only
            if you feel like it.
          </p>
          <div className="btn-row">
            <Link href="/weekly/" className="btn btn-secondary">
              Answer the weekly questions
            </Link>
            <Link href="/" className="btn btn-quiet">
              Not now
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (answer === "someone") {
    return (
      <div className="stack-lg">
        <section className="placeholder stack" aria-labelledby="contact-title">
          <span className="placeholder-tag">Placeholder</span>
          <h1 id="contact-title" style={{ fontSize: "var(--font-size-xl)", marginBottom: 0 }}>
            Contact request (not connected yet)
          </h1>
          <p style={{ marginBottom: 0 }}>
            In the finished app, this lets someone you trust know that you&apos;d like them to check in on you. It
            isn&apos;t connected yet, so <strong>nothing has been sent</strong>.
          </p>
        </section>
        <section className="card stack" aria-labelledby="reach-title">
          <h2 id="reach-title" style={{ fontSize: "var(--font-size-lg)", marginBottom: 0 }}>
            You can reach someone now
          </h2>
          <p style={{ marginBottom: 0 }}>Call or message someone you trust, or contact your clinic.</p>
          <ClinicContactPlaceholder />
          <p style={{ marginBottom: 0 }}>
            If you are in danger or might hurt yourself, call <a href="tel:112">112</a>.
          </p>
        </section>
        <div className="notice">
          <Link href="/">Back to home</Link>
        </div>
      </div>
    );
  }

  if (!reflection) return null;
  const explanation = reflection.passive.explanation;

  return (
    <div className="stack-lg">
      {demoTag}
      <div className="companion-row">
        <Companion state={voice.state} size={130} />
        <div className="bubble" aria-live="polite">
          <p>{explanation}</p>
          <p className="small muted">This compares you only with your own earlier days.</p>
        </div>
        <button type="button" className="btn btn-quiet small" onClick={() => voice.say(`${explanation} ${QUESTION}`)}>
          Read this aloud
        </button>
      </div>

      <section className="stack" aria-labelledby="question">
        <h1 id="question" style={{ fontSize: "var(--font-size-xl)", marginBottom: 0, textAlign: "center" }}>
          {QUESTION}
        </h1>
        <div className="options" role="group" aria-labelledby="question">
          {ANSWERS.map((a) => (
            <button key={a.value} type="button" className="option" onClick={() => record(a.value)}>
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="notice">
        <button type="button" className="btn btn-quiet" onClick={() => (record("not-now"), router.push("/"))}>
          Not now
        </button>
      </div>
    </div>
  );
}
