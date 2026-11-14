# BAR: what "usable MVP" means (version 2, passive first, 14 Nov)

Name: Cheer Pressure. Junction 2026, Aalto challenge "Beyond the Clinic":
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

## C. Home (passive first)
- C1. The companion character is visible. It is a single swappable component with at least the states idle, speaking and listening, and the state visibly changes.
- C2. Home asks for nothing: no primary "start check-in" button and no "done today" status. It shows one calm line and a short list of what is being measured right now, each with its state.
- C3. One quiet link lets the person say how they are doing on their own initiative.

## D. What is measured without asking
- D1. Passive measures: typing evenness (spread), longer pauses, key hold time, first activity, last activity, and "quiet night" labelled as an estimate of rest, never as measured sleep.
- D2. /live/ shows the typing numbers updating while the person types, each with a one-line plain meaning, and says truthfully where it measures ("only in this box" in a browser).
- D3. A visible Pause / Resume control stops and restarts measuring.
- D4. What is typed is never stored or shown: only timing numbers are kept (check stored data in the browser).
- D5. Until 7 days of data exist the companion says it is still learning and does not ask.

## E. The companion asks only when values stand out
- E1. A measure counts as changed only when all of its last 3 sessions or days lie on the same side outside the person's own typical range. The companion proposes a check-in when at least 2 measures have changed. A measure needs at least 7 earlier sessions or days before it can count as changed, and after any answered or declined check-in the companion waits 3 days unless a measure changes that was not part of that check-in (intended).
- E2. The proposed check-in first explains in plain words which measures changed and how much data it is based on, then asks one question, "How are you doing?", with three tap answers ("I'm okay", "Not my best", "I'd like someone to check in on me") and a quiet way to decline.
- E3. "I'm okay" ends with a short closing line. "Not my best" offers the weekly questions (the two PHQ-2 items on the 0 to 3 scale, sleep, feeling tense, one per personal early sign) and one small suggestion. "I'd like someone to check in on me" shows a clearly marked "not connected yet" screen.
- E4. No percentages, no risk score, no diagnosis words in any of this.
- E5. Weekly questions are never offered on a schedule: only after "Not my best" or through a quiet link.
- E6. A clearly marked demo control triggers the proposed check-in immediately, and screens say when data is made up.

## F. One experimental test
- F1. A reaction-time test (five trials, shows the median in ms) reachable from home.
- F2. It is labelled as an experiment in the UI, and its result is saved.

## G. Your own level
- G1. A view shows each passive measure against the person's own typical range (their own earlier sessions and days), never against other people, with a one-sentence insight. Entries the person made themselves appear below as secondary.
- G2. A clearly marked "Load demo data" control fills six weeks of made-up passive measures where the last days drift. A matching control clears it.
- G3. With the drift present, the companion states in plain words what changed compared with the person's own level.
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
- L3. A first-time user can complete setup, find the live view and understand what is measured without reading any instructions outside the app.

## M. Desktop app (owner tests by hand; a browser critic cannot)
- M1. The mascot window appears bottom-right, transparent, on top, draggable, and does not take focus. Clicking it opens the main window.
- M2. Closing the main window hides it to the menu bar. The menu bar item offers Open, Pause / Resume and Quit.
- M3. With Input Monitoring allowed, typing in another app moves the numbers in the live view, which says it measures across the whole computer. Without the permission the app explains what is needed and falls back to the box.
- M4. Only key timing is read: never which key.
