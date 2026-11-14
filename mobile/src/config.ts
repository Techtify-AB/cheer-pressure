// Where the WebView's interface comes from.
//
// Development builds load the web dev server: EXPO_PUBLIC_WEB_URL (read when Metro starts), else
// http://localhost:3470, which the simulator reaches on this Mac. EXPO_PUBLIC_WEB_URL=bundle makes
// a development build use the bundled interface instead, to try it without a release build.
// Release builds always load the interface bundled into the app (scripts/copy-web.mjs), served by
// the native module on http://127.0.0.1:41473 (why not file://: modules/cheer-native/ios/BundleServer.swift).

export const IS_DEV = __DEV__;

const fromEnv = (process.env.EXPO_PUBLIC_WEB_URL ?? "").trim();

/** "dev-server" (with its URL) or "bundle". */
export const WEB_SOURCE: { kind: "dev-server"; url: string } | { kind: "bundle" } =
  !IS_DEV || fromEnv === "bundle" ? { kind: "bundle" } : { kind: "dev-server", url: (fromEnv || "http://localhost:3470").replace(/\/+$/, "") };

/** The page's colour until it says its own (styles/tokens.css --color-bg). */
export const PAGE_BACKGROUND = "#f6f2ea";
