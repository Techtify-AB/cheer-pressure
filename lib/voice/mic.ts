// The microphone, through Web Audio, entirely on this device.
//
// - Started only by startMic(), which the screen calls only when the person presses "Start
//   listening". Nothing is played out loud: the sound goes to an analyser and nowhere else.
// - Each frame of samples is analysed the moment it is read and then overwritten by the next;
//   no audio is kept, recorded, uploaded or sent. No speech recognition, no words.
// - stopMic() stops every track and closes the audio context, so the system's microphone
//   indicator goes off.

import type { AudioFrame } from "./tone";

/** Samples per frame: about 43 ms at 48 kHz, long enough for pitches down to 70 Hz. */
export const MIC_FRAME = 2048;

export type MicFailure = "denied" | "no-mic" | "in-use" | "unsupported" | "failed";

export class MicStartError extends Error {
  constructor(
    readonly reason: MicFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface MicHandle {
  sampleRate: number;
  stop(): void;
}

function failureOf(e: unknown): MicStartError {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return new MicStartError("denied", name);
  if (name === "NotFoundError" || name === "OverconstrainedError") return new MicStartError("no-mic", name);
  if (name === "NotReadableError" || name === "AbortError") return new MicStartError("in-use", name);
  return new MicStartError("failed", e instanceof Error ? e.message : String(e));
}

export async function startMic({
  onFrame,
  onEnded,
  isCancelled = () => false,
}: {
  onFrame: (frame: AudioFrame) => void;
  /** The microphone went away by itself (unplugged, or taken by the system). */
  onEnded?: () => void;
  isCancelled?: () => boolean;
}): Promise<MicHandle> {
  if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
    throw new MicStartError("unsupported", "no getUserMedia or AudioContext");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      // The raw sound: echo cancelling, noise suppression and automatic gain would change the
      // very loudness and pitch movement that are measured.
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch (e) {
    throw failureOf(e);
  }
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  if (isCancelled()) {
    stopTracks();
    throw new MicStartError("failed", "cancelled");
  }

  let ctx: AudioContext;
  let analyser: AnalyserNode;
  try {
    ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
    const source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = MIC_FRAME;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser); // to the analyser only, never to the speakers
  } catch (e) {
    stopTracks();
    throw failureOf(e);
  }

  const buf = new Float32Array(MIC_FRAME);
  const frameMs = (MIC_FRAME / ctx.sampleRate) * 1000;
  let running = true;
  const timer = setInterval(() => {
    if (!running) return;
    analyser.getFloatTimeDomainData(buf);
    onFrame({ t: performance.now() - frameMs, samples: buf, sampleRate: ctx.sampleRate });
  }, frameMs);

  const ended = () => {
    handle.stop();
    onEnded?.();
  };
  stream.getAudioTracks().forEach((t) => t.addEventListener("ended", ended));

  const handle: MicHandle = {
    sampleRate: ctx.sampleRate,
    stop() {
      if (!running) return;
      running = false;
      clearInterval(timer);
      stream.getAudioTracks().forEach((t) => t.removeEventListener("ended", ended));
      stopTracks();
      buf.fill(0);
      void ctx.close().catch(() => undefined);
    },
  };
  return handle;
}
