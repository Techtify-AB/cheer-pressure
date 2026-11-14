"use client";

// In the phone app only: asks lib/phone.ts to plan the daily hello's notifications again whenever
// what they depend on changes here (the time, how often, quiet hours, an answer, Pause
// everything). lib/phone.ts makes the plan (planNotifications) and also re-plans by itself when
// the app comes back to the front. Elsewhere this does nothing: the desktop app keeps its
// bubble, and a browser asks on Home.

import { useEffect, useRef } from "react";
import { isPhoneApp, replanHello } from "@/lib/phoneBridge";
import { useData } from "@/lib/storage";

export function PhonePlan() {
  const data = useData();
  const sent = useRef<string | null>(null);
  const key = data
    ? JSON.stringify([data.profile?.createdAt, data.settings.dailyQuestion, data.settings.quietHours, data.settings.pausedAll, (data.dailyAnswers ?? []).slice(-1)])
    : null;
  useEffect(() => {
    if (!key || !isPhoneApp() || sent.current === key) return;
    sent.current = key;
    void replanHello();
  }, [key]);
  return null;
}
