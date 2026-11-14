# Things to do: the activities

Step one of the ladder is "something for you". These are the somethings: nine small,
concrete activities, each on its own static page (`/activities/<id>/`), with a library at
`/activities/` and the person's plan at `/activities/plan/`.

| Where | What |
|---|---|
| `lib/activities/index.ts` | The list, `activityForHelp(helpId, label?)`, `nextActivities` |
| `lib/activities/feedback.ts` | "Did that help?" summed up: `activityHelpStats`, `activityHelpSentence`, `activityHelpScore`, `orderActivitiesByHelp` (stable names, for the ladder too) |
| `lib/activities/reaction.ts` | The quick reaction check's rules (experimental) |
| `lib/activities/timer.ts`, `game.ts`, `reply.ts`, `guide.ts` | Pure rules, unit tested in `scripts/test-activities.mts` |
| `lib/activities/sounds.ts` | The two sounds; the only place their paths are written |
| `lib/plan.ts` | The person's plan with demo defaults |
| `components/activities/` | The shared flow (`useActivity`, `ActivityScreen`, timer, audio player, edge light, steps, checklist, feedback, `ReactionCheck`) and one file per activity |

## The shared flow

Every activity opens on one screen with one primary button. "Make it easier" swaps in a
smaller step. "End" stops all sound, light, speech and timers at any moment. "Done" records a
self-reported `ActivityDone` (lib/storage.ts), then asks "Did that help?" once; ending partway
after starting asks it more gently. After that, a quick reaction check is offered at most once a
day, never forced.

## A recorded voice for "Move your attention for a moment"

There is no recorded voice yet. The guide lives in `lib/activities/guide.ts` as lines with time
markers (`at`, seconds from the start) and is spoken line by line with the device's on-device
speech. To use a recording: put the file in `public/audio/`, set `ATTENTION_GUIDE.audioSrc` to
its path, and set each line's `at` to where that line starts in the recording. The player then
shows each line by the recording's clock instead of speaking it.

## Sounds

`node scripts/make-audio.mjs` writes `public/audio/warm-pad.wav` and `low-drone.wav`
(original, no third-party rights). Other files: change `src` in `lib/activities/sounds.ts`.
