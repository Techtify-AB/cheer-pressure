/**
 * The face feed from the Arduino board (ml/edge/face_stream.py). The board reads the camera, runs the
 * expression model and sends numbers only: no image ever leaves it.
 *
 * These describe facial expression against the person's own usual. They are not a diagnosis.
 */
import { useEffect, useRef, useState } from "react";

export const EXPRESSIONS = ["Anger", "Contempt", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

/** The latest frame, smoothed over about 3 seconds. Arrives about 5 times a second. */
export type FaceLive =
  | { t: number; face: false; why: "no-face" | "low-score" | "too-small" | "turned-away" | "tilted" }
  | {
      t: number;
      face: true;
      label: Expression;
      /** Probability of `label`, 0 to 1. */
      confidence: number;
      /** How positive the face looks, about -1 to 1. */
      valence: number;
      arousal: number;
      probs: Record<Expression, number>;
      /** Blendshape measures: smile, browDown, jawOpen (0 to 1) and animation (movement over the last second). */
      blend: { smile: number; browDown: number; jawOpen: number; animation: number } | null;
    };

/** One finished minute. `valid` is false when the face was in view for under 20 seconds. */
export interface FaceMinute {
  /** Start of the minute, seconds since 1970. */
  t0: number;
  valid: boolean;
  face_s: number;
  valence_med: number | null;
  /** Share of frames that looked clearly not positive. */
  low_share: number | null;
  /** Share of frames with a smile. */
  smile_share: number | null;
  /** How much the face moves from frame to frame. */
  variability: number | null;
  /** Share of the minute each expression label gets. */
  labels: Record<Expression, number> | null;
  /** Minute means of the blendshape measures, plus the share of frames smiling / with brows lowered. */
  blend: { smile: number; browDown: number; jawOpen: number; animation: number; smile_share: number; brow_share: number } | null;
}

/** A sitting, an hour or a day: medians over valid minutes. `enough` needs 5 valid minutes. */
export interface FaceSummary {
  minutes: number;
  face_min: number;
  enough: boolean;
  valence_med: number | null;
  valence_iqr: [number, number] | null;
  low_share: number | null;
  smile_share: number | null;
  variability: number | null;
}

/** What the language model gets next to the person's words. `text` is one plain sentence. */
export interface FaceContext {
  t: number;
  now: FaceLive | null;
  recent: { minutes: number; top: [Expression, number][]; valence_med: number; smile_share: number; low_share: number } | null;
  today: FaceSummary;
  /** Against the person's own earlier minutes; null until there are 120 of them. */
  vs_usual: "below" | "usual" | "above" | null;
  text: string;
}

/** Sent every few minutes. `checkin` is set when the last 30 minutes sit below the person's own usual. */
export interface FaceUpdate {
  context: FaceContext;
  checkin: { reason: "below-own-usual" | "low-no-baseline-yet"; text: string } | null;
}

/** Something the person said, heard and transcribed on the board, with the face for those seconds. */
export interface FaceSpeech {
  t0: number;
  t1: number;
  text: string;
  /** Null when the face was not in view while they spoke. */
  face: { label: Expression; confidence: number; valence: number; smile_share: number; frames: number } | null;
  /** The words, the face and the recent trend as one paragraph for the language model. */
  prompt: string;
  /** Seconds the board took to transcribe. */
  stt_s?: number;
  words_per_s?: number;
}

export interface FaceSignal {
  connected: boolean;
  live: FaceLive | null;
  /** Minutes received since the page opened, oldest first. */
  minutes: FaceMinute[];
  update: FaceUpdate | null;
  /** The latest thing the person said. */
  speech: FaceSpeech | null;
}

export interface FaceHandlers {
  /** The board says it is time to ask how the person is doing. */
  onCheckin?: (u: FaceUpdate) => void;
  /** The person said something: pass `speech.prompt` to the language model. */
  onSpeech?: (s: FaceSpeech) => void;
}

/** Subscribe to the board. `base` is the board's address, e.g. "http://10.0.40.29:8765". */
export function useFaceSignal(base: string | null, handlers: FaceHandlers = {}): FaceSignal {
  const [signal, setSignal] = useState<FaceSignal>({ connected: false, live: null, minutes: [], update: null, speech: null });
  const cb = useRef(handlers);
  useEffect(() => {
    cb.current = handlers;
  });
  useEffect(() => {
    if (!base) return;
    const es = new EventSource(`${base}/events`); // reconnects by itself
    es.onopen = () => setSignal((s) => ({ ...s, connected: true }));
    es.onerror = () => setSignal((s) => ({ ...s, connected: false }));
    es.addEventListener("frame", (e) => setSignal((s) => ({ ...s, live: JSON.parse((e as MessageEvent).data) })));
    es.addEventListener("minute", (e) =>
      setSignal((s) => ({ ...s, minutes: [...s.minutes.slice(-599), JSON.parse((e as MessageEvent).data)] })),
    );
    es.addEventListener("update", (e) => {
      const update: FaceUpdate = JSON.parse((e as MessageEvent).data);
      setSignal((s) => ({ ...s, update }));
      if (update.checkin) cb.current.onCheckin?.(update);
    });
    es.addEventListener("speech", (e) => {
      const speech: FaceSpeech = JSON.parse((e as MessageEvent).data);
      setSignal((s) => ({ ...s, speech }));
      cb.current.onSpeech?.(speech);
    });
    return () => es.close();
  }, [base]);
  return signal;
}

/** The current snapshot, for the speech pipeline: add `text` to the prompt next to what the person said. */
export async function faceContext(base: string): Promise<FaceContext> {
  return (await fetch(`${base}/context`)).json();
}

/**
 * The face over the last `lastS` seconds, for a speech pipeline that runs off the board: call it when the
 * person stops talking. With `text`, `prompt` is the fused paragraph for the language model.
 */
export async function faceDuring(base: string, lastS = 5, text?: string): Promise<{ face: FaceSpeech["face"]; trend: string; prompt: string | null }> {
  const q = new URLSearchParams({ last_s: String(lastS), ...(text ? { text } : {}) });
  return (await fetch(`${base}/face?${q}`)).json();
}

/** Averages per hour or per day, for the report to the care team. */
export async function faceHistory(base: string, bucket: "hour" | "day" = "hour"): Promise<(FaceSummary & { t0: number; labels: Record<Expression, number> | null })[]> {
  return (await fetch(`${base}/history?bucket=${bucket}`)).json();
}
