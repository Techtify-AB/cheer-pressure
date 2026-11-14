// The camera with MediaPipe Pose Landmarker and Face Landmarker, entirely on this device.
//
// - The library, its WebAssembly and the model are vendored under public/ and load from the
//   app's own origin (see public/vendor/mediapipe/README.md). The library is imported only
//   when start() is called, never when a page loads.
// - Only three pose points and the face's blendshape scores exist in memory: no frame is stored, copied to a canvas,
//   uploaded or sent anywhere. The video element shows the picture and MediaPipe reads it.
// - stop() ends the loop, closes the landmarker and stops every camera track, so the
//   camera light goes off.

import type { FaceFrame } from "./expression";
import type { PoseFrame } from "./movement";

const BUNDLE_URL = "/vendor/mediapipe/vision_bundle.mjs";
const WASM_BASE = "/vendor/mediapipe/wasm";
const MODEL_URL = "/models/pose_landmarker_lite.task";
const FACE_MODEL_URL = "/models/face_landmarker.task";

/** About 12 analysed frames per second. */
export const POSE_FPS = 12;

// MediaPipe's pose landmark numbers.
const NOSE = 0;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

// The few parts of @mediapipe/tasks-vision 0.10.35 used here (its own types are not vendored).
interface Landmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}
interface PoseLandmarkerResult {
  landmarks: Landmark[][];
  close?: () => void;
}
interface PoseLandmarker {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): PoseLandmarkerResult;
  close(): void;
}
interface FaceLandmarkerResult {
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
}
interface FaceLandmarker {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResult;
  close(): void;
}
interface WasmFileset {
  wasmLoaderPath: string;
  wasmBinaryPath: string;
}
interface VisionModule {
  FilesetResolver: { forVisionTasks(basePath?: string): Promise<WasmFileset> };
  PoseLandmarker: {
    createFromOptions(fileset: WasmFileset, options: Record<string, unknown>): Promise<PoseLandmarker>;
  };
  FaceLandmarker: {
    createFromOptions(fileset: WasmFileset, options: Record<string, unknown>): Promise<FaceLandmarker>;
  };
}

export type Delegate = "GPU" | "CPU";

/** Why the camera could not start, in terms the screen can word calmly. */
export type StartFailure = "denied" | "no-camera" | "in-use" | "unsupported" | "failed";

export class CameraStartError extends Error {
  constructor(
    readonly reason: StartFailure,
    message: string,
  ) {
    super(message);
  }
}

export interface PoseHandle {
  delegate: Delegate;
  /** The face model loaded; without it only movement and posture are measured. */
  face: boolean;
  stop(): void;
}

let visionModule: Promise<VisionModule> | null = null;

function loadVision(): Promise<VisionModule> {
  if (!visionModule) {
    const url = new URL(BUNDLE_URL, window.location.origin).href;
    visionModule = import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url) as Promise<VisionModule>;
    visionModule.catch(() => {
      visionModule = null; // let a later start try again
    });
  }
  return visionModule;
}

async function createLandmarkers(): Promise<{ pose: PoseLandmarker; face: FaceLandmarker | null; delegate: Delegate }> {
  const vision = await loadVision();
  const fileset = await vision.FilesetResolver.forVisionTasks(new URL(WASM_BASE, window.location.origin).href);
  const abs = (u: string) => new URL(u, window.location.origin).href;
  const poseOptions = (delegate: Delegate) => ({
    baseOptions: { modelAssetPath: abs(MODEL_URL), delegate },
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  });
  const faceOptions = (delegate: Delegate) => ({
    baseOptions: { modelAssetPath: abs(FACE_MODEL_URL), delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: false,
  });
  let delegate: Delegate = "GPU";
  let pose: PoseLandmarker;
  try {
    pose = await vision.PoseLandmarker.createFromOptions(fileset, poseOptions("GPU"));
  } catch {
    delegate = "CPU";
    pose = await vision.PoseLandmarker.createFromOptions(fileset, poseOptions("CPU"));
  }
  // The face is a second model; if it cannot load, movement and posture still work.
  let face: FaceLandmarker | null = null;
  try {
    face = await vision.FaceLandmarker.createFromOptions(fileset, faceOptions(delegate));
  } catch {
    try {
      face = await vision.FaceLandmarker.createFromOptions(fileset, faceOptions("CPU"));
    } catch {
      face = null;
    }
  }
  return { pose, face, delegate };
}

function failureOf(e: unknown): CameraStartError {
  const name = (e as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError") return new CameraStartError("denied", name);
  if (name === "NotFoundError" || name === "OverconstrainedError") return new CameraStartError("no-camera", name);
  if (name === "NotReadableError" || name === "AbortError") return new CameraStartError("in-use", name);
  return new CameraStartError("failed", e instanceof Error ? e.message : String(e));
}

async function openCamera(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new CameraStartError("unsupported", "no getUserMedia");
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
    });
  } catch (e) {
    throw failureOf(e);
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * Starts the camera in `video` and calls `onFrame` about POSE_FPS times a second with the
 * three points (or null when no one is found). `isCancelled` lets the caller abandon a start
 * that is still under way; the camera is then released before this rejects.
 */
export async function startPose(
  video: HTMLVideoElement,
  {
    onFrame,
    onEnded,
    isCancelled = () => false,
  }: {
    onFrame: (frame: PoseFrame, face: FaceFrame | null) => void;
    /** The camera went away by itself (unplugged, or taken by the system). */
    onEnded?: () => void;
    isCancelled?: () => boolean;
  },
): Promise<PoseHandle> {
  // The camera and the library load at the same time; if either fails, the other is released.
  const cam = openCamera();
  const lm = createLandmarkers();
  let stream: MediaStream | null = null;
  let landmarker: PoseLandmarker | null = null;
  let faceLandmarker: FaceLandmarker | null = null;
  let delegate: Delegate = "CPU";
  try {
    const [s, l] = await Promise.allSettled([cam, lm]);
    if (s.status === "fulfilled") stream = s.value;
    if (l.status === "fulfilled") {
      landmarker = l.value.pose;
      faceLandmarker = l.value.face;
      delegate = l.value.delegate;
    }
    if (s.status === "rejected") throw s.reason instanceof CameraStartError ? s.reason : failureOf(s.reason);
    if (l.status === "rejected") throw new CameraStartError("failed", String(l.reason));
    if (isCancelled()) throw new CameraStartError("failed", "cancelled");

    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    stopStream(stream);
    landmarker?.close();
    faceLandmarker?.close();
    video.srcObject = null;
    throw e instanceof CameraStartError ? e : failureOf(e);
  }

  let running = true;
  let raf = 0;
  let last = -Infinity;
  let lastVideoTime = -1;
  const interval = 1000 / POSE_FPS;
  const lmk = landmarker!;
  const fmk = faceLandmarker;

  const tick = () => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    if (now - last < interval - 2) return;
    if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
    last = now;
    lastVideoTime = video.currentTime;
    let points: PoseFrame["points"] = null;
    try {
      const result = lmk.detectForVideo(video, now);
      const pose = result.landmarks?.[0];
      if (pose && pose.length > RIGHT_SHOULDER) {
        const pick = (l: Landmark) => ({ x: l.x, y: l.y, visibility: l.visibility });
        points = { nose: pick(pose[NOSE]), leftShoulder: pick(pose[LEFT_SHOULDER]), rightShoulder: pick(pose[RIGHT_SHOULDER]) };
      }
      result.close?.();
    } catch {
      points = null;
    }
    let face: FaceFrame | null = null;
    if (fmk) {
      let shapes: Record<string, number> | null = null;
      try {
        const cats = fmk.detectForVideo(video, now).faceBlendshapes?.[0]?.categories;
        if (cats?.length) {
          shapes = {};
          for (const c of cats) shapes[c.categoryName] = c.score;
        }
      } catch {
        shapes = null;
      }
      face = { t: now, shapes };
    }
    const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    onFrame({ t: now, aspect, points }, face);
  };
  raf = requestAnimationFrame(tick);

  // If the camera goes away (unplugged, or taken by the system), stop cleanly.
  const ended = () => {
    handle.stop();
    onEnded?.();
  };
  stream!.getVideoTracks().forEach((t) => t.addEventListener("ended", ended));

  const handle: PoseHandle = {
    delegate,
    face: !!fmk,
    stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      stream!.getVideoTracks().forEach((t) => t.removeEventListener("ended", ended));
      stopStream(stream);
      try {
        lmk.close();
        fmk?.close();
      } catch {
        // already closed
      }
      video.pause();
      video.srcObject = null;
    },
  };
  return handle;
}
