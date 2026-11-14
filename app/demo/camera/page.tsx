"use client";

// "Camera, live", the deeper view behind the Energy and Mood panels of Live (/live/). Everything lives in components/camera/ and
// lib/camera/; MediaPipe is loaded only when the person presses "Start the camera".

import { MovementLive } from "@/components/camera/MovementLive";

export default function CameraPage() {
  return <MovementLive />;
}
