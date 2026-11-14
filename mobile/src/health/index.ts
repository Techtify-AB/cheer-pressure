// Sleep and steps for the bridge, per platform. iPhone: Apple Health (healthkit.ts). Android: not
// built yet; Health Connect is the place for it, and until then every call says "not available yet".

import { Platform } from "react-native";
import type { PhoneCapabilities, PhoneNight, PhonePermissionState, PhoneStepsDay } from "../protocol";

type HealthKit = typeof import("./healthkit");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hk: HealthKit | null = Platform.OS === "ios" ? (require("./healthkit") as HealthKit) : null;

export class NotAvailable extends Error {}

export async function healthCapability(): Promise<PhoneCapabilities["health"]> {
  if (!hk) return { available: false, why: "not-available-yet", state: "not-available" };
  if (!hk.healthAvailable()) return { available: false, why: "not-on-this-device", state: "not-available" };
  return { available: true, why: null, state: await hk.healthState() };
}

export async function requestHealth(): Promise<PhonePermissionState> {
  return hk ? hk.requestHealth() : "not-available";
}

function need(): HealthKit {
  if (!hk) throw new NotAvailable("Sleep and steps are not available on Android yet.");
  if (!hk.healthAvailable()) throw new NotAvailable("This phone has no Health data.");
  return hk;
}

export async function getSleep(since: string): Promise<{ since: string; nights: PhoneNight[] }> {
  const h = need();
  const from = h.clampSince(since);
  return { since: from, nights: await h.readNights(from) };
}

export async function getSteps(since: string): Promise<{ since: string; days: PhoneStepsDay[] }> {
  const h = need();
  const from = h.clampSince(since);
  return { since: from, days: await h.readSteps(from) };
}

export async function demoHealth(action: "add" | "remove"): Promise<{ nights: number; days: number }> {
  const h = need();
  return action === "add" ? h.addDemoWeeks() : h.removeDemoWeeks();
}
