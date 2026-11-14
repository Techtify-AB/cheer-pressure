// Which screen a notification opens. The notice says its path ("/hello/", "/prompt/"); when that
// screen is not in this interface (the daily hello's screen is still being built), home opens.

import { CheerNative } from "../modules/cheer-native";
import { WEB_SOURCE } from "./config";

function clean(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) return "/";
  return path;
}

export async function screenFor(base: string, wanted: string): Promise<string> {
  const path = clean(wanted);
  if (path === "/") return path;
  if (WEB_SOURCE.kind === "bundle") return CheerNative?.hasBundledPage(path.split("?")[0]) ? path : "/";
  try {
    const r = await fetch(base + path, { method: "HEAD" });
    return r.ok ? path : "/";
  } catch {
    return "/";
  }
}

/** True when `url` is part of the interface (same origin), so it stays in the WebView. */
export function isInterface(base: string, url: string): boolean {
  return url === base || url.startsWith(base + "/") || url.startsWith(base + "?") || url.startsWith(base + "#") || url.startsWith("about:") || url.startsWith("blob:") || url.startsWith("data:");
}
