// The seam for reading face movement during the daily hello. One interface, one default
// implementation. A trained model plugs in by implementing FaceModel and changing
// `createFaceModel` at the bottom (README: "Plugging in a trained camera model").
//
// What a model gets, per analysed frame: the video frame (for a model that looks at pixels),
// and MediaPipe Face Landmarker's landmarks and blendshapes when they exist (for a model that
// works on those numbers). What it gives back: named numeric readings with a confidence from
// 0 to 1, never a picture, never a feeling or a label. The app stores the readings per day as
// this person's own values (lib/hello.ts) and words them only against the person's own usual.
//
// Rules any implementation must keep: runs on the device, with no network; model files live
// under public/models/ and load from the app's own origin; nothing of the frame is kept.

import { createExpressionTracker, toAnimationDisplay } from "./expression";

/** One analysed frame. Every field but `t` may be missing. */
export interface FaceInput {
  /** Milliseconds, increasing. */
  t: number;
  /** The frame itself, for a model that reads pixels. Never stored. */
  frame?: HTMLVideoElement | ImageBitmap | null;
  /** MediaPipe's 478 face landmarks (x, y, z from 0 to 1), when available. */
  landmarks?: { x: number; y: number; z: number }[] | null;
  /** MediaPipe's 52 blendshape scores by name, or null when no face was found. */
  blendshapes?: Record<string, number> | null;
}

/** What a model says about the frames so far. Named numbers only. */
export interface FaceReadings {
  readings: Record<string, number>;
  /** 0 to 1: how much there was to go on (for the default: seconds with a face, up to ten). */
  confidence: number;
}

export interface FaceModel {
  /** A short name stored with each reading, so values from different models are never mixed. */
  readonly name: string;
  /** Loads whatever the model needs (files under public/models/). Resolves when ready. */
  init(): Promise<void>;
  /** Takes one frame and returns the readings so far, or null while there is nothing yet. */
  read(input: FaceInput): FaceReadings | null;
  /** Releases everything the model holds. */
  dispose(): void;
}

/**
 * The default: lib/camera/expression.ts on MediaPipe's blendshapes. Readings: `animation`
 * (how much the face moved, 0 to 100) and `smilingShare` (share of the time the mouth corners
 * were raised, 0 to 1). Behaviour only; there is no emotion classifier.
 */
export function createExpressionFaceModel(): FaceModel {
  let tracker = createExpressionTracker();
  let sum = 0;
  let n = 0;
  return {
    name: "expression-v1",
    async init() {
      tracker = createExpressionTracker();
    },
    read(input) {
      tracker.push({ t: input.t, shapes: input.blendshapes ?? null });
      const live = tracker.live();
      if (!live.present && live.minutesWithFace === 0) return null;
      if (live.present) {
        const a = toAnimationDisplay(live.animation);
        sum += a;
        n += 1;
      }
      const seconds = live.minutesWithFace * 60;
      if (seconds < 1 || !n) return null;
      return {
        readings: { animation: Math.round(sum / n), smilingShare: Math.round(live.smilingShare * 1000) / 1000 },
        confidence: Math.min(1, seconds / 10),
      };
    },
    dispose() {
      tracker = createExpressionTracker();
      sum = n = 0;
    },
  };
}

/** The face model the app uses. Swap this for a trained model that implements FaceModel. */
export function createFaceModel(): FaceModel {
  return createExpressionFaceModel();
}
