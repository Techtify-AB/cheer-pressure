// Cheer Pressure on the phone: one full-screen WebView showing the same web interface as the
// browser and the desktop app, and a bridge (src/bridge.ts) for what a web page cannot do.

import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { CheerNative } from "./modules/cheer-native";
import { createBridge } from "./src/bridge";
import { IS_DEV, PAGE_BACKGROUND, WEB_SOURCE } from "./src/config";
import { registerDevTools } from "./src/devTools";
import { BACKGROUND_SCRIPT, beforeContentScript, deliverScript, FOREGROUND_SCRIPT, openPathScript } from "./src/inject";
import { isInterface, screenFor } from "./src/navigation";
import { noticeOf, type NoticeData } from "./src/notifications";
import { PHONE_BRIDGE_VERSION, type NativeToWeb } from "./src/protocol";

CheerNative?.configureAudio();

/** Light page: dark status bar text, and the other way round. */
function isDark(color: string): boolean {
  const m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

type Boot = { state: "starting" } | { state: "ready"; base: string; path: string } | { state: "failed"; message: string };

async function baseUrl(): Promise<string> {
  if (WEB_SOURCE.kind === "dev-server") return WEB_SOURCE.url;
  if (!CheerNative) throw new Error("This build has no bundled interface on this platform yet.");
  return CheerNative.startBundleServer();
}

function Shell() {
  const web = useRef<WebView>(null);
  const [boot, setBoot] = useState<Boot>({ state: "starting" });
  const [background, setBackground] = useState(PAGE_BACKGROUND);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loaded = useRef(false);
  /** Delivered after the next page load (a notification's screen opening). */
  const afterLoad = useRef<NativeToWeb[]>([]);

  const deliver = useCallback((msg: NativeToWeb) => {
    web.current?.injectJavaScript(deliverScript(msg));
  }, []);

  const bridge = useMemo(
    () =>
      createBridge(
        deliver,
        {
          // Health's sheet was answered: the page reads sleep and steps now (lib/phone.ts listens).
          healthAsked: () => deliver({ cheerPressure: PHONE_BRIDGE_VERSION, event: "app-state", data: { state: "active" } }),
        }
      ),
    [deliver],
  );

  const start = useCallback(async () => {
    setBoot({ state: "starting" });
    setLoadError(null);
    try {
      const base = await baseUrl();
      const tapped = noticeOf(Notifications.getLastNotificationResponse());
      const path = tapped ? await screenFor(base, tapped.path) : "/";
      if (tapped) afterLoad.current.push(openedEvent(tapped, path));
      setBoot({ state: "ready", base, path });
    } catch (e) {
      setBoot({ state: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  const base = boot.state === "ready" ? boot.base : null;

  // A tap on one of our notifications while the app is running or in the background.
  useEffect(() => {
    if (!base) return;
    const sub = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const n = noticeOf(response);
      if (!n) return;
      const path = await screenFor(base, n.path);
      afterLoad.current.push(openedEvent(n, path));
      web.current?.injectJavaScript(openPathScript(path));
    });
    return () => sub.remove();
  }, [base]);

  // Coming and going: sounds stop in the background, the page hears about it, the server is
  // started again if iOS closed it while the app was away.
  useEffect(() => {
    let last = AppState.currentState;
    const sub = AppState.addEventListener("change", async (next) => {
      if (next === last || next === "inactive" || next === "unknown" || next === "extension") return;
      last = next;
      if (next === "background") {
        web.current?.injectJavaScript(BACKGROUND_SCRIPT);
        bridge.event("app-state", { state: "background" });
        return;
      }
      if (WEB_SOURCE.kind === "bundle") await CheerNative?.startBundleServer().catch(() => null);
      web.current?.injectJavaScript(FOREGROUND_SCRIPT);
      bridge.event("app-state", { state: "active" });
    });
    return () => sub.remove();
  }, [bridge]);

  // Development builds: "Add eight made-up weeks to Health" in the developer menu and as a link.
  useEffect(() => {
    if (!IS_DEV) return;
    return registerDevTools(
      () => web.current?.reload(),
      (path) => web.current?.injectJavaScript(openPathScript(path)),
    );
  }, []);

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const raw = e.nativeEvent.data;
      if (raw.includes('"cheerPressureShell"')) {
        try {
          const m = JSON.parse(raw) as { cheerPressureShell: string; background?: string };
          if (m.cheerPressureShell === "look" && m.background) setBackground(m.background);
        } catch {
          // not ours
        }
        return;
      }
      bridge.receive(raw);
    },
    [bridge],
  );

  if (boot.state !== "ready") {
    return (
      <View style={[styles.center, { backgroundColor: PAGE_BACKGROUND }]}>
        <StatusBar style="dark" />
        {boot.state === "starting" ? (
          <ActivityIndicator color="#6b5e4a" />
        ) : (
          <Problem message={boot.message} onRetry={start} />
        )}
      </View>
    );
  }

  const dark = isDark(background);
  const injected = beforeContentScript({ version: PHONE_BRIDGE_VERSION, platform: Platform.OS, build: IS_DEV ? "development" : "release" });

  return (
    <SafeAreaView edges={["top", "bottom"]} style={[styles.fill, { backgroundColor: background }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      {loadError ? (
        <View style={[styles.center, { backgroundColor: background }]}>
          <Problem message={loadError} onRetry={() => { setLoadError(null); web.current?.reload(); }} />
        </View>
      ) : null}
      <WebView
        ref={web}
        style={[styles.fill, { backgroundColor: background }, loadError ? styles.hidden : null]}
        source={{ uri: boot.base + boot.path }}
        originWhitelist={["*"]}
        injectedJavaScriptBeforeContentLoaded={injected}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onMessage={onMessage}
        // The page is laid out for the phone: no bounce, no zoom, no link previews.
        bounces={false}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsLinkPreview={false}
        allowsBackForwardNavigationGestures={false}
        setBuiltInZoomControls={false}
        textZoom={100}
        // Camera and microphone for the daily hello: the system asks first (Info.plist texts),
        // after that the page's getUserMedia is let through without a second, web-style question.
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mediaCapturePermissionGrantType="grant"
        allowsAirPlayForMediaPlayback={false}
        // Storage that survives a restart: the default, persistent website data store.
        incognito={false}
        cacheEnabled
        domStorageEnabled
        webviewDebuggingEnabled={IS_DEV}
        onShouldStartLoadWithRequest={(req) => {
          if (!req.isTopFrame || isInterface(boot.base, req.url)) return true;
          // Phone numbers on the help card, the messages service's links, anything else: the phone's own apps.
          void Linking.openURL(req.url).catch(() => null);
          return false;
        }}
        onOpenWindow={(e) => void Linking.openURL(e.nativeEvent.targetUrl).catch(() => null)}
        onLoadStart={() => {
          loaded.current = false;
        }}
        onLoadEnd={() => {
          loaded.current = true;
          const queued = afterLoad.current.splice(0);
          for (const m of queued) deliver(m);
        }}
        onError={(e) => {
          const where = WEB_SOURCE.kind === "dev-server" ? `the web dev server at ${WEB_SOURCE.url}` : "the bundled interface";
          setLoadError(`Could not open ${where}. ${e.nativeEvent.description ?? ""}`.trim());
        }}
        onContentProcessDidTerminate={() => web.current?.reload()}
      />
    </SafeAreaView>
  );
}

function openedEvent(n: NoticeData, path: string): NativeToWeb {
  return { cheerPressure: PHONE_BRIDGE_VERSION, event: "opened-from-notification", data: { id: n.id, kind: n.kind, path } };
}

function Problem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.problem}>
      <Text style={styles.problemTitle}>Cheer Pressure could not start</Text>
      <Text style={styles.problemText}>{message}</Text>
      {IS_DEV && WEB_SOURCE.kind === "dev-server" ? (
        <Text style={styles.problemText}>Start it with `pnpm dev` at the repository root, or set EXPO_PUBLIC_WEB_URL.</Text>
      ) : null}
      <Pressable accessibilityRole="button" onPress={onRetry} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hidden: { display: "none" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  problem: { paddingHorizontal: 32, gap: 12, alignItems: "center" },
  problemTitle: { fontSize: 18, fontWeight: "600", color: "#2b2620", textAlign: "center" },
  problemText: { fontSize: 15, lineHeight: 21, color: "#5c5348", textAlign: "center" },
  button: { marginTop: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999, backgroundColor: "#2b2620" },
  pressed: { opacity: 0.8 },
  buttonText: { color: "#f6f2ea", fontSize: 16, fontWeight: "600" },
});
