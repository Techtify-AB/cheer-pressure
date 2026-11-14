// The phone app's own native module (ios/CheerNativeModule.swift). Optional, so the JavaScript
// still loads where it is missing (Android today): every caller checks for null.

import { requireOptionalNativeModule } from "expo";

interface CheerNativeModule {
  bundlePort: number;
  hasWebBundle(): boolean;
  /** Resolves with the bundled interface's address, "http://127.0.0.1:<port>". */
  startBundleServer(): Promise<string>;
  hasBundledPage(path: string): boolean;
  mediaPermission(kind: "camera" | "microphone"): "granted" | "denied" | "not-asked";
  requestMediaPermission(kind: "camera" | "microphone"): Promise<"granted" | "denied" | "not-asked">;
  configureAudio(): boolean;
}

export const CheerNative = requireOptionalNativeModule<CheerNativeModule>("CheerNative");
