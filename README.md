# Cheer Pressure

A hackathon MVP for Junction 2026, Aalto University challenge "Beyond the Clinic".

Cheer Pressure is a small digital companion for people who have finished treatment and want to stay well at
home. It is passive first: it measures by itself (typing rhythm, first and last activity of
the day) and asks "How are you doing?" only when the person's measures stand out from
their own usual range. Everything stays on the device.

It is a tool, not a therapist. It never diagnoses; it only describes change from the
person's own usual level.

The acceptance bar for this MVP is in [BAR.md](BAR.md).

## Run it

Needs Node 20 or newer and pnpm.

```bash
pnpm install
pnpm dev          # http://localhost:3470
```

Other commands:

```bash
pnpm build        # static export to out/
pnpm lint
pnpm test         # timing calculation, the passive rule, and the Rust tests
```

To try it quickly: finish setup, then open **Your own level** and press **Load demo data**.
That adds six weeks of made-up measurements where the last days drift (more uneven typing,
the whole day shifted later, plus later bedtime, lower form, slower reading and higher
weekly answers in the manual entries). **Simulate a change** loads the same data and makes
the companion ask right away, for showing it live. **Clear demo data** removes only those.
Screens with made-up data say so.

## When the companion asks

`lib/passive.ts` holds the one rule (unit tests in `scripts/test-passive.mts`):

- A measure has **changed** when all of its last 3 sessions or days lie on the same side
  outside the person's own typical range, the 25th to 75th percentile of their earlier sessions or
  days. It needs at least 7 earlier ones, and the last 3 must include the past 7 days.
- When **at least 2** measures have changed, the companion proposes a check-in: a gentle
  cue on the mascot (no sound), and on home. The check-in explains what changed in plain
  words and how many sessions and days it is based on, then asks one question with three
  answers. The answer is stored with the measures that triggered it.
- Until there are **7 days** of data it is still learning and never asks.
- After asking, it waits **3 days**, unless a measure changes that was not part of the
  last check-in.

Measures: typing evenness (spread of the time between key presses), longer pauses (95th
percentile), hold time, first activity, last activity, and quiet night (last activity one day
to first activity the next, an estimate of rest, not measured sleep). A day runs from 04:00
to 04:00. No percentages, no score, no diagnosis words.

The daily and weekly questions are still there, through quiet links ("Tell me how you're
doing", "Weekly questions"); the weekly ones are also offered after the answer "Not my best".

## What is where

| Path | What it is |
| --- | --- |
| `app/` | Screens: `setup`, home (`page.tsx`), `prompt` (the proposed check-in), `live`, `check-in`, `weekly`, `reaction`, `trends`, `share`, `settings`, `help`, and `mascot` (the desktop mascot window) |
| `lib/passive.ts` | The passive measures and the rule that decides when to ask |
| `lib/typing.ts` | Typing rhythm from key timings only (same calculation as the Rust side) |
| `lib/platform.ts` | Desktop app or browser: wraps the desktop app's commands and events |
| `lib/robot.ts` | The robot seam: interface, Web Serial implementation, desktop stub |
| `src-tauri/` | The desktop app (Tauri 2, Rust) |
| `lib/storage.ts` | The only module that touches browser storage (localStorage, one key: `companion.v1`) |
| `lib/types.ts` | The data model |
| `lib/levels.ts` | The person's own baseline and how the last 7 days compare with it |
| `lib/brain.ts` | The companion's "brain": an interface plus a rule-based implementation |
| `lib/crisis.ts` | The fixed list of crisis words. A match shows `components/CrisisCard.tsx` |
| `lib/paceMeter.ts` | Reading pace (words per second) from microphone loudness, on the device |
| `lib/voice.ts` | Read-aloud with the browser's built-in, on-device voices |
| `lib/demo.ts` | The made-up demo data |
| `lib/summary.ts` | The text shown on "Share with my clinic" |
| `styles/tokens.css` | Design tokens: colours, type, spacing, radius. The look lives here |
| `components/companion/` | The character. One component, swappable |

## Data model

All of it is in `localStorage` under `companion.v1`, as one JSON object (see `lib/types.ts`):

- `profile`: when setup was done, and up to three personal early signs.
- `daily[]`: one per day. Bedtime and wake time (`"HH:MM"`), form 1 to 5, reading pace in
  words per second (or `null` if skipped), an optional typed note.
- `weekly[]`: one per date. The two PHQ-2 items (`down`, `interest`), `sleep` and `tense`,
  all on the standard 0 to 3 scale, plus one 0 to 3 answer per early sign.
- `reaction[]`: five reaction times in ms and their median. Marked as an experiment in the UI.
- `typingSessions[]`: one per typing session (ends after 5 minutes without typing, or on
  pause): date, where it was measured (`computer` or `box`), length in seconds, number of
  presses, median interval, spread, 95th percentile pause, median hold. Numbers only.
- `activityDays[]`: first and last key press per day (`"HH:MM"`), from the desktop app.
- `checkIns[]`: each proposed check-in and its answer, which measures triggered it, how
  many sessions and days it was based on, and whether it was simulated.
- `settings`: whether read-aloud is muted, and a running "Simulate a change".

Every entry has `source: "user" | "demo"` so demo data can be cleared on its own.
No raw audio is ever stored: the pace meter keeps one loudness number per 30 ms while
listening and throws even those away once it has the speaking time.

**Baseline.** "Your usual" is the median (and 25th to 75th percentile band) of the person's
own entries from the 8 weeks before the last 7 days. It needs at least 5 entries. The last 7
days are compared with it. Weekly answers compare the newest answer with the earlier ones.

## Where the model plugs in

`lib/brain.ts` defines:

```ts
interface Brain {
  name: string;
  reflect(input: BrainInput): Promise<BrainOutput>; // everything the companion says
  closingLine(kind: "daily" | "weekly", today: string): string;
}
```

`BrainInput` holds the recent daily and weekly entries, the profile, `levels` (the person's
own baseline and the change in the last week, from `lib/levels.ts`) and `passive`: the six
passive measures as plain data (key, label, status, direction, the last three values, the
usual range, how many sessions or days exist) plus `askNow`, `reason`, `learning`,
`daysOfData` and `basedOn` (how many sessions and days a change is based on).

`BrainOutput` has two parts:

- For the person's own entries: one sentence to say (`say`), at most one suggestion
  (`morning-light`, `walk`, `regular-bedtime` or `music`), and whether a change was noticed.
- `passive`: the explanation shown first in the proposed check-in (`explanation`), the calm
  line on home (`calmLine`), the one sentence on "Your own level" (`insight`) and the one small
  thing to try after "Not my best" (`suggestion`).

**Whether to ask is not the brain's decision.** That rule stays in `lib/passive.ts`
(`evaluatePassive`, unit tested): three in a row outside the usual range, at least two
measures, the learning period and the 3-day wait. The brain receives the outcome as
`passive.askNow` and only words it.

`ruleBrain` is the default. It needs no API key and no network, and it produces exactly what
the app showed before the seam existed by calling the pure functions in `lib/passive.ts`
(`explainChange`, `calmLine`, `weeklyInsight`, `suggestionFor`); `pnpm test:passive` checks
that. To use a trained model, write another object that implements `Brain` and change the
last line of `lib/brain.ts`:

```ts
export const brain: Brain = ruleBrain; // swap for your model
```

A replacement can reuse the rules for anything it does not handle:

```ts
const modelBrain: Brain = {
  ...ruleBrain,
  name: "my-model",
  async reflect(input) {
    const base = await ruleBrain.reflect(input);
    const insight = await myModel.describe(input.passive.measures); // your model, on the device
    return { ...base, passive: { ...base.passive, insight } };
  },
};
```

Nothing else in the app has to change. Keep the rules at the top of that file: compare only
with the person's own entries, never diagnose, never guilt. Crisis wording is caught before
the brain is asked anything.

## Changing the look

- Colours, type, spacing and radius: `styles/tokens.css`. Components only read these variables.
- The character: replace `components/companion/Companion.tsx` (and its CSS module) with any
  component that takes `{ state: "idle" | "speaking" | "listening"; size?: number }`.
  The check-in logic does not import anything else from it.

## Privacy

- No backend, no database, no account, no analytics, no fonts or scripts from other origins.
  At runtime the app only requests files from its own origin.
- Reading pace is computed on the device with Web Audio. The browser's SpeechRecognition API
  is not used, because in Chrome it sends audio to a server.
- Read-aloud uses only voices the browser reports as on-device (`localService`). If there is
  none, the companion stays silent and shows its text.
- "Share with my clinic" shows the exact text, and lets the person copy or download it.
  It sends nothing. Typed notes are left out.
- "Delete everything" (in Your data and settings) clears all stored data after one confirmation.

## Desktop app

The desktop app (`src-tauri/`, Tauri 2) wraps the same web UI. It has two windows and a
menu bar icon:

- **main**: the app. Closing it hides it to the menu bar; quit from the menu.
- **mascot**: a small frameless, transparent, always-on-top window in the bottom-right
  corner with only the character (`/mascot/`). Drag it to move it; click it to open the main
  window. It is created without taking focus. It shows a gentle cue when the companion
  would like to ask.
- **Menu bar icon**: Open Cheer Pressure, Pause measuring / Resume measuring, Quit.

### Run and build (macOS)

Needs Rust (stable) and Xcode command line tools, plus the steps in "Run it".

```bash
pnpm dev                # in one terminal: the web UI on port 3470
pnpm desktop:dev        # in another: the app against http://localhost:3470
pnpm desktop:build      # debug build: runs pnpm build, then bundles out/
open "src-tauri/target/debug/bundle/macos/Cheer Pressure.app"
```

`pnpm desktop:dev` does **not** start the web server itself (`beforeDevCommand` is empty);
it expects `pnpm dev` to be running already on 3470.

### Typing rhythm across the whole computer

A listen-only keyboard event tap (`src-tauri/src/listener.rs`) sees that *a* key went down
or up anywhere on the computer. It cannot change or block input.

- **Captured:** the moment of each key down and key up (the app's own clock), whether a
  key-down is the keyboard's auto-repeat (repeats are not counted as presses), and the
  time of day of the first and last key press per day, to the minute.
- **Never captured:** which key, the character, the modifiers (Shift, Cmd and so on are not
  even subscribed to), the app or window you type in, any text. The callback does not read
  the key code field at all.
- **Computed** (`src-tauri/src/rhythm.rs`): per 60 s live window and per session: presses,
  median interval, spread (interquartile range), 95th percentile pause, median hold. Gaps
  over 5 s are left out. Because the key is unknown, a release is paired with the oldest
  press still down; with overlapping keys in another order that is an approximation.
- **Kept:** session summaries and first and last activity, in `rhythm.json` in the app's
  data folder (`~/Library/Application Support/fi.junction.cheerpressure/`) until the UI has
  stored them, then in the UI's local storage. "Delete everything" clears both.
- **Sent anywhere:** nothing. No network calls.

macOS asks for **Input Monitoring** (System Settings, Privacy & Security, Input
Monitoring). Without it the app does not crash: Live view says "Permission needed", has a
button that opens that pane, and measures only in its own text box instead. After allowing
it, the app picks it up within a few seconds, or after a restart. When running with
`pnpm desktop:dev`, macOS may attribute the permission to the terminal app that started it
rather than to Cheer Pressure.

Windows and Linux compile in principle (the listener reports "unsupported" there and the UI
falls back to the box); they are not tested.

### What was verified and what was not

- Verified by the builder: `pnpm build`, `pnpm lint`, `cargo check`, `cargo test` (timing
  aggregation and storage), `pnpm test:typing` and `pnpm test:passive`, `pnpm desktop:build`
  produces the app bundle, and one 10 second smoke launch of the debug app: both windows
  loaded their page and their script reached the Rust side (the app logged "page ready" for
  `main` and `mascot`), then it was quit. How the windows looked was not checked. The web screens were driven in a headless browser at 390 and 1366 px.
- **Not verified:** the system-wide capture itself (needs the Input Monitoring permission
  and a person typing), the permission flow, dragging and clicking the mascot, the menu bar
  items, hide on close, the mascot cue in the real window, Web Serial with a real robot,
  Windows and Linux.

## Phone

`pnpm build` writes a fully static site to `out/`, and the app has a web app manifest
(`app/manifest.ts`, icons in `public/icons/`) so it can be added to a phone's home screen.
There is no service worker yet. `scripts/make-icons.mjs` redraws the placeholder icons and
the menu bar icon.

## Not built (on purpose, for now)

- Voice answers. Questions can be read aloud; answers are always tapped or typed.
- A trained model. The rule-based brain is the default (see above).
- Any sync, backup, account or server. Clearing the browser's site data deletes everything.
- Sending anything to a clinic. Sharing is copy or download only.
- The clinic's real contact details. The help screen has a marked placeholder.
- Reminders or notifications.
- Offline caching (no service worker).
- Camera, microphone and bedside sensor views (the macOS usage texts are in place).
- The contact request ("I'd like someone to check in on me" shows a marked placeholder).
- A serial port for the robot inside the desktop app (marked TODO in `lib/robot.ts`).
- The character's final look.
- Translations. The UI is English only.
- Clinical validation of any threshold. The change thresholds in `lib/levels.ts` are first guesses.

## Notes

- The weekly questions use the PHQ-2 items and answer scale, but ask about "the last week"
  instead of the standard two weeks, to match the weekly rhythm.

## Licence

MIT, see [LICENSE](LICENSE).
