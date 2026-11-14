# Cheer Pressure

A hackathon MVP for Junction 2026, Aalto University challenge "Beyond the Clinic".

Cheer Pressure is a small digital companion for people who have finished treatment and want to stay well at
home. It is passive first: it measures by itself (typing rhythm, first and last activity of
the day) and asks "How are you doing?" only when the person's measures stand out from
their own usual range. Measurements, answers and summaries never leave this device. The one
exception is short messages between the person and one person they trust (a sister, a friend):
those pass through a small messages service (`server/`), which deletes them after 48 hours and
never receives anything about health.

The companion is called **Cheri** in the interface (the product stays Cheer Pressure). It is a tool, not a therapist. It never diagnoses; it only describes change from the
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
**Eight weeks in 20 seconds**, or **Simulate a change** to see the companion ask and walk the
ladder (with **Skip ahead two days**). While any made-up data is stored, a calm banner in the
header says so on every screen, with a link that clears it.

## Three places, the ladder and the replay

The interface has three places. **Home** is the companion, one calm line and "What I'm
noticing": the four categories, Sleep, Energy, Social and Mood, each with one short line (for
example "Estimated from this computer", "Your daily answer", "Stands out since Tue 10 Nov");
each opens its view in **My values**. Once a day (or as often as the person sets under
Settings, Daily question: off, every day, every other day, twice or once a week; morning,
midday or evening) Cheri asks **"How are you today?"** with three answers, "Good", "Okay" and
"Not so good": on Home as its one thing, and in the desktop app as a bubble from the mascot
window, which grows to hold it without taking focus and shrinks back. One tap answers and
closes it; "Not now" closes it with no reminder that day. Never in quiet hours; a time that
passed while the computer was off brings it once when the person is next there that day, never
stacked (`lib/daily.ts`, tested in `scripts/test-daily.mts`). "Not so good" shows one gentle
line and the quiet "Talk to me"; it does not start the ladder by itself. "Talk to me" starts the **conversation** when the
person wants to; when the measures stand out, the companion looks attentive and home offers
"Have a look" instead. **Settings** is a short list: what is measured (by category, one switch per input,
Pause everything), which small things it may suggest and quiet hours (22:00 to 08:00 by
default, when it never speaks up), voice, someone you trust, My values, your data,
need help now, and **For the demo**, the one marked place for the live view, demo data, the
replay, the messages service address and "What a clinic could see".

## My values and the clinic report

**My values** (`/values/`, `lib/report.ts`) opens on one sentence and how many of the four
categories stand out, then one category per view, with its inputs that are off or not
connected yet in one quiet line: each measure as a strip of daily dots over the last eight weeks
against the person's own usual band, the last week's middle and the usual range with a plain
meaning next to them, and "Stands out since <date>" where the rule says so. It replaced the
older "Your own level" screen.

**Share with my clinic** (`/share/`, from My values and from the ladder's third step) shows the
exact report first, one part at a time, then "Save as PDF or print" (the browser's print dialog,
or the desktop app's own through a `print_page` command) or "Not now". The printed report is
one A4 page (`@media print` in `app/globals.css`): the period (eight weeks), per category what
changed, which way, since when, against the person's own usual; how many days it rests on,
including days with too little typing; the person's answers to Cheri with dates and PHQ-2
totals; the ladder's steps and whether the values came back; what each value is and is not;
and "A prototype. Not a diagnosis and not for clinical decisions on its own." It is written in
the first person. No raw events, no app names, no typed text except answers to Cheri. Nothing is
sent: there is no clinic integration, and the messages service never receives it. In the
ladder, with demo data, "Approve for the demo clinic" shows "Marked as a demo recipient.
Nothing was sent." `scripts/test-report.mts` checks that every number in it is one My values
shows, a count of days or a date, that the dates are right, and the empty states.

**What a clinic could see** (`/demo/clinic/`, demo only, marked simulated): eight made-up
people who chose to share, from the replay's generator with drifts that began on different
days, in an order of who to look at first (how many days in a row and how many sources stand
out). No scores, no percentages; one line says the order decides nothing.

After "Not my best" the ladder (`lib/ladder.ts`, one pure function, tested in
`scripts/test-ladder.mts`) offers one step at a time: one small thing from the routines that
are on, then after two days "Would you like someone you trust to check in on you?", then after
seven days "Would you like your clinic to get a short summary?", which opens Share with my clinic.
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
  window shows its cue and a click opens home. Outside quiet hours the companion
  reads it aloud once (unless the voice is off or everything is paused); in quiet hours it is
  still shown, silently. After the answer home is calm again. Only the newest unanswered
  message is ever shown; there is no conversation history in the interface.
- **Crisis words in a written answer** show the fixed help card, and the message is still sent:
  it is the person's own message to someone they chose to trust.
- **Where the service is:** For the demo, Messages service. Default `NEXT_PUBLIC_MESSAGES_URL`
  from the build, else `http://localhost:3480`. For a table demo on a phone hotspot see
  `server/README.md`.

**Eight weeks in 20 seconds** (`/demo/replay/`) replays made-up days (`lib/replay.ts`): six
steady weeks, then a drift in which sleep slips first (the day starts and ends later, quickly)
and typing follows gradually (evenness, hold time). Eight weeks, because a 14-day learning
period, a 28-day usual and a clear week of change do not fit in six with any margin. It is
placed so that the day it asks is today; depending on the weekday it stops on day 46 to 48 of
56 (about 17 seconds in), for example on typing evenness and last activity. Each day it runs the real rule on the data up to that day and shows four measures
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

`lib/passive.ts` holds the one rule (unit tests in `scripts/test-passive.mts`).

**Four categories, everywhere the person looks:** Sleep, Energy, Social and Mood. `SOURCES` in
`lib/passive.ts` is one table: category, then its inputs, then their measures. Each input is
measuring, off, or "not connected yet" (`lib/categories.ts`).

| Category | Inputs today | Not connected yet |
| --- | --- | --- |
| Sleep | an estimate from the first and last key press each day (first activity, last activity, estimated rest); a watch or phone would give real sleep | phone app, watch or band (Fitbit, Apple Health, Health Connect), the companion at the bedside |
| Energy | typing rhythm (evenness, hold time), the camera (movement, position changes), the microphone (pace of the voice) | |
| Social | messages with the person you trust, per day (how many, never what they say) | talking with someone, at home or out |
| Mood | the person's own daily answer (Good, Okay, Not so good), its anchor; with the camera, face movement and raised mouth corners, posture; with the microphone, how much the pitch moves | |

**One value per measure per day.** Typing is pooled over the day's counted bursts of real
writing (below), only on days with at least 300 counted presses; movement on days with at least
20 minutes in frame; messages on every day a pair existed (0 counts). A day runs from 04:00 to
04:00.

**Windows, the same for every measure.** The person's usual is the 28 days before the last week
(at least 10 days with a value); recent is the last 7 days (at least 4 days with a value).
Weekdays are compared with weekdays and weekends with weekends when the usual has at least 8
weekdays and 4 weekend days; otherwise they are pooled. Until there are 14 days with any data
it is still learning and never asks.

**Changed.** A measure has changed when the median of the recent days lies outside the usual
10th to 90th percentile band widened by a quarter of its width on each side. Typing compares
like with like: the kind of app with the most counted presses this week, against that kind's
own usual, when it has enough days in both windows; otherwise every kind pooled. The daily
answer has its own test: at least 4 "Not so good" among the last week's answers and a larger
share than in the four weeks before (at least 4 answered days in each); unanswered or dismissed
days are never counted as low.

**When it asks.** Only when at least **two different categories** have changed. **No category
asks alone**, however many of its measures changed: not Sleep, and not Mood, not even the
person's own daily answers (a week with at least 4 "Not so good" makes Mood changed, which needs
one more category). A single "Not so good" only shows a gentle line and "Talk to me". My values
shows a category that changed alone, and says it never makes Cheri ask on its own. Camera or
voice measures under Mood never outweigh the person's own answer: when the answers have been
steady, they do not make Mood changed. Sensor measures are worded only as what was measured
against the person's own usual ("your typing has been more uneven"), never as a feeling; only
the person's own answer is ever stated as how they feel. The ladder's "the measures have come
back" uses the same test. After asking it waits **3 days**, unless a measure changes that was
not part of the last check-in.

**Measured, not guessed** (`npx tsx scripts/measure-rule.mts`): 400 made-up periods (weekday
and weekend differences, days away, days with too little writing, day-to-day wobble, camera on
some days, messages most days, daily answers on about two days in three), six steady weeks and
then a one-week drift (sleep slips first, typing and movement follow, a few fewer messages,
"Not so good" grows slowly). Asks by chance during the steady weeks (after learning), and finds
the drift, with the rule (two different categories):

| "Changed" test | Asks by chance | Finds the drift in its first week | Day of the drift, on average |
| --- | --- | --- | --- |
| median of the week outside the widened band (chosen) | 8 of 400 (2.0 per 100) | 397 of 400 (400 within two weeks) | 5.2 |
| at least 5 of the last 7 days outside the band | 3 of 400 | 323 of 400 (400 within two weeks) | 6.5 |
| at least 4 of the last 7 days outside the band | 57 of 400 | 395 of 400 | 5.0 |
| median of the week outside the 10 to 90 band | 170 of 400 | 400 of 400 | 4.2 |

For comparison, "any two measures" with the chosen test asks by chance in 15 of 400. The
earlier rule with exceptions (Sleep alone in two measures, the own answers alone) asked in 13
of 400. The script prints all of these.

The check-in explains in plain words which categories changed and what was observed over the
last week compared with the four weeks before, and how many days that rests on, then asks one
question with three answers. No percentages, no score, no diagnosis words.

## Typing that counts

`lib/typing.ts` (the in-app box and the tests) and `src-tauri/src/rhythm.rs` (the desktop
app) apply the same rules; `scripts/typing-samples.mts` prints how the not-writing checks
separate generated prose, game input and shortcut tapping.

- **Bursts.** A run of presses with no gap over 2 s. Only bursts of at least 30 presses count.
- **Motor rhythm, not thinking.** Rhythm evenness is the spread of the gaps under 1 s inside
  counted bursts. Gaps of 1 to 2 s are **thinking pauses**: shown under the demo per 100
  presses, never part of the rule, so writing that needs more thought does not look like a
  change in the person.
- **Not writing** (never knowing which key): a burst is left out when auto-repeat is over half
  of its key-downs or the median hold is over 180 ms (held keys, as in games), when over 20 % of
  presses come while two other keys are still down (keys at once), when fewer than 80 % of gaps
  are under 1 s (scattered shortcuts), or when a game is in front. On 300 generated samples of
  each kind, all prose counted and no game or shortcut sample did.
- **Kind of app, never its name.** When a burst starts, the desktop app reads the frontmost
  app's bundle identifier (NSWorkspace, no permission) and keeps only one word: writing, code,
  browser, game or other (`src-tauri/src/frontmost.rs`). Unlisted apps that declare themselves
  games in their Info.plist count as games. Bursts in games are never counted.
- The **live view** under the demo says, while someone types, whether the current stretch
  counts ("Counting: writing") or not ("Not counted: looks like held keys", "too short").

The weekly questions are offered only inside the conversation, after "Not my best". The
manual daily check-in, the reaction test and the share page are gone; their stored entries
still load.

## What is where

| Path | What it is |
| --- | --- |
| `app/` | Screens: `setup`, home (`page.tsx`), `prompt` (the conversation and the ladder), `settings`, `help`, `weekly` (only from the conversation), `values` (My values), `share` (Share with my clinic), `demo` (with `demo/replay`, `demo/clinic` and `live` reached from it), and `mascot` (the desktop mascot window) |
| `lib/ladder.ts` | Which step is due after "Not my best" |
| `lib/report.ts` | My values and the clinic report, from the same evaluation; `lib/clinicDemo.ts` makes the demo's made-up patients |
| `components/Strip.tsx` | One measure as daily dots over the usual band (My values and the replay) |
| `lib/settings.ts` | Sources, routines and quiet hours, with their defaults |
| `lib/contact.ts` | Reaching someone you trust: the real contact on top of `lib/messages.ts`, the stand-in for demo mode without a pair, and which message home shows |
| `lib/trusted.ts` | The app's one messages client, followed once while a pair exists, and the hook screens read it through |
| `lib/messages.ts`, `lib/events.ts` | The local-first messages client and the event types (byte-for-byte copies in `server/lib/`) |
| `components/Greeting.tsx` | "Sara: Walk after lunch?" with Yes, No and Write back, on home and in the ladder |
| `components/TrustedBridge.tsx` | Follows the pair at app level; read-aloud when a greeting arrives; messages per day for Social |
| `components/LinkCode.tsx` | A link as a QR code made on the device, with Copy |
| `server/` | The messages service and the two phone pages (its own package, see `server/README.md`) |
| `lib/replay.ts` | The made-up eight weeks for the replay and the demo data, run through the real rule |
| `lib/typing.ts` | Bursts of real writing, the not-writing checks and the daily pooling (same rules as `src-tauri/src/rhythm.rs`) |
| `lib/passive.ts` | The passive measures and the rule that decides when to ask |
| `lib/platform.ts` | Desktop app or browser: wraps the desktop app's commands and events |
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
- `typingDays[]`: one per day and kind of app (`writing`, `code`, `browser`, `other`, and `all`
  pooled; games are never kept): where it was measured (`computer` or `box`), counted presses
  and bursts, rhythm evenness, hold time and thinking pauses per 100 presses (null under 300
  counted presses). Numbers and one word for the kind of app only.
- `typingSessions[]`: from earlier versions, one per typing session. Still loads; the rule no
  longer reads it.
- `activityDays[]`: first and last key press per day (`"HH:MM"`), from the desktop app.
- `movementSessions[]`: one per stretch with the camera on (`lib/camera`): date, minutes in
  frame, average movement (shoulder widths per second), position changes per hour, and the
  face (movement, raised mouth corners, lowered brows) and posture (head height above the
  shoulders, the session's own usual) numbers. No picture is ever kept.
- `postureUsual`: the person's usual posture across sessions (the median head height of the
  last 28 days), since the camera's own usual is only the first minutes of each session.
- `toneSessions[]`: one per stretch with the microphone on (`lib/voice/tone.ts`): minutes,
  minutes of talking, voiced stretches per minute, pitch movement, loudness. No sound, no words.
- `contactDays[]`: messages with the person they trust per day, while a pair existed.
- `dailyAnswers[]`: one per day the daily question came up: the date, the answer (`good`,
  `okay`, `not-so-good`) or null when it was dismissed, and when.
- `checkIns[]`: each proposed check-in and its answer, which measures triggered it, how
  many days it was based on, and whether it was simulated.
- `settings`: whether read-aloud is muted, a running "Simulate a change", sources, small
  things, quiet hours, `dailyQuestion` (how often and roughly when), and `messagesUrl`, where
  the messages service lives.
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
passive measures as plain data (key, source, label, status, direction, the last week's values,
the usual range, whether weekdays and weekends were compared apart, how many days exist) plus
`askNow`, `reason`, `learning`, `daysOfData` and `basedOn` (how many days this week and in the
four weeks before a change is based on).

`BrainOutput` has two parts:

- For the person's own entries: one sentence to say (`say`), at most one suggestion
  (`morning-light`, `walk`, `regular-bedtime` or `music`), and whether a change was noticed.
- `passive`: the explanation shown first in the proposed check-in (`explanation`), the calm
  line on home (`calmLine`), the one-sentence insight (`insight`) and the one small
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
- Cheri's look: Settings, Cheri's look, shows Cheri large and live with three furs (soft,
  shaggy, smooth; shaggy uses more graphics power) and six colours from `dot.js`. The choice is
  kept in `settings.look` (`lib/look.ts`) and used wherever Cheri appears; the small mascot
  window always uses soft instead of shaggy, since it runs all day.
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
- The camera and the microphone are separate switches, both off by default (Settings, What I
  measure, Energy). Each is asked for only when turned on and runs only while the app's window
  is open and showing; Pause everything stops both, and "Camera on" or "Microphone on" shows on
  every screen and in the mascot window while they run. The picture and the sound are worked
  out on this computer (MediaPipe and Web Audio, vendored or built in) and never stored or sent;
  no words are recognised. Only numbers per stretch are kept: movement, face movement, raised
  mouth corners and posture from the camera (lowered brows are kept but never shown or used),
  pace and pitch movement from the microphone. "Camera, live" and "Voice, live" are under the
  demo.
- Face and posture are experimental and never used on their own: the face model's own card says
  it is made for AR and avatars and not intended for human life-critical decisions. Under Mood
  they may only support another category, and never outweigh the person's own answer.
- Read-aloud uses only voices the browser reports as on-device (`localService`). If there is
  none, the companion stays silent and shows its text.
- Measurements stay on this device unless the person chooses to save or print a report for
  their clinic, each time, after seeing all of it. The app sends it nowhere.
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
  key-down is the keyboard's auto-repeat (counted as a repeat, never as a press), the time of
  day of the first and last key press per day, to the minute, and when a burst of typing
  starts, the kind of app in front as one word (writing, code, browser, game or other).
- **Never captured:** which key, the character, the modifiers (Shift, Cmd and so on are not
  even subscribed to), the app's name or bundle identifier (read to pick the word, then
  dropped), window titles, any text. The callback does not read the key code field at all.
- **Computed** (`src-tauri/src/rhythm.rs`): bursts and their checks (see "Typing that counts"),
  and per day and kind of app: counted presses, rhythm evenness, hold time, thinking pauses.
  Because the key is unknown, a release is paired with the oldest press still down; with
  overlapping keys in another order that is an approximation.
- **Kept:** in `rhythm.json` in the app's data folder
  (`~/Library/Application Support/fi.junction.cheerpressure/`): first and last activity, today's
  and yesterday's counted gaps and holds in whole milliseconds (so the day can be pooled), and
  older days only as their numbers; the UI copies the day numbers into its local storage.
  "Delete everything" clears both.
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
  items, hide on close, the mascot cue in the real window,
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
- Sending anything to a clinic. The person saves or prints the report; there is no clinic
  integration. "What a clinic could see" is made up.
- The clinic's real contact details. The help screen has a marked placeholder.
- Reminders or notifications. Greetings arrive by polling every 1.5 s while the app runs.
- More than one trusted person, or a conversation history in the interface.
- Offline caching (no service worker).
- Microphone and bedside sensor. The camera runs only while the Cheer Pressure window is open
  and showing; no background capture.
- Next step, not this weekend: the bedside robot and the radar. `lib/robot.ts` keeps the seam
  (Web Serial), but nothing in the app connects or sends to a robot.
- The character's final look.
- Translations. The UI is English only.
- Clinical validation of any threshold. The change thresholds in `lib/levels.ts` are first guesses.
- Face and posture measures beyond an experiment: the face model is made for AR and avatars, not
  for decisions about people, so they never count on their own.

## Notes

- The weekly questions use the PHQ-2 items and answer scale, but ask about "the last week"
  instead of the standard two weeks, to match the weekly rhythm.

## Licence

MIT, see [LICENSE](LICENSE).
