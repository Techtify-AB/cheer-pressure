# Cheer Pressure

A hackathon MVP for Junction 2026, Aalto University challenge "Beyond the Clinic".

Cheer Pressure is a small digital companion for people who have finished treatment and want to stay well at
home. It is passive first: it measures by itself (typing rhythm, first and last activity of
the day) and asks "How are you doing?" only when the person's measures stand out from
their own usual range. Measurements, answers and summaries never leave this device. The one
exception is short messages between the person and one person they trust (a sister, a friend):
those pass through a small messages service (`server/`), which deletes them after 48 hours and
never receives anything about health.

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
pnpm test         # timing calculation, the passive rule, the ladder, the contact adapter, the Rust tests
pnpm test:e2e     # someone you trust, end to end in a headless browser (starts and stops its own servers)
node scripts/check-fit.mjs http://localhost:3472   # every screen fits, against a static build served on 3472
```

To try it quickly: finish setup, then open **Settings**, **For the demo**, and press
**Six weeks in 20 seconds**, or **Simulate a change** to see the companion ask and walk the
ladder (with **Skip ahead two days**). While any made-up data is stored, a calm banner in the
header says so on every screen, with a link that clears it.

## Three places, the ladder and the replay

The interface has three places. **Home** is the companion, one calm line and one row,
"What I'm noticing", that opens the details. "Talk to me" starts the **conversation** when the
person wants to; when the measures stand out, the companion looks attentive and home offers
"Have a look" instead. **Settings** is a short list: what is measured (each source on or off,
Pause everything), which small things it may suggest and quiet hours (22:00 to 08:00 by
default, when it never speaks up), voice, someone you trust, your data,
need help now, and **For the demo**, the one marked place for the live view, your own level,
demo data and the replay.

After "Not my best" the ladder (`lib/ladder.ts`, one pure function, tested in
`scripts/test-ladder.mts`) offers one step at a time: one small thing from the routines that
are on, then after two days "Would you like someone you trust to check in on you?", then after
seven days a short summary for the clinic, shown word for word before anything is approved.
It escalates only while the measures still stand out the way the rule asks about, respects "Not now" for three
days, and stays quiet in quiet hours. "I'd like someone to check in on me" goes straight to the
second step. Reaching someone goes through `lib/contact.ts`: when a pair exists it sends a real
request through the messages service (see below); without one it sends nothing, and only in
demo mode shows a reply marked as simulated.

## Someone you trust

**Settings, Someone you trust**, one step per screen: "Invite someone" creates a pair on the
messages service and shows a QR code (drawn on the device by the bundled `qrcode` package) and a
link to copy. It says "Invite created, waiting for them to open it" until the trusted person has
opened it on their phone and typed a first name, then "Connected with Sara". A quieter step,
"Your own phone", shows a second link so the person can answer from their phone too.
"Disconnect" asks once, then deletes the pair on the service and the messages on this device;
"Delete everything" does the same.

- **Ladder step two** ("Would you like someone you trust to check in on you?", Yes) sends a
  contact request. The screen shows "Sending", "Sent" or "Waiting for connection" from the local
  outbox, so it works offline and goes by itself when the service is back. When the trusted
  person sends something, it shows there with Yes, No and Write back.
- **Greetings at any time.** The app follows the pair once, at app level, while a pair exists
  (`components/TrustedBridge.tsx`, `lib/trusted.ts`; polling every 1.5 s, and in the desktop app
  also while the main window is hidden). A greeting or question becomes home's one primary thing
  ("Sara: Walk after lunch?" with Yes, No and Write back), the companion looks glad, the mascot
  window shows its cue and a click opens home, and a robot connected under Live view gets
  `{"t":"led","mode":"greeting","color":"warm","ms":4000}`. Outside quiet hours the companion
  reads it aloud once (unless the voice is off or everything is paused); in quiet hours it is
  still shown, silently. After the answer home is calm again. Only the newest unanswered
  message is ever shown; there is no conversation history in the interface.
- **Crisis words in a written answer** show the fixed help card, and the message is still sent:
  it is the person's own message to someone they chose to trust.
- **Where the service is:** For the demo, Messages service. Default `NEXT_PUBLIC_MESSAGES_URL`
  from the build, else `http://localhost:3480`. For a table demo on a phone hotspot see
  `server/README.md`.

**Six weeks in 20 seconds** (`/demo/replay/`) replays made-up days (`lib/replay.ts`): five
steady weeks, then a drift in which sleep slips first (the day starts and ends later, quickly)
and typing follows gradually (evenness, longer pauses). With the default days it stops on day
38 of 42, on typing evenness and first activity. Each day it runs the real rule on the data up to that day and shows four measures
against their usual band. It stops when the rule would ask, with the same explanation the
conversation shows, and "See what it asks" opens the conversation on those days. A test checks
that the rule does not ask during the steady weeks.

`node scripts/check-fit.mjs [url]` walks every screen headless at 1366x768, 390x844 and
520x820 and checks that nothing scrolls, there is at most one primary action and at most four
groups, including the screens for someone you trust (against a fake service inside the
browser). `pnpm test:e2e` plays the whole story with the real service: the desktop invites, a
390 x 844 phone joins as Sara and sends "Walk after lunch?", the desktop shows it, answers Yes and
the phone shows "They said yes"; then the service is stopped, the desktop's request shows
"Waiting for connection", and it is delivered when the service is back.

## When the companion asks

`lib/passive.ts` holds the one rule (unit tests in `scripts/test-passive.mts`):

- A measure has **changed** when all of its last 3 sessions or days lie on the same side
  outside the person's own typical range, the 10th to 90th percentile of their earlier sessions or
  days. It needs at least 7 earlier ones, and the last 3 must include the past 7 days.
- The measures belong to **sources** (one table, `SOURCES` in `lib/passive.ts`): **typing**
  (evenness, longer pauses, hold time) and **day and night rhythm** (first activity, last
  activity, quiet night; an estimate of rest, never measured sleep). The companion proposes a
  check-in when measures have changed in **two different sources**, or when **at least two day
  and night measures** have changed even if nothing else has. **Typing alone never asks**,
  however many typing measures changed; "Your own level" under the demo still shows it, and
  says so. The ladder's "the measures have come back" uses the same test.
- Measured with `npx tsx scripts/measure-rule.mts` on 400 made-up five-week periods, steady
  and then drifting in week six: this rule asks by chance in 16 of 400 and notices the drift in
  400 of 400 (on average on day 38.4). The variants it was chosen from: at least 2 measures of
  any kind (the earlier rule) 18 of 400, two different sources only 4 of 400, one day and night
  measure alone 178 of 400 (far too noisy); all of them noticed the drift.
- When it asks: a gentle cue on the mascot (no sound), and on home. The check-in explains what changed in plain
  words and how many sessions and days it is based on, then asks one question with three
  answers. The answer is stored with the measures that triggered it.
- Until there are **7 days** of data it is still learning and never asks.
- After asking, it waits **3 days**, unless a measure changes that was not part of the
  last check-in.

Measures: typing evenness (spread of the time between key presses), longer pauses (95th
percentile), hold time, first activity, last activity, and quiet night (last activity one day
to first activity the next, an estimate of rest, not measured sleep). A day runs from 04:00
to 04:00. No percentages, no score, no diagnosis words.

The weekly questions are offered only inside the conversation, after "Not my best". The
manual daily check-in, the reaction test and the share page are gone; their stored entries
still load.

## What is where

| Path | What it is |
| --- | --- |
| `app/` | Screens: `setup`, home (`page.tsx`), `prompt` (the conversation and the ladder), `settings`, `help`, `weekly` (only from the conversation), `demo` (with `demo/replay`, `live` and `trends` reached from it), and `mascot` (the desktop mascot window) |
| `lib/ladder.ts` | Which step is due after "Not my best", and the clinic text |
| `lib/settings.ts` | Sources, routines and quiet hours, with their defaults |
| `lib/contact.ts` | Reaching someone you trust: the real contact on top of `lib/messages.ts`, the stand-in for demo mode without a pair, and which message home shows |
| `lib/trusted.ts` | The app's one messages client, followed once while a pair exists, and the hook screens read it through |
| `lib/messages.ts`, `lib/events.ts` | The local-first messages client and the event types (byte-for-byte copies in `server/lib/`) |
| `components/Greeting.tsx` | "Sara: Walk after lunch?" with Yes, No and Write back, on home and in the ladder |
| `components/TrustedBridge.tsx` | Follows the pair at app level; robot line and read-aloud when a greeting arrives |
| `components/LinkCode.tsx` | A link as a QR code made on the device, with Copy |
| `server/` | The messages service and the two phone pages (its own package, see `server/README.md`) |
| `lib/replay.ts` | The made-up six weeks for the replay, run through the real rule |
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
| `lib/voice.ts` | Read-aloud with the browser's built-in, on-device voices |
| `lib/demo.ts` | The made-up demo data |
| `lib/summary.ts` | The old "Share with my clinic" text, no longer shown (the clinic text is in `lib/ladder.ts`) |
| `styles/tokens.css` | Design tokens: colours, type, spacing, radius. The look lives here |
| `components/companion/` | The character. One component, swappable |
| `components/Screen.tsx` | The layout every screen uses: the lead (answer or question first), the content, the actions; plus the step count, the pager and the one disclosure sheet |

## Data model

The person's own data is in `localStorage` under `companion.v1`, as one JSON object (see
`lib/types.ts`). It never leaves the device:

- `profile`: when setup was done, and up to three personal early signs.
- `daily[]`: one per day, from an earlier version's daily check-in (no longer shown). Bedtime and wake time (`"HH:MM"`), form 1 to 5, reading pace in
  words per second (or `null` if skipped), an optional typed note.
- `weekly[]`: one per date. The two PHQ-2 items (`down`, `interest`), `sleep` and `tense`,
  all on the standard 0 to 3 scale, plus one 0 to 3 answer per early sign.
- `reaction[]`: five reaction times in ms and their median, from an earlier version (no longer shown).
- `typingSessions[]`: one per typing session (ends after 5 minutes without typing, or on
  pause): date, where it was measured (`computer` or `box`), length in seconds, number of
  presses, median interval, spread, 95th percentile pause, median hold. Numbers only.
- `activityDays[]`: first and last key press per day (`"HH:MM"`), from the desktop app.
- `checkIns[]`: each proposed check-in and its answer, which measures triggered it, how
  many sessions and days it was based on, and whether it was simulated.
- `settings`: whether read-aloud is muted, a running "Simulate a change", sources, small
  things, quiet hours, and `messagesUrl`, where the messages service lives.
- `ladder`: the steps after "Not my best" and the answers to them.

The messages with someone you trust are kept apart, under `cheerpressure.messages.v1`
(`lib/messages.ts`): the pair code and this device's token, the invite links, the trusted
person's first name, the most recent messages (at most 200) and the outbox of messages not
yet confirmed. Disconnect and Delete everything remove that key.

Every entry has `source: "user" | "demo"` so demo data can be cleared on its own.
No audio is recorded or stored.

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
  That includes the glass look: the soft backdrop shapes, the frosted surfaces (kept 80 to 88
  percent opaque so text stays readable) and their blur. With `prefers-reduced-transparency`, or
  where `backdrop-filter` is not supported, the surfaces are solid.
- Every screen fits one view with no page scrolling, at 390 by 844, 1366 by 768 and in the
  desktop window: one question or decision per screen, long content paged one item at a time,
  and details behind one "Show how this is worked out" style control.
- The character: replace `components/companion/Companion.tsx` (and its CSS module) with any
  component that takes `{ state: "idle" | "speaking" | "listening"; size?: number }`.
  The check-in logic does not import anything else from it.

## Privacy

- Measurements, answers and summaries never leave this device. No account, no analytics, no
  fonts or scripts from other origins.
- The one thing that does leave it: short messages between the person and the one person they
  trust (a request to get in touch, greetings, questions and replies, at most 280 characters,
  and the trusted person's first name). They pass through the messages service, which deletes
  them 48 hours after the pair was created, or at once on Disconnect. The service never receives
  measurements, check-in or weekly answers, the clinic text, the person's name or anything
  about health. Until a pair exists, the app requests nothing from any other origin.
- QR codes are made on the device; the links are not sent to any other service to draw them.
- Read-aloud uses only voices the browser reports as on-device (`localService`). If there is
  none, the companion stays silent and shows its text.
- The clinic step shows the exact text before anything is approved, and sends nothing: approving
  marks a demo recipient.
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
- **Sent anywhere:** nothing. The listener makes no network calls.

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
- Someone you trust: the chain was driven headless against the real service (`pnpm test:e2e`).
  **Not verified:** the desktop app talking to the service (the connect-src rule, macOS's
  local network prompt, polling while the main window is hidden), and a real phone on a
  hotspot.

## Phone

`pnpm build` writes a fully static site to `out/`, and the app has a web app manifest
(`app/manifest.ts`, icons in `public/icons/`) so it can be added to a phone's home screen.
There is no service worker yet. `scripts/make-icons.mjs` redraws the placeholder icons and
the menu bar icon.

## Not built (on purpose, for now)

- Voice answers. Questions can be read aloud; answers are always tapped or typed.
- A trained model. The rule-based brain is the default (see above).
- Any sync, backup or account. Clearing the browser's site data deletes everything. The only
  server is the messages service for someone you trust.
- Sending anything to a clinic. The clinic step shows the text and marks a demo recipient.
- The clinic's real contact details. The help screen has a marked placeholder.
- Reminders or notifications. Greetings arrive by polling every 1.5 s while the app runs.
- More than one trusted person, or a conversation history in the interface.
- Offline caching (no service worker).
- Camera, microphone and bedside sensor views (the macOS usage texts are in place).
- A serial port for the robot inside the desktop app (marked TODO in `lib/robot.ts`). The
  greeting light reaches a robot connected over Web Serial in Chrome; in the desktop app
  nothing is sent to a robot.
- The character's final look.
- Translations. The UI is English only.
- Clinical validation of any threshold. The change thresholds in `lib/levels.ts` are first guesses.

## Notes

- The weekly questions use the PHQ-2 items and answer scale, but ask about "the last week"
  instead of the standard two weeks, to match the weekly rhythm.

## Licence

MIT, see [LICENSE](LICENSE).
