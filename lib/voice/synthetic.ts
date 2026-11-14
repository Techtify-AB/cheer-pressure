// Made-up sound for the tests and the recorded example: tones with a few harmonics (roughly
// like a voiced sound), bursts of them like syllables, silence and noise. Pure and
// deterministic (seeded). Nothing here is ever played out loud.

import type { AudioFrame } from "./tone";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** What the signal is at a moment: a pitch (or none) and a loudness. */
export interface Sound {
  /** Pitch in Hz; null is silence or noise only. */
  f0: number | null;
  /** Level of the tone in dB below full scale (peak of the fundamental). */
  db: number;
  /** Level of added white noise in dB below full scale, or null for none. */
  noiseDb?: number | null;
}

export interface SignalOptions {
  sampleRate?: number;
  frameSize?: number;
  seed?: number;
}

/**
 * Frames of a signal described by `at(ms)`. The phase runs on continuously, so a gliding pitch
 * glides smoothly. Harmonics 2 to 4 are added at falling levels, as in a voiced sound.
 */
export function signalFrames(at: (ms: number) => Sound, durationMs: number, opts: SignalOptions = {}): AudioFrame[] {
  const sr = opts.sampleRate ?? 16000;
  const n = opts.frameSize ?? 1024;
  const rand = mulberry32(opts.seed ?? 5);
  const frames: AudioFrame[] = [];
  let phase = 0;
  const total = Math.floor((durationMs / 1000) * sr);
  for (let start = 0; start + n <= total; start += n) {
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const ms = ((start + i) / sr) * 1000;
      const s = at(ms);
      let v = 0;
      if (s.f0) {
        phase += (2 * Math.PI * s.f0) / sr;
        const a = 10 ** (s.db / 20);
        v = a * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.3 * Math.sin(3 * phase) + 0.15 * Math.sin(4 * phase)) / 1.2;
      }
      if (s.noiseDb != null) v += 10 ** (s.noiseDb / 20) * (rand() * 2 - 1) * Math.sqrt(3);
      x[i] = v;
    }
    frames.push({ t: (start / sr) * 1000, samples: x, sampleRate: sr });
  }
  return frames;
}

/** Bursts of tone like syllables: `on` ms of sound, `off` ms of silence, repeated. */
export function bursts(f0: (ms: number) => number, on: number, off: number, db = -22): (ms: number) => Sound {
  return (ms) => (ms % (on + off) < on ? { f0: f0(ms), db } : { f0: null, db: -120 });
}

// ---------------------------------------------------------------------------------------
// The recorded example: about 30 seconds, never played out loud.
//   0 to 2 s     quiet room
//   2 to 12 s    lively talking: about 3.3 bursts a second, the pitch moving up and down
//   12 to 15 s   a pause
//   15 to 27 s   flatter, slower and quieter talking: 2 bursts a second, the pitch hardly moving
//   27 to 30 s   quiet room
// ---------------------------------------------------------------------------------------

export const VOICE_EXAMPLE_MS = 30000;

export function voiceExampleSound(ms: number): Sound {
  const room = { f0: null, db: -120, noiseDb: -62 };
  if (ms < 2000 || (ms >= 12000 && ms < 15000) || ms >= 27000) return room;
  if (ms < 12000) {
    const t = ms - 2000;
    const syl = t % 300 < 150;
    // Intonation: a slow rise and fall of about 4 semitones each way, plus a lift per word.
    const st = 4 * Math.sin((2 * Math.PI * t) / 2200) + 2 * Math.sin((2 * Math.PI * t) / 700);
    return syl ? { f0: 190 * 2 ** (st / 12), db: -20, noiseDb: -62 } : room;
  }
  const t = ms - 15000;
  const syl = t % 500 < 250;
  const st = 0.4 * Math.sin((2 * Math.PI * t) / 3000);
  return syl ? { f0: 165 * 2 ** (st / 12), db: -27, noiseDb: -62 } : room;
}

export function voiceExampleFrames(opts: SignalOptions = {}): AudioFrame[] {
  return signalFrames(voiceExampleSound, VOICE_EXAMPLE_MS, { seed: 2028, ...opts });
}
