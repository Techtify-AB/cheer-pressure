// Sleep and steps from Apple Health, read only, reduced here on the phone to one record per night
// (nights.ts) and one number per day. Nothing is sent anywhere: the results go to the page in the
// WebView, which keeps them in its own storage on this phone.
//
// Steps come from a statistics query per day, which is how Health itself avoids counting a walk
// twice when both the phone and a watch counted it. Sleep comes as raw samples per source and is
// reduced in nights.ts (one source per night, never added up).

import {
  AuthorizationRequestStatus,
  CategoryValueSleepAnalysis,
  deleteObjects,
  getRequestStatusForAuthorization,
  isHealthDataAvailable,
  queryCategorySamples,
  queryQuantitySamples,
  queryStatisticsCollectionForQuantity,
  requestAuthorization,
  saveCategorySample,
  saveQuantitySample,
} from "@kingstinct/react-native-healthkit";
import { IS_DEV } from "../config";
import type { PhoneNight, PhonePermissionState, PhoneStepsDay } from "../protocol";
import { DEMO_DAYS, demoWeeks } from "./demoWeeks";
import { localDay, reduceNights, reduceSteps, type RawSleepSample, type SleepStage } from "./nights";

const SLEEP = "HKCategoryTypeIdentifierSleepAnalysis" as const;
const STEPS = "HKQuantityTypeIdentifierStepCount" as const;
/** Metadata on every sample the development build writes, so they can be told apart and removed. */
const MADE_UP_KEY = "CheerPressureMadeUp";
/** Never further back than this: what the rule and My values look at. */
export const MAX_DAYS = 56;

const READ = [SLEEP, STEPS] as const;
/** Only development builds ask to write, for the made-up weeks. */
const SHARE = IS_DEV ? ([SLEEP, STEPS] as const) : ([] as const);

export function healthAvailable(): boolean {
  try {
    return isHealthDataAvailable();
  } catch {
    return false;
  }
}

/** "asked" once the question was shown: Health never tells an app whether reading was allowed. */
export async function healthState(): Promise<PhonePermissionState> {
  if (!healthAvailable()) return "not-available";
  const s = await getRequestStatusForAuthorization({ toRead: READ, toShare: SHARE });
  return s === AuthorizationRequestStatus.unnecessary ? "asked" : "not-asked";
}

/** Shows Health's own sheet the first time; after that it returns at once. */
export async function requestHealth(): Promise<PhonePermissionState> {
  if (!healthAvailable()) return "not-available";
  await requestAuthorization({ toRead: READ, toShare: SHARE });
  return healthState();
}

function addDaysLocal(day: string, n: number): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d + n, 0, 0, 0, 0);
}

/** `since` no older than 56 days before today, as a local date "YYYY-MM-DD". */
export function clampSince(since: string, now = new Date()): string {
  const oldest = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - MAX_DAYS).getTime());
  return since < oldest ? oldest : since;
}

function stageOf(value: number): SleepStage | null {
  if (value === CategoryValueSleepAnalysis.inBed) return "inBed";
  if (value === CategoryValueSleepAnalysis.awake) return "awake";
  if (
    value === CategoryValueSleepAnalysis.asleepUnspecified ||
    value === CategoryValueSleepAnalysis.asleepCore ||
    value === CategoryValueSleepAnalysis.asleepDeep ||
    value === CategoryValueSleepAnalysis.asleepREM
  )
    return "asleep";
  return null;
}

function madeUp(metadata: unknown): boolean {
  return !!metadata && typeof metadata === "object" && MADE_UP_KEY in (metadata as Record<string, unknown>);
}

/** One record per night from the morning `since` on (nights.ts says how). */
export async function readNights(since: string): Promise<PhoneNight[]> {
  const from = addDaysLocal(since, -1);
  from.setHours(12);
  const now = new Date();
  const samples = await queryCategorySamples(SLEEP, { limit: 0, ascending: true, filter: { date: { startDate: from, endDate: now } } });
  const raw: RawSleepSample[] = [];
  for (const s of samples) {
    const stage = stageOf(Number(s.value));
    if (!stage) continue;
    raw.push({
      start: new Date(s.startDate).getTime(),
      end: new Date(s.endDate).getTime(),
      stage,
      source: s.sourceRevision?.source?.bundleIdentifier ?? "unknown",
      madeUp: madeUp(s.metadata),
    });
  }
  return reduceNights(raw, { since, now: now.getTime() });
}

/** Steps per full day from `since` on; today, still going, is left out. Days without steps are missing. */
export async function readSteps(since: string): Promise<PhoneStepsDay[]> {
  const start = addDaysLocal(since, 0);
  const now = new Date();
  const today = localDay(now.getTime());
  const todayStart = addDaysLocal(today, 0);
  const buckets = await queryStatisticsCollectionForQuantity(STEPS, ["cumulativeSum"], start, { day: 1 }, {
    filter: { date: { startDate: start, endDate: todayStart } },
    unit: "count",
  });
  const madeUpDays = new Set<string>();
  if (IS_DEV) {
    const mine = await queryQuantitySamples(STEPS, { limit: 0, filter: { date: { startDate: start, endDate: todayStart }, metadata: { withMetadataKey: MADE_UP_KEY } } });
    for (const s of mine) madeUpDays.add(localDay(new Date(s.startDate).getTime()));
  }
  return reduceSteps(
    buckets.filter((b) => b.startDate).map((b) => ({ start: new Date(b.startDate!).getTime(), steps: b.sumQuantity?.quantity ?? 0 })),
    { since, today, madeUpDays },
  );
}

/** Development builds only: writes the made-up weeks (demoWeeks.ts), after removing earlier ones. */
export async function addDemoWeeks(): Promise<{ nights: number; days: number }> {
  if (!IS_DEV) throw new Error("Only in development builds.");
  await requestAuthorization({ toRead: READ, toShare: SHARE });
  await removeDemoWeeks();
  const now = new Date();
  const { sleep, steps } = demoWeeks(now);
  const meta = { [MADE_UP_KEY]: 1 };
  const value = { inBed: CategoryValueSleepAnalysis.inBed, asleep: CategoryValueSleepAnalysis.asleepCore, awake: CategoryValueSleepAnalysis.awake };
  for (const s of sleep) {
    if (s.end > now.getTime()) continue;
    await saveCategorySample(SLEEP, value[s.stage], new Date(s.start), new Date(s.end), meta);
  }
  for (const s of steps) {
    if (s.end > now.getTime()) continue;
    await saveQuantitySample(STEPS, "count", s.steps, new Date(s.start), new Date(s.end), meta);
  }
  const since = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - DEMO_DAYS).getTime());
  const [nights, days] = await Promise.all([readNights(since), readSteps(since)]);
  return { nights: nights.filter((n) => n.source === "demo").length, days: days.filter((d) => d.source === "demo").length };
}

/** Development builds only: removes every sample this app wrote as made up, and nothing else. */
export async function removeDemoWeeks(): Promise<{ nights: number; days: number }> {
  if (!IS_DEV) throw new Error("Only in development builds.");
  const filter = { metadata: { withMetadataKey: MADE_UP_KEY } };
  const sleepSamples = await queryCategorySamples(SLEEP, { limit: 0, filter });
  const stepSamples = await queryQuantitySamples(STEPS, { limit: 0, filter });
  const nights = new Set(
    reduceNights(
      sleepSamples.map((s) => ({
        start: new Date(s.startDate).getTime(),
        end: new Date(s.endDate).getTime(),
        stage: stageOf(Number(s.value)) ?? "asleep",
        source: "made-up",
      })),
    ).map((n) => n.date),
  ).size;
  const days = new Set(stepSamples.map((s) => localDay(new Date(s.startDate).getTime()))).size;
  if (sleepSamples.length) await deleteObjects(SLEEP, filter);
  if (stepSamples.length) await deleteObjects(STEPS, filter);
  return { nights, days };
}
