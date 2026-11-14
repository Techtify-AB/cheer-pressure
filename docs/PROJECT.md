# Cheer Pressure: what we are building, and where it stands

Written Saturday 14 November 2026, about 19:45 Finnish time, for teammates and their
coding assistants. If you are an assistant reading this for someone: explain it in plain
words, then read `README.md` (how the code works) and `BAR.md` (what "usable" meant earlier
today; it is out of date and this file wins where they differ).

## The product in one paragraph

Cheer Pressure is a companion, called **Cheri**, for people who have finished TMS treatment
for depression and are now at home. About half of the people who respond to TMS lose the
effect within a year. Cheri measures a few things by herself, compares them only with the
person's own usual, and speaks up when something stands out. She explains what changed in
plain words and asks one question. Then she helps one step at a time: one small thing to do,
then someone the person trusts, then the clinic. We built it at Junction 2026 for the Aalto
University challenge "Beyond the Clinic".

Pitch line: "Cheer Pressure notices when your rhythm changes and makes it easier to reach
someone you trust."

## Who does what

- **Eric:** look and feel, Cheri's character, the phone flow, the pitch and deck.
- **Dante:** software, the desktop app, the messages service, wiring things together.
- **Filip:** the research basis, the model behind Cheri's words, tuning and testing the
  measurements (camera thresholds, tone of voice, sigh detection if we get there).

## Decisions that are settled

1. **Everything is in English:** interface, voice, pitch, prototypes.
2. **Four categories.** This is what the person sees, everywhere:
   - **Sleep:** an estimate from when the computer is first and last used. Later: a phone
     app, a watch or band (Fitbit, Apple Health, Health Connect), a physical companion at
     the bedside. Those three are not connected.
   - **Energy:** body movement (camera), pace of the voice, typing rhythm.
   - **Social:** how often you talk with someone, and whether you are at home or out.
   - **Mood:** the person's own daily answer (Good / Okay / Not so good) as the anchor,
     plus face movement, posture and tone of voice.
3. **When Cheri asks:** only when at least **two different categories** have changed. No
   category asks alone. A measure counts as changed against the person's own usual range
   (the previous four weeks) over the last week, weekdays compared with weekdays.
4. **Wording rule:** anything from a sensor is described as an observation against the
   person's own usual ("your face has been less animated than your usual"), never as a
   feeling or a verdict. Only the person's own answer is ever stated as how they feel. No
   percentages, no risk scores, no diagnosis words. Sensor inputs in Mood never outweigh the
   person's own answer.
5. **The daily question:** a small bubble from Cheri, "How are you today?", three answers,
   one tap. The person chooses how often, or turns it off.
6. **The ladder** after "Not my best": one small thing from routines the person chose; two
   days later, if nothing has come back, the offer to reach someone they trust; a week
   later, the offer of a short report for the clinic, which the person sees and approves.
7. **Privacy:** measurements, answers and summaries stay on the device unless the person
   chooses to save or print a report for their clinic. Only messages between the person and
   the one they trust pass through the small messages service, and are deleted after 48
   hours. Typing is measured as timing only, never which keys. The camera picture is worked
   out on the computer and never stored or sent.
8. **As little interface as possible:** three places (Home, the conversation, Settings);
   one view at a time, no scrolling, at most four groups, one primary action. Everything
   for the jury sits under Settings → "For the demo".
9. **Cheri is a tool, not a therapist or friend,** and says so. Crisis words always show a
   fixed, pre-written help card. "Need help now?" is on every screen.
10. **Dropped for this weekend:** the bedside robot and the radar. They are "next steps" in
    the pitch. Nothing in the app or demo may promise a robot or a light.

## How it is put together

- **Main app** (repository root): Next.js 16.3.5 as a static export, wrapped in a Tauri 2
  desktop app (`src-tauri/`). On the desktop Cheri lives in a small always-on-top window and
  the app has a main window and a menu bar item.
- **Messages service and phone pages** (`server/`): its own small Next.js package. It holds
  only pairs and short messages. The trusted person opens `/t/<pair>` on their phone.
- **Storage:** in the browser or webview on each device. No account, no database of ours.

Files worth knowing:

| File | What it is |
|---|---|
| `lib/passive.ts` | The categories, the measures, and the one rule for when Cheri asks |
| `lib/brain.ts` | Everything Cheri says. **This is where a model plugs in** |
| `lib/ladder.ts` | The steps after "Not my best" |
| `lib/camera/` | Movement, face movement and posture from the camera, on the device |
| `lib/voice/` | Tone of voice (being built) |
| `lib/messages.ts`, `lib/contact.ts` | Talking to the messages service, local first |
| `lib/replay.ts` | "Eight weeks in 20 seconds": made-up days run through the real rule, one strip per category |
| `components/companion/` | Cheri (`dot.js` is Eric's three.js model: nine moods, three furs) |
| `styles/tokens.css` | Colours, type, spacing: change the look here |
| `scripts/measure-rule.mts` | Measures how often the rule asks by chance on made-up data |

## For Filip in particular

- **Your model plugs in at one line** in `lib/brain.ts` (`export const brain = ruleBrain`).
  The brain receives the measured values and the rule's outcome and returns the words: the
  explanation, the calm line on Home, the weekly insight, the suggestion. It does **not**
  decide whether Cheri asks; that stays in `lib/passive.ts`. See "Where the model plugs in"
  in `README.md` for the types and a small example.
- **A local voice chain is planned, not built:** whisper.cpp for speech to text, Ollama with
  a small model for the reply (Gemma would also qualify for the Gemma prize), Piper for the
  voice (Amy or Kusal). The model should only phrase what the rule concluded, and must never
  answer crisis words.
- **Thresholds are first guesses.** How much movement counts as a position change, what
  counts as smiling, how slumped is slumped, and the tone measures have only been tested on
  synthetic data. They need a real person in front of a real camera and microphone.
- **What the research supports, and what it does not.** Supported by earlier studies:
  psychomotor slowing is part of depression and tracks severity; residual symptoms are the
  best predictor of relapse; irregular sleep goes with worse outcomes; the two PHQ-2
  questions catch most cases; more variable typing rhythm and longer pauses went with more
  severe symptoms in a 147-person phone study (median typing was slightly faster, not
  slower); head movement was smaller and slower when depression was more severe, in clinical
  interviews; bedside radar detects sleep well but misses quiet wakefulness. **Our
  hypotheses, not shown by anyone:** that typing on a laptop, movement at a desk, face
  movement or tone can warn an individual in advance; that a nudge towards a trusted person
  improves outcomes. Face expression has the weakest evidence of all, which is why the
  wording rule exists.
- **Do not claim** that it detects, diagnoses or predicts depression or relapse; that any of
  the sensor measures is validated on a laptop or within one person; that sighs indicate
  depression (a 469-person study found no link); that it reads emotions.
- **A number we can say:** on 400 made-up, steady five-week periods the first version of the
  rule asked by chance in 253; after widening the usual range it was 18 of 400, and it still
  noticed the made-up change in week six every time. Re-run `npx tsx scripts/measure-rule.mts`
  for the rule as it is now, since it has changed again today (categories, two-category rule).

## Where it stands

**Built and committed:** passive measuring and the rule; the desktop app with floating
Cheri, menu bar and typing timing across the whole computer; Eric's character; the
one-view layout; the three places; the replay; the ladder; the messages service, the phone
pages and the real chain (ask for contact, a greeting arrives, answer it); typing counted
only in bursts of real writing, one value per day; the daily question; camera movement,
face movement and posture as stand-alone demo screens.

**Being built right now (not all committed):** the four categories in the rule and the
interface; "My values" and the printable clinic report; the two-category rule and dropping
the bedside robot; wiring the camera into the categories; tone of voice.

**Not started:** sleep from a phone or watch; counting conversations; home or out; the voice
conversation with Cheri; sigh detection; choosing Cheri's look in Settings; video, deck and
submission text.

**Phone flow (Saturday night, web side):** onboarding one question per screen; step one from
the person's own list, ordered by what they said helped; several trusted people; other ways to
reach someone when there is no one (peer contact is a demo); the clinic step as chosen with a
local "Shared with my clinic" list (demo recipient); the daily hello at `/hello/` with the face
model seam. See "The phone flow" in `README.md`. Checked by the builders' own tests and a
headless fit check only.

**Not verified by a human:** almost everything since Saturday morning has only passed the
builders' own automated checks. Nobody has yet clicked through the desktop app, tried the
chain with a real phone, or sat in front of the real camera and microphone. `BAR.md`
describes an earlier version.

## Run it

```bash
pnpm install
pnpm dev                 # the app in a browser, http://localhost:3470
pnpm test                # rule, ladder, typing, plus the Rust tests
cd server && pnpm install && pnpm dev   # messages service and phone pages, port 3480
```

Desktop app (macOS, needs Rust): `pnpm desktop:build`, then open
`src-tauri/target/debug/bundle/macos/Cheer Pressure.app`. Typing across the whole computer
needs the "Input Monitoring" permission; without it the app says so and measures only in
its own box.

## Hackathon rules that matter for the code

All code is written during the event. The submission needs a public repository under the
MIT licence, a demo, a video of at most two minutes and a deck. No new features after
Saturday 22:00; final submission Sunday 10:00 Finnish time.
