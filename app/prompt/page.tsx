"use client";

// The check-in the companion proposes when at least two passive measures stand out
// from the person's own range (lib/passive.ts). First a plain explanation of what
// changed, then one question with three tap answers. No percentages, no score.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ClinicContactPlaceholder } from "@/components/ClinicContactPlaceholder";
import { Disclosure, Says, Screen, StepCount } from "@/components/Screen";
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
  const [step, setStep] = useState<"explain" | "ask">("explain");
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

  const home = (
    <Link href="/" className="btn btn-primary">
      Back to home
    </Link>
  );

  if (!evaluation.askNow && answer === null) {
    return (
      <Screen
        lead={
          <Says state="idle">
            <p>Nothing stands out compared with your usual right now. Nothing is needed from you.</p>
          </Says>
        }
        actions={
          <>
            {home}
            <div className="links">
              <Link href="/check-in/" className="btn btn-quiet">
                Tell me how you&apos;re doing anyway
              </Link>
            </div>
          </>
        }
      />
    );
  }

  if (answer === "okay") {
    return (
      <Screen
        lead={
          <Says state="idle" size={88}>
            <p>Good to hear. Thanks for telling me. That&apos;s all for now.</p>
          </Says>
        }
        actions={home}
      />
    );
  }

  if (answer === "not-best") {
    return (
      <Screen
        lead={
          <Says state="idle">
            <p>Thanks for telling me. Not every day is a good one.</p>
            <p className="suggestion">
              <strong>One small thing to try:</strong> {reflection?.passive.suggestion.text}
            </p>
          </Says>
        }
        actions={
          <>
            <Link href="/weekly/" className="btn btn-primary">
              Answer a few more questions
            </Link>
            <div className="links">
              <Link href="/" className="btn btn-quiet">
                Not now
              </Link>
            </div>
          </>
        }
      >
        <section className="card stack-sm" aria-labelledby="weekly-offer">
          <h2 id="weekly-offer">A few more questions, if you like</h2>
          <p>
            A few short questions about the last week. They help you and your clinic see how things are going. Only if
            you feel like it.
          </p>
        </section>
      </Screen>
    );
  }

  if (answer === "someone") {
    return (
      <Screen
        lead={
          <section className="placeholder stack-sm" aria-labelledby="contact-title">
            <span className="placeholder-tag">Placeholder</span>
            <h1 id="contact-title">Contact request (not connected yet)</h1>
            <p>
              In the finished app, this lets someone you trust know that you&apos;d like them to check in on you. It
              isn&apos;t connected yet, so <strong>nothing has been sent</strong>.
            </p>
          </section>
        }
        actions={home}
      >
        <section className="card stack-sm" aria-labelledby="reach-title">
          <h2 id="reach-title">You can reach someone now</h2>
          <p>Call or message someone you trust, or contact your clinic.</p>
          <ClinicContactPlaceholder />
          <p>
            If you are in danger or might hurt yourself, call <a href="tel:112">112</a>.
          </p>
        </section>
      </Screen>
    );
  }

  if (!reflection) return null;
  const explanation = reflection.passive.explanation;

  if (step === "explain") {
    return (
      <Screen
        lead={
          <>
            <Says state={voice.state}>
              <p>{explanation}</p>
            </Says>
            <StepCount index={0} total={2} />
          </>
        }
        actions={
          <>
            <button type="button" className="btn btn-primary" onClick={() => setStep("ask")}>
              Next
            </button>
            <div className="links">
              <button type="button" className="btn btn-quiet" onClick={() => (record("not-now"), router.push("/"))}>
                Not now
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => voice.say(explanation)}>
                Read this aloud
              </button>
            </div>
          </>
        }
      >
        <p className="muted">This compares you only with your own earlier days, never with other people.</p>
        <Disclosure title="How this is worked out">
          <p>
            A measure counts as changed only when your last three sessions or days in a row are all outside your usual
            range on the same side. I only ask when at least two have changed.
          </p>
          <ul className="worked-out">
            {evaluation.changed.map((m) => (
              <li key={m.key}>
                <strong>{m.label}</strong>: your last three were {(m.recentValues ?? []).map(m.format).join(", ")}.
                Your usual range is {m.usual ? `${m.format(m.usual.low)} to ${m.format(m.usual.high)}` : "not known yet"}
                , from {m.usual?.n ?? 0} earlier {m.unit === "session" ? "sessions" : "days"}.
              </li>
            ))}
          </ul>
          {evaluation.simulated && <p>This change is simulated with made-up demo data.</p>}
        </Disclosure>
      </Screen>
    );
  }

  return (
    <Screen
      lead={
        <>
          <Says state={voice.state}>
            <h1 id="question">{QUESTION}</h1>
          </Says>
          <StepCount index={1} total={2} />
        </>
      }
      actions={
        <div className="links">
          <button type="button" className="btn btn-quiet" onClick={() => setStep("explain")}>
            Back
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => (record("not-now"), router.push("/"))}>
            Not now
          </button>
          <button type="button" className="btn btn-quiet" onClick={() => voice.say(QUESTION)}>
            Read this aloud
          </button>
        </div>
      }
    >
      <div className="options" role="group" aria-labelledby="question">
        {ANSWERS.map((a) => (
          <button key={a.value} type="button" className="option" onClick={() => record(a.value)}>
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    </Screen>
  );
}
