# Cheer Pressure on the phone

The phone app is a thin shell: one full-screen WebView showing the same web interface as the
browser and the desktop app (the static export in the repository's `out/`), and a native bridge for
what a web page cannot do. No screen is rebuilt in React Native.

- Expo SDK 57 (`expo` ~57.0.33), React Native 0.86.3, React 19.2.3, TypeScript 6.0
- `react-native-webview` 13.16.1, `expo-notifications` 57, `@kingstinct/react-native-healthkit` 16.2 (Nitro)
- a local Expo module, `modules/cheer-native` (Swift): the bundled interface's server, camera and
  microphone permissions, the audio session
- iPhone first (iOS 16.4 and later), portrait, light and dark. Bundle identifier `app.cheerpressure.mobile`.

## Layout

| Path | What it is |
|---|---|
| `App.tsx` | The WebView: where the interface comes from, safe areas, status bar, notifications opening a screen, the app going to the background |
| `src/protocol.ts` | The bridge's messages, byte for byte the same block as `lib/phone.ts` (the web side, which is the contract); `scripts/test-phone.mts` checks they match |
| `src/bridge.ts` | Takes the page's requests, does them, answers |
| `src/inject.ts` | What runs in the page before its own code: "this is the phone app", the message queue, no zoom, sound tracking, the page's colour |
| `src/health/` | Sleep and steps from Apple Health (`healthkit.ts`), reduced to one record per night (`nights.ts`) and one number per day; the Android stub (`index.ts`); the made-up weeks (`demoWeeks.ts`) |
| `src/notifications.ts` | Local notifications: the daily hello and "Cheri would like a word" |
| `src/navigation.ts` | Which screen a notification opens (home when the screen is not there) |
| `src/devTools.ts` | Development builds only: add or remove the made-up weeks |
| `modules/cheer-native/` | The native module; `ios/web/` is filled by `scripts/copy-web.mjs` and not committed |
| `plugins/local-notifications-only.js` | Drops the push entitlement (all notifications are local) |

## Prerequisites

- macOS with Xcode (built with Xcode 27.1) and an iOS simulator runtime, CocoaPods, Node 22
- `npm install` in `mobile/` (this folder has its own `package-lock.json`; the web side uses pnpm at the root)
- for a release build or the bundled interface: `pnpm install` and `pnpm build` at the root, which writes `out/`

## Run it in the simulator (development)

```sh
# at the repository root: the web interface, served on 3470
pnpm dev --port 3470

# in mobile/
npm install
npm run web:copy                 # copies ../out into the app (needed for a release build; harmless here)
npx expo prebuild --platform ios # writes ios/ (generated, not committed)
npx expo run:ios                 # builds, installs and opens it in a simulator, starts Metro
```

The development build loads the web dev server: `EXPO_PUBLIC_WEB_URL` if set when Metro starts,
else `http://localhost:3470`. Edits to the web interface show after a reload of the page.
`EXPO_PUBLIC_WEB_URL=bundle npx expo start --dev-client` makes the development build use the
bundled interface instead.

From a clean checkout, `npx expo prebuild --clean` regenerates `ios/` at any time. Run
`npm run web:copy` before it at least once; without it the build has an empty `web/` folder and
a release build says the interface is missing.

### The made-up weeks (development builds only)

"Add eight made-up weeks to Health" writes 56 nights of sleep and 56 days of steps into the
simulator's Health, marked as this app's made-up samples: seven ordinary weeks and a last week with
later, shorter nights and fewer steps, so Sleep and Energy both change and Cheri would ask.
"Remove them" deletes exactly those samples and nothing else. Three ways in:

- the developer menu (the floating gear, or Ctrl-Cmd-Z): "Add eight made-up weeks to Health", "Remove them"
- a link: `xcrun simctl openurl booted "cheerpressure://dev/demo-health?action=add"` (or `action=remove`)
- the page, through the bridge: `demoHealth("add")` in `lib/phone.ts`

Release builds register none of it, and the bridge refuses `demoHealth` there. The page shows them
as made-up data (its demo banner).

Three more development-only links, for trying things from a script without tapping:

```sh
xcrun simctl openurl booted "cheerpressure://dev/open?path=/values/"       # open a screen
xcrun simctl openurl booted "cheerpressure://dev/notify?kind=word&in=15"   # a notification in 15 s (leave the app to see it)
xcrun simctl openurl booted "cheerpressure://dev/ask?kind=health"          # one permission question, as the page asks it
```

Health remembers its answer per app even after the app is deleted from the simulator; to see
Health's sheet again, delete the app and install it again (`xcrun simctl uninstall booted app.cheerpressure.mobile`).

## Release build (the bundled interface)

```sh
npm run web:copy -- --build      # pnpm build at the root, then copy out/ into the app
npx expo run:ios --configuration Release
```

Build `out/` from the code you want in the app: the copy is a snapshot, and an old `out/` gives
an old interface (no phone sleep and steps on Home, for one). The release build carries the static export inside the app and serves it from a small server in
the native module on `http://127.0.0.1:41473`, listening on the loopback address only. Not
`file://`, because the export breaks there in three ways: its files are linked from the root
(`/_next/static/...`, which from `file://` is the root of the phone's disk), its pages are
folders with trailing slashes (`/settings/` is `settings/index.html`), and the router fetches
`/settings/index.txt` on a tap. A fixed port also keeps the page's origin, and with it
localStorage, the same on every launch, and an http origin on 127.0.0.1 counts as a secure
context, which the camera and microphone need. The server answers byte ranges (audio), sends
`/settings` on to `/settings/`, and shows the export's own 404 page for anything missing.

## Sound

Sound from the page plays even when the ring/silent switch is on silent: the person opened
Cheri on purpose, and her voice is the point of the daily hello. It mixes with music already
playing rather than stopping it. When the app goes to the background every sound in the page is
paused (audio and video elements, Web Audio, speech) and picked up again when it comes back; the
app has no background audio, so iOS would stop it soon anyway. Timers in activities need nothing
native: they are computed from a saved end time.

## Camera and microphone

Only inside the WebView, through the page's own `getUserMedia`. The first time, iOS asks with the
texts in `app.json` ("...during your daily hello with Cheri. Worked out on this phone; nothing is
recorded or sent."); after that the page is let through without a second, web-style question.
The bridge's `requestPermission("camera-microphone")` asks for both up front, for onboarding.

## Health

Read only: sleep analysis and step count, the last 56 days, reduced on the phone. Health never
tells an app whether reading was allowed, so the state after asking is "asked", and a person who
said no simply has no nights. The values go into the page's own storage on this phone and nowhere
else. Development builds also ask to write, for the made-up weeks; release builds ask to read only.

## Notifications

All local, no push server. The page plans them (`lib/phone.ts`: the chosen time and days, out of
quiet hours, never twice a day, never made up for a missed day, nothing while paused) and the app
schedules exactly that plan, replacing the one before; the plan is made again whenever the app is
opened or left and when Settings change. A tap opens `/hello/` (the daily hello) or `/prompt/`
("Cheri would like a word"), or home when that screen is not in the interface.

## On your own iPhone

1. Plug the iPhone in with a cable, unlock it, and tap Trust. On the iPhone, turn on Developer Mode
   (Settings, Privacy & Security, Developer Mode) and restart when asked.
2. `npm run web:copy -- --build`, then `npx expo prebuild --platform ios`.
3. Open `ios/CheerPressure.xcworkspace` in Xcode. Select the CheerPressure project, then the
   CheerPressure target, then Signing & Capabilities:
   - tick "Automatically manage signing" and choose your Team (a free Apple ID works as a
     Personal Team; add it under Xcode, Settings, Accounts);
   - if Xcode says the bundle identifier is taken, change `app.cheerpressure.mobile` to something
     of your own (also in `app.json`, so the next prebuild keeps it);
   - check that HealthKit is listed under the capabilities (it comes from `app.json`; if it is
     missing, click "+ Capability" and add HealthKit).
4. Choose your iPhone at the top of the window, set the scheme's Run configuration to Release
   (Product, Scheme, Edit Scheme, Run, Build Configuration) so it carries the interface and needs
   no Metro, and press Run.
5. The first time, the iPhone refuses to open an app from an unknown developer: Settings, General,
   VPN & Device Management, your Apple ID, Trust.

With a free Personal Team the app stops opening after seven days; run it again from Xcode. For a
development build on the phone instead (the dev server on your Mac), use the Debug configuration
and set `EXPO_PUBLIC_WEB_URL` to your Mac's address on the same Wi-Fi, for example
`http://192.168.1.20:3470`, then start the web dev server with `--hostname 0.0.0.0`.

## Android

Not built yet. The JavaScript runs there, but: the bundled interface's server is iOS only (the
release build shows that the interface is missing), sleep and steps say "not available yet"
(Health Connect is the place for them), and camera and microphone permissions are not wired.
Local notifications would work through expo-notifications as they are.

## Not built

- Android (above), location ("at home or out" answers not-available), background reading of Health
- push notifications of any kind; everything is local
- speech in and out and the conversation engine (see below if it has been added since)
