// Local notifications only (expo-notifications, no push server): the daily hello at the times the
// page planned, and "Cheri would like a word" at once. The page plans them (lib/phone.ts
// planNotifications: chosen time and days, out of quiet hours, never twice a day, nothing while
// paused); this file schedules exactly that plan, replacing the one before. Quiet hours live in
// the page's Settings, so the page applies them: it never plans a hello inside them and never asks
// for a word during them (lib/phone.ts wordDue). The plan is made again each time the app is
// opened or left and whenever Settings change, so a change of quiet hours reaches what is scheduled.

import * as Notifications from "expo-notifications";
import type { NotificationPlan, PhoneNotice, PhonePermissionState } from "./protocol";

/** iOS keeps at most 64 pending; the plan is two weeks of one a day. */
const MAX_PENDING = 60;

export interface NoticeData {
  cheerPressure: true;
  id: string;
  kind: PhoneNotice["kind"];
  path: string;
}

export class PlanRefused extends Error {
  constructor(
    public code: "denied" | "bad-request",
    message: string,
  ) {
    super(message);
  }
}

// Shown as a banner even when the app is open (a word can be asked for while it is in front).
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function notificationState(): Promise<PhonePermissionState> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted) return "granted";
  if (p.canAskAgain === false || p.status === "denied") return "denied";
  return "not-asked";
}

export async function requestNotifications(): Promise<PhonePermissionState> {
  const now = await notificationState();
  if (now !== "not-asked") return now;
  const p = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowSound: true, allowBadge: false } });
  return p.granted ? "granted" : "denied";
}

function validNotice(n: unknown): n is PhoneNotice {
  const x = n as PhoneNotice;
  return (
    !!x &&
    typeof x.id === "string" &&
    (x.kind === "hello" || x.kind === "word") &&
    (x.at === null || (typeof x.at === "string" && !Number.isNaN(Date.parse(x.at)))) &&
    typeof x.title === "string" &&
    typeof x.body === "string" &&
    typeof x.path === "string" &&
    x.path.startsWith("/")
  );
}

function content(n: PhoneNotice): Notifications.NotificationContentInput {
  const data: NoticeData = { cheerPressure: true, id: n.id, kind: n.kind, path: n.path };
  return { title: n.title, body: n.body, data: data as unknown as Record<string, unknown>, sound: "default" };
}

/** Replaces everything scheduled with the plan. Notices in the past are skipped. */
export async function schedulePlan(plan: NotificationPlan): Promise<{ scheduled: number }> {
  if (!plan || !Array.isArray(plan.notices) || !plan.notices.every(validNotice)) throw new PlanRefused("bad-request", "The plan is not in the expected shape.");
  if ((await notificationState()) !== "granted") throw new PlanRefused("denied", "Notifications are not allowed for Cheer Pressure, so nothing was scheduled.");
  await Notifications.cancelAllScheduledNotificationsAsync();
  const now = Date.now();
  let scheduled = 0;
  for (const n of plan.notices.slice(0, MAX_PENDING)) {
    if (!n.at || Date.parse(n.at) <= now) continue;
    await Notifications.scheduleNotificationAsync({
      identifier: n.id,
      content: content(n),
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(n.at) },
    });
    scheduled++;
  }
  return { scheduled };
}

export async function cancelAll(): Promise<{ cancelled: number }> {
  const pending = await Notifications.getAllScheduledNotificationsAsync();
  await Notifications.cancelAllScheduledNotificationsAsync();
  return { cancelled: pending.length };
}

/** "Cheri would like a word", now. */
export async function notifyNow(n: PhoneNotice): Promise<{ shown: boolean }> {
  if (!validNotice(n)) throw new PlanRefused("bad-request", "The notice is not in the expected shape.");
  if ((await notificationState()) !== "granted") return { shown: false };
  await Notifications.scheduleNotificationAsync({ identifier: n.id, content: content(n), trigger: null });
  return { shown: true };
}

/** The notice behind a tap, or null when the notification is not one of ours. */
export function noticeOf(response: Notifications.NotificationResponse | null | undefined): NoticeData | null {
  const data = response?.notification.request.content.data as Partial<NoticeData> | undefined;
  if (!data?.cheerPressure || typeof data.path !== "string" || !data.path.startsWith("/")) return null;
  return { cheerPressure: true, id: String(data.id ?? ""), kind: data.kind === "word" ? "word" : "hello", path: data.path };
}
