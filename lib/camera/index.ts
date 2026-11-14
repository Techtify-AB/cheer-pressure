// The seam for movement in front of the computer. Everything the rest of the app will need
// later comes from here; nothing outside lib/camera/ and components/camera/ uses it yet.
//
//   import { onSession, type MovementSession } from "@/lib/camera";
//   onSession((s) => addMovementSession(s)); // storing it is not done yet (see the report)
//
// Importing this module does not load MediaPipe: the library is fetched only inside
// startCamera(). It is a client module (it touches the camera), so call it from client code.

export {
  getServerView,
  getView,
  onSession,
  playExample,
  resetCamera,
  startCamera,
  stopCamera,
  stopExample,
  subscribe,
  type CameraPhase,
  type CameraView,
} from "./controller";
export type { LiveMovement, MovementSession, PoseFrame, PosePoints } from "./movement";
export {
  HOLD_MS,
  MIN_SESSION_MINUTES,
  PRESENCE_GRACE_MS,
  SESSION_GAP_MS,
  SHIFT_THRESHOLD,
  createTracker,
  summarise,
} from "./movement";
