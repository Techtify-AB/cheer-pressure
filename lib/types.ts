// The data model. Everything here lives only on this device (see lib/storage.ts). The short
// messages with someone the person trusts are kept apart, by lib/messages.ts, under their own key.

/** A calendar day in the person's local time, "YYYY-MM-DD". */
export type DayKey = string;

/** Where an entry came from. Demo entries can be cleared without touching real ones. */
export type Source = "user" | "demo";

export interface Profile {
  createdAt: string; // ISO timestamp
  /** Up to three personal early signs chosen or typed during setup. */
  earlySigns: string[];
}

/** From an earlier version's daily form, which is no longer in the app. Kept so older data still loads. */
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

/** From an earlier version's timing taps, which are no longer in the app. Kept so older data still loads. */
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

/**
 * The passive measures the companion compares with the person's own range. "pauses" is no
 * longer measured (thinking pauses are context only); it can still appear in older check-ins.
 */
export type PassiveKey =
  | "spread"
  | "pauses"
  | "hold"
  | "firstActivity"
  | "lastActivity"
  | "quietNight"
  | "ownAnswer"
  | "movementLevel"
  | "positionChanges"
  | "contact"
  | "voicePace"
  | "faceMovement"
  | "raisedMouth"
  | "posture"
  | "pitchVariability"
  // From the phone's health data (lib/phone.ts): time asleep, bedtime and wake time per night; steps per day.
  | "phoneAsleep"
  | "phoneBedtime"
  | "phoneWake"
  | "steps";

/**
 * One night from the phone's health data (Apple Health today, Health Connect later), reduced on
 * the phone to one record per night: no raw samples, no source app. `date` is the morning it
 * ended. Times are local "HH:MM".
 */
export interface HealthNight {
  date: DayKey;
  /** When the night began: in bed if the source says so, else falling asleep. */
  bedtime: string;
  /** When the person woke up: the end of the last stretch asleep (or in bed). */
  wake: string;
  /** Minutes asleep, or null when the source only knows time in bed. */
  asleepMinutes: number | null;
  /** Minutes in bed, or null when the source does not record it. */
  inBedMinutes: number | null;
  /** Times awake during the night, or null when the source does not record it. */
  awakenings: number | null;
  /** "demo" for the made-up weeks the development build can add to Health. */
  source: Source;
}

/** Steps on one day (midnight to midnight) from the phone's health data. Only full days. */
export interface StepsDay {
  date: DayKey;
  steps: number;
  source: Source;
}

/** Messages with the person the person trusts on one day, both ways, while a pair existed. */
export interface ContactDay {
  date: DayKey;
  exchanged: number;
  source: Source;
}

/**
 * One stretch with the camera on (lib/camera): minutes in frame, average movement and position
 * changes per hour. Numbers only; no picture is ever kept.
 */
export interface StoredMovementSession {
  date: DayKey;
  minutes: number;
  /** Average movement while in frame, in shoulder widths per second. */
  movementMean: number;
  shiftsPerHour: number;
  /** How the face moved (lib/camera/expression.ts), or null. Missing in older data. */
  expression?: {
    minutesWithFace: number;
    smilingShare: number;
    smilesPerHour: number;
    animationMean: number;
    /** Kept, but not shown and not used (not checked on real faces). */
    browLoweredShare: number;
  } | null;
  /** How the person sat (lib/camera/posture.ts), or null. Missing in older data. */
  posture?: { minutes: number; uprightMean: number; usual: number | null; slumpedShare: number; uprightShare: number } | null;
  source: Source;
  savedAt: string;
}

/** One stretch with the microphone on (lib/voice/tone.ts): numbers only, no audio, no words. */
export interface StoredToneSession {
  date: DayKey;
  minutes: number;
  speakingMinutes: number;
  /** Voiced stretches per minute of talking: a stand-in for pace. */
  segmentsPerMinute: number;
  /** How much the pitch moved, in semitones. */
  pitchVariability: number;
  loudnessMean: number;
  source: Source;
  savedAt: string;
}

/** The person's usual posture across sessions: the median head height over the last 28 days. */
export interface PostureUsual {
  uprightMedian: number;
  sessions: number;
  updatedAt: string;
}

/** The three answers to the daily question "How are you today?". */
export type DailyAnswerValue = "good" | "okay" | "not-so-good";

/** One day's daily question: the answer, or that it was dismissed without one. */
export interface DailyAnswer {
  date: DayKey;
  answer: DailyAnswerValue | null;
  dismissed: boolean;
  at: string; // ISO
  source: Source;
}

/** How often and roughly when the daily question comes up. */
export interface DailyQuestionSettings {
  every: "off" | "day" | "other-day" | "twice-week" | "week";
  when: "morning" | "midday" | "evening";
  /** Every day for the first two weeks (the learning period), then `every`. Set by onboarding; missing in older data: no. */
  firstTwoWeeksDaily?: boolean;
}

/** The kind of app typed in, never its name: "all" pools every kind except games, which never count. */
export type TypingKind = "writing" | "code" | "browser" | "other" | "all";

/**
 * One day of typing for one kind of app, pooled over that day's counted bursts of real writing
 * (lib/typing.ts and src-tauri/src/rhythm.rs). Timing numbers only. Values are null when the
 * day has fewer than 300 counted presses.
 */
export interface TypingDay {
  date: DayKey;
  kind: TypingKind;
  /** Across the whole computer (desktop app) or only in the app's own box. */
  measuredIn: "computer" | "box";
  /** Counted presses and bursts. */
  presses: number;
  bursts: number;
  /** Rhythm evenness: spread (75th minus 25th percentile) of the gaps under 1 s, ms. */
  spreadMs: number | null;
  /** Median hold, ms. */
  holdMs: number | null;
  /** Gaps of 1 to 2 s per 100 presses. Context only, never part of the rule. */
  thinkingPer100: number | null;
  source: Source;
  savedAt: string;
}

export type CheckInAnswer = "okay" | "not-best" | "someone" | "not-now";

/** A check-in the companion proposed because measures stood out, and the answer. */
export interface PromptedCheckIn {
  id: string;
  date: DayKey;
  at: string; // ISO
  answer: CheckInAnswer;
  /** Which measures had changed, and which way. */
  triggeredBy: { key: PassiveKey; direction: "up" | "down" }[];
  /** How many recent days and usual days the comparison used (older check-ins: sessions and days). */
  basedOn: { days: number; usualDays?: number; sessions?: number };
  /** True when the change was simulated or the data was made-up demo data. */
  simulated: boolean;
}

/** The small things the companion may suggest after "Not my best". */
export type RoutineId = "walk" | "morning-light" | "regular-bedtime" | "music" | "call-someone";

/** The inputs the person can switch on or off, by category. A phone, a watch and a bedside device are not connected yet. */
export interface Sources {
  /** Energy, typing rhythm: key timing only. */
  typing: boolean;
  /** Sleep, estimated from first and last activity of the day. */
  dayRhythm: boolean;
  /** The camera: movement (Energy), face and posture (Mood). Off unless the person turns it on. */
  camera: boolean;
  /** The microphone: pace (Energy) and tone of voice (Mood); no words. Off unless turned on. */
  microphone: boolean;
  /** How many messages pass with the person they trust each day (never what they say). */
  contact: boolean;
}

export interface Settings {
  /** Mutes the companion's read-aloud voice. */
  muted: boolean;
  /** Set by the demo control "Simulate a change": propose a check-in now, ignoring the 3-day pause. */
  simulatedChangeAt?: string;
  /** Which sources are measured. Missing in older data: both on. */
  sources?: Sources;
  /** "Pause everything": nothing new is measured and the companion never speaks up. */
  pausedAll?: boolean;
  /** Which small things the companion may suggest. Missing in older data: all on. */
  routines?: Partial<Record<RoutineId, boolean>>;
  /** Quiet hours, "HH:MM": the companion never speaks up in between. Default 22:00 to 08:00. */
  quietHours?: { from: string; to: string };
  /**
   * Where the messages service lives, for example "http://192.168.1.20:3480" on a phone hotspot.
   * Missing: NEXT_PUBLIC_MESSAGES_URL from the build, else http://localhost:3480. Set under For the demo.
   */
  messagesUrl?: string;
  /** The daily question. Missing: every day, around midday. */
  dailyQuestion?: DailyQuestionSettings;
  /** Cheri's look (lib/look.ts). Missing: soft, peach. */
  look?: { fur: "soft" | "shaggy" | "smooth"; color: string };
  /** What the clinic is told (onboarding, Settings, My clinic). Missing: only when I say, and no automatic step. */
  clinic?: ClinicSettings;
  /** The camera and microphone may be used during the daily hello, after a tap. Missing: no. */
  helloSensors?: boolean;
}

/**
 * The ladder after "Not my best" (lib/ladder.ts): first one small thing, then someone
 * the person trusts, then the clinic. Dates are local days.
 */
export interface LadderState {
  /** The day "Not my best" (or "I'd like someone to check in on me") started it. */
  startedOn: DayKey;
  /** True when it started from a simulated change or made-up data. */
  simulated: boolean;
  /** Step 1: the one small thing offered, and the answer. `routine` is null when every routine was off. */
  smallThing?: { routine: RoutineId | null; offeredOn: DayKey; answer?: "try" | "not-now"; item?: string; label?: string; learned?: boolean };
  /** "I'd like someone to check in on me": step 2 is offered right away. */
  someoneRequestedOn?: DayKey;
  /** Step 2: someone you trust. `reply` is the person's yes or no to the trusted person's reply. */
  someone?: { offeredOn: DayKey; answer?: "yes" | "not-now"; reply?: "yes" | "no"; personId?: string; asked?: string[] };
  /** Step 3: a short summary for the clinic. */
  clinic?: { offeredOn: DayKey; answer?: "approve" | "not-now"; auto?: boolean; seenOn?: DayKey; sharedId?: string };
  /** The last time the person said "Not now" at any step. Respected for 3 days. */
  declinedOn?: DayKey;
  /** Set when the measures came back to the usual range, or the ladder ended. */
  closedOn?: DayKey;
}

export interface AppData {
  version: 1;
  profile: Profile | null;
  daily: DailyEntry[];
  weekly: WeeklyEntry[];
  reaction: ReactionResult[];
  /** From earlier versions: one per typing session. Still loads; the rule no longer uses it. */
  typingSessions: TypingSession[];
  /** Typing per day and kind of app. Missing in older data. */
  typingDays?: TypingDay[];
  /** Answers to the daily question. Missing in older data. */
  dailyAnswers?: DailyAnswer[];
  /** Stretches with the camera on. Missing in older data. */
  movementSessions?: StoredMovementSession[];
  /** Messages with the person they trust, per day. Missing in older data. */
  contactDays?: ContactDay[];
  /** Stretches with the microphone on. Missing in older data. */
  toneSessions?: StoredToneSession[];
  /** The usual posture across sessions. Missing in older data. */
  postureUsual?: PostureUsual | null;
  /** Nights from the phone's health data, one per night. Missing outside the phone app. */
  healthNights?: HealthNight[];
  /** Steps per day from the phone's health data. Missing outside the phone app. */
  stepDays?: StepsDay[];
  /**
   * The phone app's health data: when the person was asked for sleep and steps, and when they were
   * last read. Missing until asked (and always outside the phone app).
   */
  phoneHealth?: { askedAt: string; syncedAt?: string } | null;
  /** The phone app's notifications: the last day "Cheri would like a word" was shown. */
  phoneNotices?: { wordOn?: DayKey } | null;
  activityDays: ActivityDay[];
  checkIns: PromptedCheckIn[];
  settings: Settings;
  /** The ladder after "Not my best", or null. Missing in older data. */
  ladder?: LadderState | null;
  /** The person's own "What helps you?" list. Missing in older data: made from the routines (lib/helps.ts). */
  helps?: HelpItem[];
  /** Every step-one suggestion, and what followed it. Missing in older data. */
  suggestions?: SuggestionRecord[];
  /** "Shared with my clinic": what was shared and when. Demo recipient only; nothing is sent. */
  clinicShared?: ClinicSharedEntry[];
  /** Short readings from the daily hello (numbers only). Missing in older data. */
  helloReadings?: HelloReading[];
  /** Which onboarding the person has been through. Missing: the earlier two-step setup. */
  onboarding?: OnboardingState;
  /** What the person said on "What may I look at?", per permission. */
  permissions?: Partial<Record<PermissionKind, PermissionState>>;
}

// --- The phone flow (docs/MOBILE_SPEC.md) --------------------------------------------------

/** One thing on the person's own "What helps you?" list (lib/helps.ts). */
export interface HelpItem {
  /** A starting item's id ("outdoors", "music", ...) or "own-..." for one the person typed. */
  id: string;
  label: string;
  /** Off: never suggested. A removed own item is simply not in the list. */
  on: boolean;
  own: boolean;
}

/** One suggestion at step one: what was offered, whether it was taken, and what followed. */
export interface SuggestionRecord {
  id: string;
  /** The ladder it belongs to (its startedOn). */
  ladderStartedOn: DayKey;
  offeredOn: DayKey;
  /** The HelpItem id, and its label then. */
  item: string;
  label: string;
  /** "other" is "Something else": the next one was offered instead. Null until answered. */
  answer: "try" | "other" | "not-now" | null;
  /** Offered first because of what was followed by values coming back before. */
  learned: boolean;
  /** Judged after it was taken: did the categories come back within the following days? */
  cameBack?: boolean;
  judgedOn?: DayKey;
  simulated: boolean;
}

export type ClinicShare = "always" | "when-i-say" | "never";

export interface ClinicSettings {
  share: ClinicShare;
  /** "If my values have not come back after 7 days, tell my clinic for me." */
  tellAfterDays: boolean;
}

/** One entry on "Shared with my clinic". In this version a demo recipient: nothing is sent. */
export interface ClinicSharedEntry {
  id: string;
  date: DayKey;
  at: string; // ISO
  /** weekly: the "Always" summary; automatic: the ladder's step three as asked; approved: the person approved it. */
  kind: "weekly" | "automatic" | "approved";
  demoRecipient: true;
  /** Exactly what was shared: the report as it was that day (lib/report.ts). */
  report: import("./report").Report;
  simulated: boolean;
}

/** A short reading from the daily hello: numbers only, no picture, no sound, no words. */
export interface HelloReading {
  date: DayKey;
  at: string; // ISO
  /** Seconds the person held to talk. */
  seconds: number;
  /** Face movement while talking (lib/camera), or null without a face or camera. */
  face: { animation: number; smilingShare: number } | null;
  /** Tone of voice while talking (lib/voice), or null without enough voice. */
  tone: { pitchVariability: number | null; segmentsPerMinute: number | null } | null;
  source: Source;
}

export interface OnboardingState {
  /** 2: the phone flow's onboarding (one question per screen). */
  version: number;
  doneAt?: string;
  /** The day an existing person was quietly offered the new questions (offered once). */
  offeredOn?: DayKey;
}

export type PermissionKind = "health" | "location" | "notifications" | "camera-microphone";
/** granted / denied: the phone's answer; yes: said yes where the system asks later; skipped; not-here: not available on this device. */
export type PermissionState = "granted" | "denied" | "yes" | "skipped" | "not-here";
