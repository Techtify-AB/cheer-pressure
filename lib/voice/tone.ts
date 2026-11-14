// Tone of voice from short frames of microphone samples. Pure code with no browser APIs, so it
// runs the same in the browser and in the tests.
//
// What it measures, and nothing more: when the voice is on (voiced sound with a pitch in the
// range of speech), how many voiced stretches there are per minute of talking (a stand-in for
// pace), how much the pitch moves (a flat voice moves little), and how loud the voice is as
// this microphone hears it. No words, no speech recognition, nothing about what is said, and
// never a feeling: the product compares these with the person's own usual.
//
// Samples exist only for the moment a frame is analysed; nothing is kept but these numbers.

/** One frame of samples from the microphone (or a made-up signal), from -1 to 1. */
export interface AudioFrame {
  /** Milliseconds on any steady clock, at the start of the frame. */
  t: number;
  samples: Float32Array;
  sampleRate: number;
}

export interface FrameAnalysis {
  /** Loudness in dB below the microphone's full scale (0 is the loudest it can record). */
  db: number;
  /** Pitch in Hz, or null when the frame has no clear pitch in the range of speech. */
  pitch: number | null;
  voiced: boolean;
}

export interface ToneLive {
  /** A voice is heard right now. */
  voiceNow: boolean;
  /** Loudness of the newest frame, 0 to 100, for the level bar. */
  level: number;
  /** Minutes listened in this session. */
  listeningMinutes: number;
  /** Minutes of talking (voiced, or a short pause inside talking). */
  speakingMinutes: number;
  /** Voiced stretches per minute of talking, or null before there is enough talking. */
  segmentsPerMinute: number | null;
  /** How much the pitch moved in the last PITCH_WINDOW_MS, in semitones, or null. */
  pitchVariability: number | null;
  /** Mean loudness of the voice in the last PITCH_WINDOW_MS, in dB, or null. */
  loudnessDb: number | null;
}

/** One listening session, summarised. Numbers only; no audio. */
export interface ToneSession {
  /** Local calendar day the session started, "YYYY-MM-DD". */
  date: string;
  /** Minutes listened. */
  minutes: number;
  /** Minutes of talking. */
  speakingMinutes: number;
  /** Voiced stretches per minute of talking: a stand-in for pace. */
  segmentsPerMinute: number;
  /** How much the pitch moved, in semitones (standard deviation around the median). */
  pitchVariability: number;
  /** Mean loudness of the voice, in dB below full scale. Depends on the microphone and its distance. */
  loudnessMean: number;
  source: "computer" | "demo";
}

// ---------------------------------------------------------------------------------------
// Thresholds: first guesses, checked on made-up signals only. Real voices, rooms and
// microphones will need them looked at again.
// ---------------------------------------------------------------------------------------

/** Lowest and highest pitch counted as a voice. */
export const MIN_PITCH_HZ = 70;
export const MAX_PITCH_HZ = 400;
/** YIN threshold: how clearly a frame must repeat itself to have a pitch (lower is stricter). */
export const PITCH_CLARITY = 0.2;
/** Quieter than this (dB below full scale) is never a voice. */
export const MIN_VOICE_DB = -50;
/** A gap shorter than this inside a voiced stretch does not split it (shorter than one frame of 43 ms, so one unvoiced frame splits). */
export const MIN_GAP_MS = 40;
/** A voiced stretch shorter than this is not counted. */
export const MIN_SEGMENT_MS = 60;
/** Silence shorter than this still counts as talking time (a pause between syllables or words). */
export const PAUSE_MS = 500;
/** Pitch movement and loudness on screen are taken over this much time. */
export const PITCH_WINDOW_MS = 10000;
/** At least this many voiced frames before pitch movement or pace is shown. */
export const MIN_VOICED_FRAMES = 20;
/** The level bar runs from this many dB (empty) to 0 dB (full). */
export const LEVEL_FLOOR_DB = -60;
/** Sessions with less talking than this are not summarised. */
export const MIN_SPEAKING_MINUTES = 0.5;

export function rmsDb(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  const rms = Math.sqrt(s / Math.max(1, x.length));
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

/**
 * The pitch of a frame with the YIN method (de Cheveigné and Kawahara, 2002), or null when
 * there is none in MIN_PITCH_HZ to MAX_PITCH_HZ. A sound whose true period is shorter (a
 * high tone, whose multiples fall in the range) is not taken for a voice.
 */
export function detectPitch(x: Float32Array, sampleRate: number): number | null {
  const maxLag = Math.floor(sampleRate / MIN_PITCH_HZ);
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_PITCH_HZ));
  const w = x.length - maxLag;
  if (w < maxLag / 2) return null;
  // Difference function d(tau) for tau 1..maxLag, and its cumulative mean normalised form.
  const d = new Float32Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let j = 0; j < w; j++) {
      const v = x[j] - x[j + tau];
      s += v * v;
    }
    d[tau] = s;
  }
  const dn = new Float32Array(maxLag + 1);
  dn[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    run += d[tau];
    dn[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  // The shortest period with a clear dip: the first local minimum below the threshold.
  let best = -1;
  for (let tau = 2; tau < maxLag; tau++) {
    if (dn[tau] < PITCH_CLARITY && dn[tau] <= dn[tau - 1] && dn[tau] <= dn[tau + 1]) {
      best = tau;
      break;
    }
  }
  if (best < 0) return null;
  // A dip just as clear at a shorter lag means the sound repeats faster than a voice.
  if (best < minLag) return null;
  // Parabolic refinement of the lag.
  const a = dn[best - 1];
  const b = dn[best];
  const c = dn[best + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const f0 = sampleRate / (best + shift);
  return f0 >= MIN_PITCH_HZ && f0 <= MAX_PITCH_HZ ? f0 : null;
}

export function analyseFrame(f: AudioFrame): FrameAnalysis {
  const db = rmsDb(f.samples);
  const pitch = db >= MIN_VOICE_DB ? detectPitch(f.samples, f.sampleRate) : null;
  return { db, pitch, voiced: pitch !== null };
}

function semitoneSpread(pitches: number[]): number {
  if (pitches.length < 2) return 0;
  const sorted = [...pitches].sort((p, q) => p - q);
  const med = sorted[sorted.length >> 1];
  const st = pitches.map((p) => 12 * Math.log2(p / med));
  const m = st.reduce((s, v) => s + v, 0) / st.length;
  return Math.sqrt(st.reduce((s, v) => s + (v - m) ** 2, 0) / (st.length - 1));
}

const meanDb = (dbs: number[]) => {
  // Mean of the power, back to dB, so a few loud frames weigh as they sound.
  const p = dbs.reduce((s, v) => s + 10 ** (v / 10), 0) / dbs.length;
  return 10 * Math.log10(p);
};

export function toLevel(db: number): number {
  return Math.round(Math.min(100, Math.max(0, (100 * (db - LEVEL_FLOOR_DB)) / -LEVEL_FLOOR_DB)));
}

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface ToneTracker {
  /** Take in one frame (frames in time order). Returns what was found in it. */
  push(frame: AudioFrame): FrameAnalysis;
  live(): ToneLive;
  /** Ends the session: its summary, or null with too little talking. */
  end(): ToneSession | null;
}

export function createToneTracker(opts: { source: "computer" | "demo"; startedAt: number }): ToneTracker {
  let firstT: number | null = null;
  let lastEnd: number | null = null;
  let listeningMs = 0;
  let speakingMs = 0;
  let lastVoicedEnd: number | null = null;

  // Voiced stretches.
  let inSegment = false;
  let segStart = 0;
  let segCounted = false;
  let segments = 0;

  // The session's voiced frames, as pitch and loudness (numbers only).
  const pitches: number[] = [];
  const dbs: number[] = [];
  // The last PITCH_WINDOW_MS of voiced frames, for the screen.
  let recent: { t: number; pitch: number; db: number }[] = [];
  let lastLevel = 0;
  let voiceNow = false;

  return {
    push(frame) {
      const a = analyseFrame(frame);
      const dur = (frame.samples.length / frame.sampleRate) * 1000;
      const t = frame.t;
      if (firstT === null) firstT = t;
      const end = t + dur;
      const dt = lastEnd === null ? dur : Math.max(0, Math.min(end - lastEnd, 1000));
      lastEnd = end;
      listeningMs += dt;
      lastLevel = toLevel(a.db);
      voiceNow = a.voiced;

      if (a.voiced) {
        if (!inSegment && (lastVoicedEnd === null || t - lastVoicedEnd >= MIN_GAP_MS)) {
          segStart = t;
          segCounted = false;
        }
        inSegment = true;
        if (!segCounted && end - segStart >= MIN_SEGMENT_MS) {
          segments += 1;
          segCounted = true;
        }
        // Talking time includes the short pause since the last voiced frame.
        speakingMs += lastVoicedEnd !== null && t - lastVoicedEnd < PAUSE_MS ? Math.max(0, end - lastVoicedEnd) : dur;
        lastVoicedEnd = end;
        pitches.push(a.pitch!);
        dbs.push(a.db);
        recent.push({ t, pitch: a.pitch!, db: a.db });
      } else if (inSegment && lastVoicedEnd !== null && end - lastVoicedEnd >= MIN_GAP_MS) {
        inSegment = false;
      }
      recent = recent.filter((r) => t - r.t <= PITCH_WINDOW_MS);
      return a;
    },

    live() {
      const enough = recent.length >= MIN_VOICED_FRAMES;
      return {
        voiceNow,
        level: lastLevel,
        listeningMinutes: listeningMs / 60000,
        speakingMinutes: speakingMs / 60000,
        segmentsPerMinute: pitches.length >= MIN_VOICED_FRAMES && speakingMs > 0 ? (segments * 60000) / speakingMs : null,
        pitchVariability: enough ? semitoneSpread(recent.map((r) => r.pitch)) : null,
        loudnessDb: enough ? meanDb(recent.map((r) => r.db)) : null,
      };
    },

    end() {
      const speakingMinutes = speakingMs / 60000;
      const r = (v: number, d = 100) => Math.round(v * d) / d;
      const out =
        speakingMinutes < MIN_SPEAKING_MINUTES || pitches.length < MIN_VOICED_FRAMES
          ? null
          : {
              date: localDay(new Date(opts.startedAt)),
              minutes: r(listeningMs / 60000, 10),
              speakingMinutes: r(speakingMinutes, 10),
              segmentsPerMinute: r((segments * 60000) / speakingMs, 10),
              pitchVariability: r(semitoneSpread(pitches)),
              loudnessMean: r(meanDb(dbs), 10),
              source: opts.source,
            };
      return out;
    },
  };
}
