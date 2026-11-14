// The seam for the camera: movement (Energy), and facial expression and posture (Mood).
// Everything the rest of the app will need later comes from here; nothing outside lib/camera/
// and components/camera/ uses it yet.
//
//   import { onCameraSession, type CameraSession } from "@/lib/camera";
//   onCameraSession((s) => addCameraSession(s)); // storing it is not done yet (see the report)
//
// Importing this module does not load MediaPipe: the library is fetched only inside
// startCamera(). It is a client module (it touches the camera), so call it from client code.
//
// Behaviour only: these numbers say how much someone moved, how their face moved and how they
// sat compared with their own usual. They never name a feeling.

export {
  getServerView,
  getView,
  onCameraSession,
  onSession,
  playExample,
  resetCamera,
  startCamera,
  stopCamera,
  stopExample,
  subscribe,
  type CameraPhase,
  type CameraSession,
  type CameraView,
} from "./controller";
export type { LiveMovement, MovementSession, PoseFrame, PosePoints } from "./movement";
export type { ExpressionLive, ExpressionSession, FaceFrame } from "./expression";
export type { PostureLive, PostureSession, PostureState } from "./posture";
export {
  HOLD_MS,
  MIN_SESSION_MINUTES,
  PRESENCE_GRACE_MS,
  SESSION_GAP_MS,
  SHIFT_THRESHOLD,
  createTracker,
  summarise,
} from "./movement";
export { CALIBRATION_MS, POSTURE_BAND } from "./posture";
