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

export interface Settings {
  /** Mutes the companion's read-aloud voice. */
  muted: boolean;
}

export interface AppData {
  version: 1;
  profile: Profile | null;
  daily: DailyEntry[];
  weekly: WeeklyEntry[];
  reaction: ReactionResult[];
  settings: Settings;
}
