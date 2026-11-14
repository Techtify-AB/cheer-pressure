// The data model. Everything here lives only in this browser (see lib/storage.ts).

/** A calendar day in the person's local time, "YYYY-MM-DD". */
export type DayKey = string;

/** Where an entry came from. Demo entries can be cleared without touching real ones. */
export type Source = "user" | "demo";

export interface Profile {
  createdAt: string; // ISO timestamp
  /** Up to three personal early signs chosen or typed during setup. */
  earlySigns: string[];
}

export interface DailyEntry {
  id: string;
  date: DayKey;
  /** Bedtime last night, "HH:MM" 24h. */
  bedtime: string;
  /** Wake time this morning, "HH:MM" 24h. */
  wakeTime: string;
  /** Today's form, 1 (very low) to 5 (very good). */
  form: 1 | 2 | 3 | 4 | 5;
  /** Words per second from the read-aloud step, or null if skipped. No audio is kept. */
  speechRate: number | null;
  /** Optional typed note. Never included in the clinic summary. */
  note?: string;
  source: Source;
  savedAt: string;
}

/** Standard PHQ-2 scale: 0 not at all, 1 several days, 2 more than half the days, 3 nearly every day. */
export type Scale03 = 0 | 1 | 2 | 3;

export interface WeeklyEntry {
  id: string;
  date: DayKey;
  /** PHQ-2 item 1: feeling down, depressed or hopeless. */
  down: Scale03;
  /** PHQ-2 item 2: little interest or pleasure in doing things. */
  interest: Scale03;
  /** Trouble with sleep. */
  sleep: Scale03;
  /** Feeling tense or on edge. */
  tense: Scale03;
  /** One answer per personal early sign, same 0 to 3 scale. */
  signs: { sign: string; value: Scale03 }[];
  source: Source;
  savedAt: string;
}

export interface ReactionResult {
  id: string;
  date: DayKey;
  trialsMs: number[];
  medianMs: number;
  source: Source;
  savedAt: string;
}

/**
 * One typing session: timing numbers only. No keys, characters or text are ever
 * stored. A session ends after 5 minutes without typing (or on pause).
 */
export interface TypingSession {
  id: string;
  /** Local day the session started. */
  date: DayKey;
  /** Where it was measured: across the whole computer (desktop app) or only in the app's own box. */
  measuredIn: "computer" | "box";
  /** Seconds from the first to the last key press. */
  windowSec: number;
  /** Number of key presses. */
  presses: number;
  /** Middle time between one key press and the next, in ms. Gaps over 5 s are left out. */
  medianIntervalMs: number | null;
  /** Spread of those times: 75th minus 25th percentile, in ms. Higher is more uneven. */
  spreadMs: number | null;
  /** 95th percentile of those times, in ms: the longer pauses. */
  p95PauseMs: number | null;
  /** Middle time a key is held down, in ms. */
  medianHoldMs: number | null;
  source: Source;
  savedAt: string;
}

/**
 * First and last key press of one day, measured by the desktop app. A day runs from
 * 04:00 to 04:00, so a late evening stays with the day it belongs to. Times only.
 */
export interface ActivityDay {
  date: DayKey;
  /** "HH:MM", clock time of the first key press. */
  first: string;
  /** "HH:MM", clock time of the last key press (can be after midnight). */
  last: string;
  source: Source;
}

/** The passive measures the companion compares with the person's own range. */
export type PassiveKey = "spread" | "pauses" | "hold" | "firstActivity" | "lastActivity" | "quietNight";

export type CheckInAnswer = "okay" | "not-best" | "someone" | "not-now";

/** A check-in the companion proposed because measures stood out, and the answer. */
export interface PromptedCheckIn {
  id: string;
  date: DayKey;
  at: string; // ISO
  answer: CheckInAnswer;
  /** Which measures had changed, and which way. */
  triggeredBy: { key: PassiveKey; direction: "up" | "down" }[];
  /** How many recent typing sessions and days the comparison used. */
  basedOn: { sessions: number; days: number };
  /** True when the change was simulated or the data was made-up demo data. */
  simulated: boolean;
}

export interface Settings {
  /** Mutes the companion's read-aloud voice. */
  muted: boolean;
  /** Set by the demo control "Simulate a change": propose a check-in now, ignoring the 3-day pause. */
  simulatedChangeAt?: string;
}

export interface AppData {
  version: 1;
  profile: Profile | null;
  daily: DailyEntry[];
  weekly: WeeklyEntry[];
  reaction: ReactionResult[];
  typingSessions: TypingSession[];
  activityDays: ActivityDay[];
  checkIns: PromptedCheckIn[];
  settings: Settings;
}
