"use client";

// Movement from the camera, at app level, in the main window only (components/AppShell.tsx).
//
// - The camera runs only while the person has it on in Settings (off by default), nothing is
//   paused, and the Cheer Pressure window is open and showing. It is asked for only then.
// - It hands the camera to "Camera, live" (/demo/camera/) while that screen is open, which
//   runs the same controller with its own picture.
// - Every finished stretch (numbers only) is stored once, here: lib/storage.ts.
// - While it runs, a small key in local storage says so, so the mascot window, which has no
//   camera of its own, can show "Camera on" too. The picture is never kept or sent.

import { usePathname } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useCamera } from "@/components/camera/useCamera";
import { onCameraSession, resetCamera, startCamera, stopCamera } from "@/lib/camera";
import { sourcesOf } from "@/lib/settings";
import { readData, saveMovementSession, useData } from "@/lib/storage";

export const CAMERA_LIVE_KEY = "cheerpressure.camera.live";
const HEARTBEAT_MS = 2000;

function subscribeVisibility(cb: () => void) {
  document.addEventListener("visibilitychange", cb);
  return () => document.removeEventListener("visibilitychange", cb);
}
const isVisible = () => document.visibilityState !== "hidden";

/** True when the main window says its camera ran in the last few seconds (for the mascot). */
export function cameraHeartbeatFresh(): boolean {
  try {
    const t = Number(window.localStorage.getItem(CAMERA_LIVE_KEY));
    return Number.isFinite(t) && Date.now() - t < HEARTBEAT_MS * 2.5;
  } catch {
    return false;
  }
}

export function CameraBridge() {
  const data = useData();
  const pathname = usePathname();
  const video = useRef<HTMLVideoElement>(null);
  const view = useCamera();
  const visible = useSyncExternalStore(subscribeVisibility, isVisible, () => true);
  const onCameraScreen = !!pathname?.startsWith("/demo/camera");
  const wanted = !!data?.profile && sourcesOf(data.settings).camera && !data.settings.pausedAll && visible;

  // Finished stretches go into storage, once, while the person has the camera on: movement
  // (Energy), and face movement and posture (Mood). Numbers only.
  useEffect(
    () =>
      onCameraSession((s) => {
        if (s.source !== "computer" || !sourcesOf(readData().settings).camera) return;
        saveMovementSession({
          date: s.date,
          minutes: s.minutes,
          movementMean: s.movement.movementMean,
          shiftsPerHour: s.movement.shiftsPerHour,
          expression: s.expression ? { ...s.expression } : null,
          posture: s.posture ? { ...s.posture } : null,
          source: "user",
          savedAt: new Date().toISOString(),
        });
      }),
    [],
  );

  // Whether the camera running now was started here (not by "Camera, live").
  const ours = useRef(false);
  useEffect(() => {
    const phase = view.phase;
    if (onCameraScreen) {
      // That screen shows its own picture: hand the camera over.
      if (ours.current && (phase === "on" || phase === "starting")) stopCamera();
      ours.current = false;
      return;
    }
    if (wanted && phase === "off" && video.current) {
      ours.current = true;
      void startCamera(video.current);
    } else if (!wanted && (phase === "on" || phase === "starting")) stopCamera();
    else if (!wanted && phase !== "off" && phase !== "example") resetCamera();
  }, [wanted, view.phase, onCameraScreen]);

  // Stop when the app's window goes away.
  useEffect(() => () => stopCamera(), []);

  // "Camera on" for the mascot window.
  const on = view.phase === "on";
  useEffect(() => {
    if (!on) {
      try {
        window.localStorage.removeItem(CAMERA_LIVE_KEY);
      } catch {
        // nothing to clear
      }
      return;
    }
    const beat = () => {
      try {
        window.localStorage.setItem(CAMERA_LIVE_KEY, String(Date.now()));
      } catch {
        // storage blocked: the mascot simply shows nothing
      }
    };
    beat();
    const id = window.setInterval(beat, HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [on]);

  // Kept out of sight but rendered, so the picture keeps decoding for MediaPipe.
  return <video ref={video} className="camera-feed" muted playsInline aria-hidden="true" tabIndex={-1} />;
}

/** The "Camera on" sign, on every screen of the main window while the camera runs ("Camera, live" shows its own). */
export function CameraOnSign() {
  const view = useCamera();
  const pathname = usePathname();
  if (view.phase !== "on" || pathname?.startsWith("/demo/camera")) return null;
  return (
    <span className="camera-on" role="status">
      <span className="camera-on-dot" aria-hidden="true" />
      Camera on
    </span>
  );
}
