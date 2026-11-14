"use client";

// Measures reading pace on the device.
//
// The microphone stream goes into a Web Audio analyser. We keep only one loudness
// number per 30 ms frame (no audio, no recording), find where speech starts and
// ends with a simple energy threshold, and divide the sentence's known word count
// by that speaking time. Nothing leaves the browser. No speech recognition is used.

const FRAME_MS = 30;
const MAX_MS = 20000;
const SILENCE_TO_STOP_MS = 1500;
const MIN_SPEECH_MS = 700;

export type PaceError = "unavailable" | "denied" | "not-heard";

export interface PaceResult {
  wordsPerSecond: number;
  speakingSeconds: number;
}

export interface PaceMeter {
  stop: () => void;
  cancel: () => void;
}

interface Options {
  wordCount: number;
  onLevel: (level: number) => void; // 0 to 1, for a live meter
  onResult: (r: PaceResult) => void;
  onError: (e: PaceError) => void;
}

function percentile(values: number[], q: number) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))] ?? 0;
}

/** Turns per-frame loudness into a speaking span (in frames), or null. */
export function speechSpan(rms: number[]): { start: number; end: number } | null {
  if (rms.length < 5) return null;
  const noise = percentile(rms, 0.15);
  const peak = percentile(rms, 0.95);
  const threshold = Math.max(noise * 2.5, noise + (peak - noise) * 0.2, 0.006);
  const active = rms.map((v) => v > threshold);
  // need three active frames in a row to count as speech start or end
  let start = -1;
  for (let i = 0; i + 2 < active.length; i++) {
    if (active[i] && active[i + 1] && active[i + 2]) {
      start = i;
      break;
    }
  }
  let end = -1;
  for (let i = active.length - 1; i - 2 >= 0; i--) {
    if (active[i] && active[i - 1] && active[i - 2]) {
      end = i;
      break;
    }
  }
  if (start < 0 || end <= start) return null;
  return { start, end };
}

export async function startPaceMeter(opts: Options): Promise<PaceMeter | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    opts.onError("unavailable");
    return null;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    opts.onError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    return null;
  }

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const rms: number[] = [];
  let finished = false;
  let loudFrames = 0;
  let lastLoud = -1;
  let heardSpeech = false;
  const startedAt = performance.now();

  const cleanup = () => {
    window.clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    source.disconnect();
    void ctx.close();
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    const span = speechSpan(rms);
    if (!span) return opts.onError("not-heard");
    const seconds = ((span.end - span.start + 1) * FRAME_MS) / 1000;
    const wps = opts.wordCount / seconds;
    if (seconds < 1.2 || wps > 6 || wps < 0.5) return opts.onError("not-heard");
    opts.onResult({ wordsPerSecond: Math.round(wps * 100) / 100, speakingSeconds: Math.round(seconds * 10) / 10 });
  };

  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const v = Math.sqrt(sum / buf.length);
    rms.push(v);
    opts.onLevel(Math.min(1, v * 12));

    // Live auto-stop: after some speech, stop once it has been quiet for a while.
    const now = performance.now();
    const floor = percentile(rms, 0.15);
    const loud = v > Math.max(floor * 2.5, 0.006);
    if (loud) {
      loudFrames++;
      lastLoud = now;
      if (loudFrames * FRAME_MS > MIN_SPEECH_MS) heardSpeech = true;
    }
    if ((heardSpeech && now - lastLoud > SILENCE_TO_STOP_MS) || now - startedAt > MAX_MS) finish();
  }, FRAME_MS);

  return {
    stop: finish,
    cancel: () => {
      if (finished) return;
      finished = true;
      cleanup();
    },
  };
}
