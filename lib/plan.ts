// The person's plan for the activities ("something for you", lib/activities): the hobby and
// its first step, a simple meal, the first evening step, the first step after a song, which
// sound, and who to ask. Edited on "My plan" (/activities/plan/). Until something is saved, the
// demo defaults below are used, so every activity works on a fresh install.
//
// The resolving is pure (resolvePlan, mealActions), unit tested in scripts/test-activities.mts.
// Saving goes through lib/storage.ts like everything else, so "Delete everything" removes it.

import { DEFAULT_SOUND, soundById } from "./activities/sounds";
import { readData, savePlan } from "./storage";
import type { AppData, SavedPlan } from "./types";

export interface Plan {
  hobby: { name: string; firstStep: string; smallestStep: string };
  /** `steps` may be empty: then the meal is one action, its name (see mealActions). */
  meal: { name: string; steps: string[]; smallest: string };
  eveningStep: string;
  eveningSmallest: string;
  firstStepAfterMusic: string;
  sound: string;
  contact: { name: string };
}

export const DEMO_PLAN: Plan = {
  hobby: {
    name: "Sketching",
    firstStep: "Get out paper and a pen. Draw the outline of one thing you can see in the room.",
    smallestStep: "Get out paper and a pen.",
  },
  meal: {
    name: "Yoghurt and a banana",
    steps: ["Take out the yoghurt", "Get the banana", "Sit down where you'd like to eat"],
    smallest: "Get the banana",
  },
  eveningStep: "Put your phone on charge and get ready for the evening",
  eveningSmallest: "Put your phone on charge",
  firstStepAfterMusic: "Get out the sketchbook",
  sound: DEFAULT_SOUND,
  contact: { name: "Alex" },
};

/** At most this many steps for the meal: it has to fit one screen. */
export const MAX_MEAL_STEPS = 3;

const clean = (s: string | undefined | null) => (s ?? "").trim().replace(/\s+/g, " ");

/**
 * The plan with every gap filled. A group the person changed is taken as theirs: a saved
 * hobby or meal name never gets the demo's steps, since those belong to the demo's hobby and
 * meal. `trustedName` is the person they trust, if one is connected (used when no contact is saved).
 */
export function resolvePlan(saved: SavedPlan | null | undefined, trustedName?: string | null): Plan {
  const s = saved ?? {};

  const hobbyName = clean(s.hobby?.name);
  const hobby = hobbyName && hobbyName !== DEMO_PLAN.hobby.name
    ? (() => {
        const first = clean(s.hobby?.firstStep) || `Take out what you need for ${hobbyName.toLowerCase()}.`;
        return { name: hobbyName, firstStep: first, smallestStep: clean(s.hobby?.smallestStep) || first };
      })()
    : {
        name: DEMO_PLAN.hobby.name,
        firstStep: clean(s.hobby?.firstStep) || DEMO_PLAN.hobby.firstStep,
        smallestStep: clean(s.hobby?.smallestStep) || DEMO_PLAN.hobby.smallestStep,
      };

  const mealName = clean(s.meal?.name);
  const savedSteps = (s.meal?.steps ?? []).map(clean).filter(Boolean).slice(0, MAX_MEAL_STEPS);
  const meal = mealName && mealName !== DEMO_PLAN.meal.name
    ? { name: mealName, steps: savedSteps, smallest: clean(s.meal?.smallest) || savedSteps[0] || mealName }
    : {
        name: DEMO_PLAN.meal.name,
        steps: s.meal?.steps ? savedSteps : DEMO_PLAN.meal.steps,
        smallest: clean(s.meal?.smallest) || DEMO_PLAN.meal.smallest,
      };

  return {
    hobby,
    meal,
    eveningStep: clean(s.eveningStep) || DEMO_PLAN.eveningStep,
    eveningSmallest: clean(s.eveningSmallest) || DEMO_PLAN.eveningSmallest,
    firstStepAfterMusic: clean(s.firstStepAfterMusic) || DEMO_PLAN.firstStepAfterMusic,
    sound: s.sound && soundById(s.sound) ? s.sound : DEMO_PLAN.sound,
    contact: { name: clean(s.contact?.name) || clean(trustedName) || DEMO_PLAN.contact.name },
  };
}

/** What the meal checklist shows: its steps, or the meal itself as one action when it has none. */
export function mealActions(plan: Pick<Plan, "meal">): string[] {
  return plan.meal.steps.length ? plan.meal.steps : [plan.meal.name];
}

/** True when nothing has been saved and the demo plan is in use. */
export function isDemoPlan(data: Pick<AppData, "plan"> | null | undefined): boolean {
  return !data?.plan;
}

// Getters: the saved value, or the default.

export function planOf(data: Pick<AppData, "plan"> | null | undefined, trustedName?: string | null): Plan {
  return resolvePlan(data?.plan, trustedName);
}
export const hobbyOf = (data: Pick<AppData, "plan"> | null | undefined) => planOf(data).hobby;
export const mealOf = (data: Pick<AppData, "plan"> | null | undefined) => planOf(data).meal;
export const eveningStepOf = (data: Pick<AppData, "plan"> | null | undefined) => planOf(data).eveningStep;
export const firstStepAfterMusicOf = (data: Pick<AppData, "plan"> | null | undefined) => planOf(data).firstStepAfterMusic;
export const soundOf = (data: Pick<AppData, "plan"> | null | undefined) => planOf(data).sound;
export const contactOf = (data: Pick<AppData, "plan"> | null | undefined, trustedName?: string | null) =>
  planOf(data, trustedName).contact;

/** Saves part of the plan, keeping the rest. Browser only. */
export function updatePlan(patch: SavedPlan) {
  const cur = readData().plan ?? {};
  savePlan({
    ...cur,
    ...patch,
    hobby: patch.hobby ? { ...cur.hobby, ...patch.hobby } : cur.hobby,
    meal: patch.meal ? { ...cur.meal, ...patch.meal } : cur.meal,
    contact: patch.contact ? { ...cur.contact, ...patch.contact } : cur.contact,
  });
}

/** Back to the demo defaults. */
export function resetPlan() {
  savePlan(null);
}
