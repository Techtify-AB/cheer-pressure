// Development builds only: the made-up weeks, so Sleep and Energy can be tried in the simulator.
// Two ways in: the developer menu (shake, or Ctrl-Cmd-Z in the simulator) and a link, which a
// script can open:
//   xcrun simctl openurl booted "cheerpressure://dev/demo-health?action=add"
//   xcrun simctl openurl booted "cheerpressure://dev/demo-health?action=remove"
// The page itself can also ask through the bridge (lib/phone.ts demoHealth). Release builds never
// register any of this, and the bridge refuses demoHealth there.
//
// Also for trying things from a script: open a screen without tapping your way there.
//   xcrun simctl openurl booted "cheerpressure://dev/open?path=/values/"
// And a notification in a few seconds, through the same scheduling as the page's plan, to try
// that it fires and that a tap opens its screen (leave the app first to see the banner):
//   xcrun simctl openurl booted "cheerpressure://dev/notify?kind=word&in=15"
// And one permission question, as the page would ask it (the bridge's requestPermission):
//   xcrun simctl openurl booted "cheerpressure://dev/ask?kind=health"

import { Alert, Linking } from "react-native";
import { IS_DEV } from "./config";
import * as health from "./health";
import { notificationState, requestNotifications, scheduleAt } from "./notifications";

async function notifySoon(kind: "hello" | "word", seconds: number) {
  if ((await notificationState()) === "not-asked") await requestNotifications();
  if ((await notificationState()) !== "granted") {
    Alert.alert("Notifications are off", "Allow notifications for Cheer Pressure first.");
    return;
  }
  try {
    const at = new Date(Date.now() + seconds * 1000).toISOString();
    const notice =
      kind === "word"
        ? { id: "dev-word", kind, at, title: "Cheri would like a word", body: "A few things look different from your usual. Have a look when you have a moment.", path: "/prompt/" }
        : { id: "dev-hello", kind, at, title: "A hello from Cheri", body: "How are you today? A few seconds is enough.", path: "/hello/" };
    // Next to the page's plan, which leaves "dev-" notices alone.
    await scheduleAt(notice);
    Alert.alert("Notification scheduled", `In ${seconds} seconds. Leave the app to see it.`);
  } catch (e) {
    Alert.alert("That did not work", e instanceof Error ? e.message : String(e));
  }
}

async function run(action: "add" | "remove", reload: () => void) {
  try {
    const r = await health.demoHealth(action);
    reload();
    Alert.alert(
      action === "add" ? "Made-up weeks added" : "Made-up weeks removed",
      action === "add" ? `${r.nights} nights and ${r.days} days of steps are in Health now.` : `${r.nights} nights and ${r.days} days of steps were taken out of Health.`,
    );
  } catch (e) {
    Alert.alert("That did not work", e instanceof Error ? e.message : String(e));
  }
}

/** Registers the menu items and the link. Returns a function that stops listening to the link. */
export function registerDevTools(reload: () => void, open: (path: string) => void, ask: (kind: string) => Promise<string>): () => void {
  if (!IS_DEV) return () => {};
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const menu = require("expo-dev-menu") as typeof import("expo-dev-menu");
  void menu
    .registerDevMenuItems([
      { name: "Add eight made-up weeks to Health", callback: () => void run("add", reload), shouldCollapse: true },
      { name: "Remove them", callback: () => void run("remove", reload), shouldCollapse: true },
    ])
    .catch(() => null);
  const onUrl = (url: string | null) => {
    if (!url) return;
    const m = url.match(/^cheerpressure:\/\/dev\/demo-health\?action=(add|remove)/);
    if (m) void run(m[1] as "add" | "remove", reload);
    const o = url.match(/^cheerpressure:\/\/dev\/open\?path=(\/[^#]*)$/);
    if (o) open(decodeURIComponent(o[1]));
    const n = url.match(/^cheerpressure:\/\/dev\/notify\?kind=(hello|word)&in=(\d+)/);
    if (n) void notifySoon(n[1] as "hello" | "word", Number(n[2]));
    const a = url.match(/^cheerpressure:\/\/dev\/ask\?kind=([a-z-]+)/);
    if (a) void ask(a[1]).then((state) => Alert.alert("Asked", `${a[1]}: ${state}`));
  };
  void Linking.getInitialURL().then(onUrl);
  const sub = Linking.addEventListener("url", (e) => onUrl(e.url));
  return () => sub.remove();
}
