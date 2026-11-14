"use client";

// In the phone app only: hands the daily hello's notification plan (lib/hello.ts) to the phone
// whenever it changes (the time, how often, quiet hours, an answer, Pause everything), through
// this interface's own bridge adapter (lib/phoneBridge.ts). Elsewhere it does nothing: the
// desktop app keeps its bubble, and a browser asks on Home.

import { useEffect, useRef } from "react";
import { helloPlan } from "@/lib/hello";
import { isPhoneApp, phoneRequest } from "@/lib/phoneBridge";
import { useData } from "@/lib/storage";

export function PhonePlan() {
  const data = useData();
  const sent = useRef<string | null>(null);
  const key = data ? JSON.stringify([data.profile?.createdAt, data.settings.dailyQuestion, data.settings.quietHours, data.settings.pausedAll, (data.dailyAnswers ?? []).slice(-1)]) : null;
  useEffect(() => {
    if (!data || !key || !isPhoneApp() || sent.current === key) return;
    sent.current = key;
    void phoneRequest("scheduleNotifications", { plan: helloPlan(data, new Date()) }).catch(() => {
      // Without permission for notifications the phone schedules nothing; the hello is on Home.
    });
  }, [data, key]);
  return null;
}
