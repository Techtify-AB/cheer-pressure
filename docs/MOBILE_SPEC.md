# Cheer Pressure on the phone: build spec

Written Saturday 14 November 2026, about 22:15 Finnish time, from Dante's decisions.
For Eric (design and flow) first, then for whoever builds it. Read `docs/PROJECT.md` for the
background. Where the two differ, this file wins for the phone app.

## Why the phone

The first idea was three devices working together: computer, phone, a bedside companion. In
practice the person we build for is not at a laptop every day, so a camera and typing rhythm
on a computer cannot be the base. The phone is with them. **The phone app is the product.**
The desktop app stays as an extra for people who do sit at a computer.

## What is new here, in one sentence

The phone already knows sleep, steps and where you are; that is not new. What is new is what
happens when those stand out: **Cheri reaches out, talks with you, learns what helps you, and
gets you to a person before it becomes a matter for the clinic.**

## Settled principles (do not redesign these)

1. Everything is in English.
2. Four categories, always in this order: **Sleep, Energy, Social, Mood.**
3. Cheri compares the person only with their own usual (the previous four weeks against the
   last week; two weeks of learning first).
4. Cheri reaches out only when **at least two different categories** have changed.
5. Anything from a sensor is worded as an observation against the person's own usual, never as
   a feeling or a verdict. Only the person's own words say how they feel. No percentages, no
   risk scores, no diagnosis words.
6. Cheri is a tool, not a therapist or a friend, and says so. No guilt, no "I missed you".
7. One view at a time, no scrolling, at most four groups, one primary action, details behind
   one tap. "Need help now?" on every screen. Crisis words always show the fixed help card.
8. Measurements stay on the phone unless the person has chosen to share with their clinic.

## What the phone measures

| Category | Without the person doing anything | During the daily hello |
|---|---|---|
| Sleep | Sleep from a watch, a sleep app or the phone's own sleep feature (Apple Health / Health Connect) | |
| Energy | Steps and activity through the day | Pace of the voice |
| Social | At home or out (coarse); contact with the people they trust | |
| Mood | | The person's own answer; face movement and tone of voice (experimental) |

The phone cannot use the camera or microphone in the background. That is why the daily hello
exists.

## Onboarding (one question per screen)

Onboarding is where Cheri learns what to suggest and what to watch for.

1. **Hello.** Cheri says what she is ("a tool, not a therapist") and what stays on the phone.
2. **What helps you?** Pick any, add your own. This becomes step one of the ladder, instead of
   generic advice. Starting list, taken from the challenge's own words (natural stimuli, phone,
   music, games, light, AI): being outdoors or in nature, music, a game, light in the morning,
   moving your body, making or cooking something, something to watch or look at, talking with
   someone. Free text for their own.
3. **What did you notice first last time?** The person's early warning signs (pick up to three
   or write their own). Cheri keeps these in mind and asks about them in the conversation.
4. **Who do you trust?** One or more people. Each gets an invite link or QR code and answers
   from their own phone, no app needed.
5. **Your clinic.** One clear choice, changeable later:
   - *Always:* a short weekly summary, and a note when two categories stand out.
   - *Only when I say:* nothing unless I approve it.
   - *Never.*
   And one more yes/no: "If my values have not come back after X days, tell my clinic for me."
6. **What may I look at?** Permissions, one at a time, each with one plain sentence: sleep and
   steps, at home or out, notifications, camera and microphone (only during the daily hello).
   Every one can be skipped; the app must work with any combination.
7. **A daily hello?** When, and how often (see below).
8. **Cheri's look.** Fur and colour.

## The daily hello

A short moment with Cheri, 20 to 40 seconds, started from a notification.

- **Why it exists:** the model that reads face and voice needs to learn this person's neutral
  state. Without regular samples it can never tell a change from this person's normal.
- **What happens:** Cheri asks one thing ("How are you today?"). The person answers by talking
  to her, camera and microphone on while the app is open; or by one tap (Good / Okay / Not so
  good) if they do not want to talk. Cheri answers in one or two sentences and ends it herself.
- **How often:** every day for the first two weeks (the learning period), then as often as the
  person chose: every day, a few times a week, or off. Say this plainly in onboarding so it
  does not feel like a chore that never ends.
- **Never:** during quiet hours, more than once a day, or stacked up after a missed day.
- **States Eric needs:** notification; Cheri listening; Cheri speaking; done; skipped;
  camera or microphone refused (falls back to one tap).

## When values stand out: the ladder

The phone notices on its own. When two categories have changed, the person gets a notification
from Cheri, and the conversation opens with a plain explanation ("Sleep and Energy have changed
compared with your usual: your nights have been shorter and you have moved less.") and one
question, "How are you doing?".

- **Step 1, something for you.** Cheri suggests one thing from what the person said helps them
  in onboarding (not a generic tip). Later, the things that were followed by values coming back
  are suggested first: this is the "learns what helps you" part. Optionally the short face and
  voice reading from the daily hello is used here as one more observation.
- **Step 2, someone.** If values have not come back after two days: "Would you like to see or
  talk to someone?" The person picks who, from the people they trust. That person gets the
  request on their phone and answers with a few words ("Walk after lunch?"). This step is
  purely social: meeting or talking.
- **Step 3, the clinic.** If values still have not come back after X days: if the person said
  yes in onboarding, the clinic is told automatically and the person is shown exactly what was
  sent; otherwise Cheri asks first. X is not decided (seven days is the current value).

The clinic sharing chosen in onboarding ("Always") runs alongside the ladder, not after it.

## Screens to design

| Screen | What it is for | Primary action |
|---|---|---|
| Onboarding, 8 steps | See above, one question each | Continue |
| Home | Cheri, one calm line, the four categories with one state each | none, unless Cheri has something |
| Notification | "Cheri would like a word" / daily hello | Open |
| Daily hello | Talk or tap | Talk (hold), or one of three taps |
| The conversation | Explanation, then one question with three answers | the answer |
| Step 1 | One suggestion from their own list | I'll try that |
| Step 2 | Pick a person; waiting; their reply | Ask them / Yes |
| Step 3 | What the clinic is told, before or after | Approve / OK |
| My values | One category per view, weeks against the person's own band | none |
| The report | One page, by category, as the clinic sees it | Share / Save |
| Settings | What I measure, what helps me, people I trust, my clinic, daily hello, Cheri's look, my data, help | per row |
| The trusted person's page (web, exists) | Request, quick replies, answer | Send |

Every input in a category must show an honest state: values, "still learning", "off" or "not
connected yet". A category must never shrink to whatever happens to have data.

## What already exists and what is new

**Reuse as it is** (see the repository): the rule and the categories (`lib/passive.ts`), the
ladder (`lib/ladder.ts`), the messages service and the trusted person's page (`server/`), the
report (`lib/report.ts`), Cheri (`components/companion/`), face movement and tone
(`lib/camera/`, `lib/voice/`), the replay for the demo.

**New for the phone:** a real app shell around the same interface; reading sleep and steps from
the phone's health data; at home or out; notifications; the longer onboarding (what helps you,
several trusted people, the clinic choice); the daily hello as a conversation; step 1 choosing
from the person's own list and remembering what worked; several trusted people in step 2; the
automatic clinic step.

**Not this weekend:** a real connection to a clinic's systems (shown with a marked demo
recipient); syncing values between phone and computer; a watch app.

## Open questions

1. iPhone or Android first, and who has a developer account for signing?
2. How many days is X before the clinic is told?
3. What Eric and Filip learn from the Aalto team: what patients can manage daily, and which
   signal a clinic would trust.
4. The format of Filip's model (it must run on the phone, with no network).
5. Whether "at home or out" is worth its location permission, or is left for later.
