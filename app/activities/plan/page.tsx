"use client";

// "My plan": what the activities use, one field per view, paged instead of scrolled. Every
// change is saved as it is typed (lib/plan.ts, through lib/storage.ts). An empty field falls
// back to the demo plan; a meal with no steps is shown as one action, its name.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Pager, Screen } from "@/components/Screen";
import { SOUNDS } from "@/lib/activities/sounds";
import { isDemoPlan, MAX_MEAL_STEPS, planOf, resetPlan, updatePlan, type Plan } from "@/lib/plan";
import { readData, useData } from "@/lib/storage";
import type { SavedPlan } from "@/lib/types";

interface Field {
  key: string;
  label: string;
  hint: string;
  /** What the plan uses now (saved, or the default). */
  value: (p: Plan, saved: SavedPlan) => string;
  /** What is saved for this field, if anything: shown as typed, so a field can be emptied. */
  raw?: (saved: SavedPlan) => string | undefined;
  save: (v: string, saved: SavedPlan) => SavedPlan;
  long?: boolean;
  choice?: { value: string; label: string }[];
}

const mealSteps = (saved: SavedPlan, p: Plan) => saved.meal?.steps ?? p.meal.steps;

function mealStepField(n: number): Field {
  return {
    key: `meal-step-${n}`,
    label: `Meal, step ${n + 1} of ${MAX_MEAL_STEPS}`,
    hint: "Leave it empty if the meal needs fewer steps.",
    value: (p, s) => mealSteps(s, p)[n] ?? "",
    save: (v, s) => {
      const steps = [...mealSteps(s, planOf({ plan: s }))];
      while (steps.length <= n) steps.push("");
      steps[n] = v;
      return { meal: { steps } };
    },
  };
}

const FIELDS: Field[] = [
  { key: "hobby", label: "A hobby you like", hint: "Used by Pick your hobby back up.", raw: (s) => s.hobby?.name, value: (p) => p.hobby.name, save: (v) => ({ hobby: { name: v } }) },
  { key: "hobby-first", label: "Its first step", hint: "Something you can start in a minute.", long: true, raw: (s) => s.hobby?.firstStep, value: (p) => p.hobby.firstStep, save: (v) => ({ hobby: { firstStep: v } }) },
  { key: "hobby-smallest", label: "Its smallest step", hint: "For the days when even that is a lot.", raw: (s) => s.hobby?.smallestStep, value: (p) => p.hobby.smallestStep, save: (v) => ({ hobby: { smallestStep: v } }) },
  { key: "meal", label: "A simple meal", hint: "Used by Get something to eat ready.", raw: (s) => s.meal?.name, value: (p) => p.meal.name, save: (v) => ({ meal: { name: v } }) },
  mealStepField(0),
  mealStepField(1),
  mealStepField(2),
  { key: "meal-smallest", label: "The simplest thing to eat", hint: "For Make it easier.", raw: (s) => s.meal?.smallest, value: (p) => p.meal.smallest, save: (v) => ({ meal: { smallest: v } }) },
  { key: "song-step", label: "Your first step after a song", hint: "Shown when the music fades.", raw: (s) => s.firstStepAfterMusic, value: (p) => p.firstStepAfterMusic, save: (v) => ({ firstStepAfterMusic: v }) },
  {
    key: "sound",
    label: "The sound for a song",
    hint: "Both are calm and made for this app.",
    value: (p) => p.sound,
    save: (v) => ({ sound: v }),
    choice: SOUNDS.map((s) => ({ value: s.id, label: s.label })),
  },
  { key: "evening", label: "Your first evening step", hint: "Shown after the evening sound.", raw: (s) => s.eveningStep, value: (p) => p.eveningStep, save: (v) => ({ eveningStep: v }) },
  { key: "evening-smallest", label: "The smallest evening step", hint: "For Make it easier.", raw: (s) => s.eveningSmallest, value: (p) => p.eveningSmallest, save: (v) => ({ eveningSmallest: v }) },
  { key: "contact", label: "Who to ask to get in touch", hint: "A first name is enough. Nothing is sent from this demo.", raw: (s) => s.contact?.name, value: (p) => p.contact.name, save: (v) => ({ contact: { name: v } }) },
];

export default function PlanPage() {
  const data = useData();
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const id = useId();
  if (!data) return null;
  const saved = data.plan ?? {};
  const plan = planOf(data);
  const f = FIELDS[index];
  const raw = f.raw?.(saved);
  const value = raw !== undefined ? raw : f.value(plan, saved);
  const set = (v: string) => updatePlan(f.save(v, readData().plan ?? {}));

  return (
    <Screen
      lead={
        <div className="act-lead">
          <p className="act-eyebrow">My plan{isDemoPlan(data) ? ", with demo answers" : ""}</p>
          <h1 className="act-title">What the activities use</h1>
        </div>
      }
      actions={
        <>
          <Pager index={index} total={FIELDS.length} onChange={setIndex} onPastEnd={() => router.push("/activities/")} pastEndLabel="Done" />
          <div className="links">
            <Link href="/activities/" className="btn btn-quiet">
              Back to things to do
            </Link>
            {!isDemoPlan(data) && (
              <button type="button" className="btn btn-quiet" onClick={resetPlan}>
                Use the demo plan again
              </button>
            )}
          </div>
        </>
      }
    >
      <div className="act-field" key={f.key}>
        {f.choice ? <p id={id} className="act-field-label">{f.label}</p> : <label htmlFor={id}>{f.label}</label>}
        {f.choice ? (
          <div className="act-choice" role="radiogroup" aria-labelledby={id}>
            {f.choice.map((c) => (
              <button
                key={c.value}
                type="button"
                role="radio"
                aria-checked={value === c.value}
                className="option"
                onClick={() => set(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>
        ) : f.long ? (
          <textarea id={id} value={value} maxLength={160} onChange={(e) => set(e.target.value)} />
        ) : (
          <input id={id} type="text" value={value} maxLength={80} onChange={(e) => set(e.target.value)} />
        )}
        <p className="hint">{f.hint}</p>
      </div>
    </Screen>
  );
}
