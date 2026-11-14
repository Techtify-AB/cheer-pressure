// Writes the two sounds the activities play (public/audio/), synthesised from nothing but
// sine waves, so they carry no third-party rights. Plain Node, no dependencies.
//
//   node scripts/make-audio.mjs
//
// warm-pad.wav   a soft, warm chord that breathes slowly (One song, one first step)
// low-drone.wav  a calm low drone with a slow swell (Wind down the evening)
//
// Both are 60 seconds, mono, 16-bit PCM WAV at 11 025 Hz (about 1.3 MB each), which every
// browser and the iOS and Android web views play. The content sits well below 2 kHz, so the
// low sample rate loses nothing you would hear. Fade in 4 s, fade out 6 s.
// To use other files, change the `src` lines in lib/activities/sounds.ts.

import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const RATE = 11025;
const SECONDS = 60;
const FADE_IN = 4;
const FADE_OUT = 6;
const OUT = path.resolve(import.meta.dirname, "../public/audio");

/** A small deterministic random source, so the files are the same every run. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function envelope(t) {
  const fadeIn = t < FADE_IN ? 0.5 - 0.5 * Math.cos((Math.PI * t) / FADE_IN) : 1;
  const left = SECONDS - t;
  const fadeOut = left < FADE_OUT ? 0.5 - 0.5 * Math.cos((Math.PI * Math.max(0, left)) / FADE_OUT) : 1;
  return fadeIn * fadeOut;
}

/**
 * One voice: a note with a few soft harmonics, three copies slightly detuned against each
 * other (the chorus that makes it warm), and a slow swell of its own.
 */
function voice({ freq, gain, partials, rolloff, detuneCents, swellHz, swellDepth, phase }) {
  const copies = [-detuneCents, 0, detuneCents].map((c) => freq * 2 ** (c / 1200));
  return (t) => {
    let v = 0;
    for (const f of copies) {
      for (let n = 1; n <= partials; n++) {
        v += Math.sin(2 * Math.PI * f * n * t + phase * n) / n ** rolloff;
      }
    }
    const swell = 1 - swellDepth + swellDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * swellHz * t + phase));
    return (v / copies.length) * gain * swell;
  };
}

function render(voices) {
  const n = RATE * SECONDS;
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    let v = 0;
    for (const fn of voices) v += fn(t);
    v *= envelope(t);
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  // Peak at about -6 dBFS: calm, and no clipping on any device.
  const scale = 0.5 / (peak || 1);
  for (let i = 0; i < n; i++) out[i] *= scale;
  return out;
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function pad() {
  const r = rng(7);
  // D major seven, spread out: D3, A3, C#4, F#4. Soft and open, no tension.
  const notes = [146.83, 220.0, 277.18, 369.99];
  return notes.map((freq, i) =>
    voice({
      freq,
      gain: [1, 0.8, 0.55, 0.45][i],
      partials: 4,
      rolloff: 2,
      detuneCents: 4 + r() * 3,
      swellHz: 0.04 + r() * 0.06,
      swellDepth: 0.45,
      phase: r() * Math.PI * 2,
    }),
  );
}

function drone() {
  const r = rng(11);
  // A2 with its fifth and octave. The harmonics keep it audible on a phone's small speaker.
  const notes = [110.0, 164.81, 220.0];
  return notes.map((freq, i) =>
    voice({
      freq,
      gain: [1, 0.5, 0.35][i],
      partials: 6,
      rolloff: 1.6,
      detuneCents: 2 + r() * 1.5,
      swellHz: 0.025 + r() * 0.03,
      swellDepth: 0.35,
      phase: r() * Math.PI * 2,
    }),
  );
}

mkdirSync(OUT, { recursive: true });
for (const [name, voices] of [
  ["warm-pad.wav", pad()],
  ["low-drone.wav", drone()],
]) {
  const file = wav(render(voices));
  writeFileSync(path.join(OUT, name), file);
  console.log(`${name}: ${(file.length / 1_000_000).toFixed(2)} MB, ${SECONDS} s, ${RATE} Hz mono`);
}
