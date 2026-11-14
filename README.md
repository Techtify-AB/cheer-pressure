# Cheer Pressure

A hackathon MVP for Junction 2026, Aalto University challenge "Beyond the Clinic".

Cheer Pressure is a small digital companion for people who have finished treatment and want to stay well at
home. It does a 30 second daily check-in and a short weekly one, and compares the person
only with their own earlier answers. Everything stays in the browser on the device.

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
```

To try it quickly: finish setup, then open **Your own level** and press **Load demo data**.
That adds six weeks of made-up entries where the last week drifts (later bedtime, lower
form, slower reading, higher weekly answers). **Clear demo data** removes only those.

## What is where

| Path | What it is |
| --- | --- |
| `app/` | Screens: `setup`, home (`page.tsx`), `check-in`, `weekly`, `reaction`, `trends`, `share`, `settings`, `help` |
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
- `settings`: whether read-aloud is muted.

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
  reflect(input: BrainInput): Promise<BrainOutput>; // what to say + one suggestion
  closingLine(kind: "daily" | "weekly", today: string): string;
}
```

`BrainInput` holds the recent daily and weekly entries, the profile, and `levels` (the
person's own baseline and the change in the last week, from `lib/levels.ts`). `BrainOutput`
is one sentence to say, at most one suggestion (`morning-light`, `walk`, `regular-bedtime`
or `music`), and whether a change was noticed.

`ruleBrain` is the default. It needs no API key and no network. To use a trained model,
write another object that implements `Brain` (for example one that runs a small model in
the browser) and change the last line of `lib/brain.ts`:

```ts
export const brain: Brain = ruleBrain; // swap for your model
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

## Desktop and phone

`pnpm build` writes a fully static site to `out/` (Next.js `output: "export"`): no server is
needed at runtime. That folder can be loaded by a desktop shell such as Tauri, and the app
has a web app manifest (`app/manifest.ts`, icons in `public/icons/`) so it can be added to a
phone's home screen as a PWA. Neither the Tauri shell nor a service worker is built yet.
`scripts/make-icons.mjs` redraws the placeholder PNG icons.

## Not built (on purpose, for now)

- Voice answers. Questions can be read aloud; answers are always tapped or typed.
- A trained model. The rule-based brain is the default (see above).
- Any sync, backup, account or server. Clearing the browser's site data deletes everything.
- Sending anything to a clinic. Sharing is copy or download only.
- The clinic's real contact details. The help screen has a marked placeholder.
- Reminders or notifications.
- Offline caching (no service worker), and the Tauri desktop shell.
- The character's final look, and the final name.
- Translations. The UI is English only.
- Clinical validation of any threshold. The change thresholds in `lib/levels.ts` are first guesses.

## Notes

- The weekly questions use the PHQ-2 items and answer scale, but ask about "the last week"
  instead of the standard two weeks, to match the weekly rhythm.

## Licence

MIT, see [LICENSE](LICENSE).
