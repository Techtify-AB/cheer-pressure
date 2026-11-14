# BAR: what "usable MVP" means

Working name: companion (final name not chosen). Junction 2026, Aalto challenge "Beyond the Clinic":
help people stay well at home after depression treatment. A digital companion that lives locally,
does short check-ins, and compares the person only with their own earlier answers.

A critic will open the running app in a real browser and check every line below. Each line must be
observable in the browser or in the repo. UI language: English.

## A. Runs
- A1. `pnpm install && pnpm dev` starts the app on port 3470 with no errors.
- A2. Loading `/` shows no console errors and no failed requests.
- A3. Works at 390 px wide (phone) and 1366 px wide (laptop) with no horizontal page scroll.

## B. First run
- B1. First visit shows a short setup: the companion says what it is ("a tool, not a therapist") in one or two sentences.
- B2. Setup asks "What did you notice first last time?" and lets the person pick or type up to three personal early signs. They are saved.
- B3. After setup, reloading the page goes to home, not back to setup.

## C. Home
- C1. The companion character is visible. It is a single swappable component with at least the states idle, speaking and listening, and the state visibly changes.
- C2. Exactly one primary action on home: start today's check-in. Secondary links are visually quieter.
- C3. Home says whether today's check-in is done.

## D. Daily check-in (about 30 seconds)
- D1. Three steps at most: how you slept (bedtime and wake time, or a 1 to 5 tap), today's form (1 to 5 tap), and reading one fixed sentence aloud.
- D2. The read-aloud step records with the microphone and shows a speech rate (words per second) computed on the device. If the microphone is refused or missing, the step can be skipped and the check-in still completes.
- D3. Every question can be answered by tapping or typing. Voice is never required.
- D4. Finishing saves the entry and returns home, which now shows the check-in as done.

## E. Weekly questions
- E1. Reachable from home by a quiet link, and offered automatically when 7 days have passed since the last one.
- E2. Asks the two PHQ-2 items (feeling down, depressed or hopeless; little interest or pleasure) on the standard 0 to 3 scale, one item on sleep and feeling tense, and one item per personal early sign from setup.
- E3. Saved with a date; visible in the trend view.

## F. One experimental test
- F1. A reaction-time test (five trials, shows the median in ms) reachable from home.
- F2. It is labelled as an experiment in the UI, and its result is saved.

## G. Your own level
- G1. A view shows each tracked thing over the last 14 days against the person's own baseline (their own earlier entries), never against other people.
- G2. A clearly marked "Load demo data" control fills six weeks of made-up entries where the last week drifts (later sleep, lower form, slower speech, higher weekly answers). A matching control clears it.
- G3. With the drift present, the companion states in one plain sentence what changed compared with the person's own level, and suggests one small action (morning light, a walk, a regular bedtime, or music).
- G4. No diagnosis words anywhere in the UI: it never says the person is depressed, relapsing or at risk. It only describes change from their own level.

## H. Voice
- H1. The companion can read its questions aloud with the browser's built-in speech synthesis, with a mute control.
- H2. Voice input is off by default. If it exists, the toggle states in plain words whether audio leaves the device. Nothing may claim to be local when it is not.

## I. Privacy
- I1. All entries are stored in the browser only (IndexedDB or localStorage). There is no account and no login.
- I2. At runtime the app makes no requests to any origin other than its own (check the network panel through a full daily check-in, weekly questions and the trend view).
- I3. "Delete everything" removes all stored data after one confirmation, and the app returns to setup.
- I4. "Share with my clinic" shows the person a readable summary of exactly what would be shared and lets them copy or download it. It sends nothing.

## J. Safety
- J1. A "Need help now?" link is reachable from every screen. It shows emergency number 112 and a clearly marked placeholder for the clinic's own contact.
- J2. If typed text contains crisis words (a fixed list in one file), the app shows a fixed, pre-written handoff card instead of a generated reply.
- J3. A check-in ends by itself with a short closing line. No guilt, no "I missed you", nothing that pushes for more time in the app.

## K. Seams for the team
- K1. One file defines the companion's "brain" as an interface (given recent entries and baseline, return what to say and what to suggest), with a rule-based implementation that needs no API key and no network. The README says where a trained model plugs in.
- K2. Design tokens (colours, type, spacing, radius) live in one file. The character is one component. Changing either does not require touching the check-in logic.
- K3. README with run steps, the data model, and what is deliberately not built. MIT LICENSE file.

## L. Craft
- L1. Every clickable thing has `cursor: pointer` and a visible keyboard focus state.
- L2. The font is not Bricolage Grotesque. No italic headings.
- L3. A first-time user can complete setup and one daily check-in without reading any instructions outside the app.
