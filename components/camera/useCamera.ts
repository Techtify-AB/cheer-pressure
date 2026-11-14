"use client";

import { useSyncExternalStore } from "react";
import { getServerView, getView, subscribe, type CameraView } from "@/lib/camera";

/** The camera's current state and live values, updated about 12 times a second while it runs. */
export function useCamera(): CameraView {
  return useSyncExternalStore(subscribe, getView, getServerView);
}
