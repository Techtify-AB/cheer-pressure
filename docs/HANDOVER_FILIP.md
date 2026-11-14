# Handover to Filip: the daily hello, a real conversation, and your trained model

Written Sunday 15 November 2026, about 00:20 Finnish time. Submission is 10:00.
Read `docs/MOBILE_SPEC.md` (section "The daily hello") for why this exists. This file says
what is built, what is not, and exactly where your two pieces plug in.

## The goal

The daily hello is a 20 to 40 second moment with Cheri on the phone. Today it works with one
tap (Good / Okay / Not so good). Two things are missing, and they are yours:

1. **A real conversation.** The person talks, Cheri understands and answers out loud, all on
   the device.
2. **Your trained face model**, reading the camera during that conversation, in place of the
   default.

Both have a ready socket in the code. Neither needs changes to the screen itself.

## What already works (do not rebuild)

- The screen: `app/hello/page.tsx`. Hold to talk, or one tap. Camera with a small self-view.
  Cheri ends it herself after about 40 seconds and releases camera and microphone.
- The camera pipeline: MediaPipe Face Landmarker runs in the page (`lib/camera/`), files
  vendored under `public/vendor/mediapipe` and `public/models`, no network.
- Storage and "this person's own usual": `lib/hello.ts`. Readings are saved per day as plain
  numbers. Until 14 days exist the app says it is still learning; after that it compares the
  day with the person's own last 28 days.
- Tone of voice from the microphone (pace, pauses): `lib/voice/tone.ts`, in the browser.
- The fallback reply: `brain.helloReply()` in `lib/brain.ts`, a short pre-written line.
- The phone app is a React Native shell (`mobile/`) that shows this same web interface in a
  webview. Anything the web page cannot do itself goes over a small bridge.

## Part 1: the conversation (speech to text, a local language model, speech out)

### The contract is already written on the web side

`lib/phoneBridge.ts` defines four things the phone app may offer. The hello screen already
calls all of them and falls back to one tap when they are missing:

| Request / event | Arguments | Must return / send |
|---|---|---|
| `listen.start` | `{}` | starts speech to text while the person holds the button |
| `listen.stop` | `{}` | `{ text }`: everything they said |
| event `transcript` | | `{ text, final }` while they talk (optional, for showing the words) |
| `converse` | `{ text, context }` | `{ text }`: Cheri's reply, one or two short sentences |
| `speak` | `{ text }` | says it aloud, resolves when done |

The screen switches them on only when `getCapabilities` answers
`{ listen: true, converse: true, speak: true }`. You can ship them one at a time: with only
`listen` and `speak`, the reply comes from the pre-written lines.

`context` in `converse` carries the tap answer if any (`answer`) and one plain observation (`observation`)
against the person's own usual (or the learning line). Crisis words are caught in the page
before `converse` is ever called, and the fixed help card is shown instead. Keep it that way.

### What is NOT built: the phone side

Nothing in `mobile/` answers those four requests yet. To add them:

1. `mobile/src/protocol.ts`: add `"listen.start"`, `"listen.stop"`, `"converse"`, `"speak"`
   to `PHONE_REQUESTS`, `"transcript"` to `PHONE_EVENTS`, and `listen`, `converse`, `speak`
   booleans to the capabilities type. Mirror the same in `lib/phone.ts` (the two files must
   match; the web side currently sends these as "extra" requests so it works either way).
2. `mobile/src/bridge.ts`: add a handler for each in `handlers()`, next to
   `getCapabilities`, and return the three booleans from `getCapabilities`.
3. The engines. Suggested, all on the device:
   - **Speech to text:** the phone's own recogniser (`expo-speech-recognition`, on-device
     mode) is the fastest to get working. `whisper.rn` is the alternative if you want the
     same model on both platforms.
   - **Language model:** a small GGUF model through `llama.rn`. Keep it tiny; the reply is
     one or two sentences.
   - **Speech out:** `expo-speech` (system voice) to get it working, then Piper through
     `sherpa-onnx` if there is time. Eric picked the Piper voices: Kusal (male), Amy (female).
4. Rebuild the phone app (see "Running it" below). New native modules need
   `npx expo prebuild --platform ios` again.

### One known problem to solve first

On iPhone the microphone goes to one consumer at a time. Today the page reads the microphone
itself for tone of voice (`lib/voice/mic.ts`). When native speech recognition also wants it,
one of them will get silence. Simplest way out: when `listen` is on, skip the page's own
microphone and have the native side send the tone numbers (or drop tone for the weekend).
Nobody has tested this on a real phone.

### Rules for what Cheri may say (the system prompt must enforce these)

- One or two short sentences, then she stops. She ends the hello herself.
- She is a tool, not a therapist and not a friend, and says so if asked.
- No advice, no diagnosis words, no percentages or scores, no guilt ("I missed you").
- Sensor readings are worded as observations against the person's own usual, never as a
  feeling. Only the person's own words say how they feel.
- English only.

## Part 2: your trained face model

### The socket

`lib/camera/faceModel.ts`. Implement this and return it from `createFaceModel()` at the
bottom of the file. Nothing else needs to change.

```ts
interface FaceModel {
  readonly name: string;              // new name, e.g. "filip-v1"
  init(): Promise<void>;              // load files from public/models/
  read(input: FaceInput): FaceReadings | null;
  dispose(): void;
}
```

Per analysed frame you get: the time `t`, the video frame (if your model reads pixels),
MediaPipe's 478 landmarks, and its 52 blendshape scores (if your model reads numbers).

You return **named numbers** and a confidence from 0 to 1:

```ts
{ readings: { animation: 62, smilingShare: 0.18 }, confidence: 0.8 }
```

### Rules

- Numbers only. Never a label such as "sad", never a picture, nothing of the frame kept.
  The app turns numbers into words only by comparing with this person's own usual.
- Runs on the device, no network. The phone shows the web interface, so the model runs in
  the page: export to **ONNX** (run with `onnxruntime-web`) or **TFLite / TensorFlow.js**.
  A PyTorch or Keras file cannot be used as it is.
- Put the files in `public/models/`. Add the runtime as a dependency when you add the model.
- Give it a new `name`. Readings from different models are never mixed in the person's usual,
  so a new name starts a fresh 14-day learning period (the demo data can be regenerated).
- Keep it small and fast: it runs beside MediaPipe on a phone during a 40-second moment.

### What I need to know from you, if you want help wiring it

The file format, the input (size, colour order, or which landmarks), the names and ranges of
the outputs, and how long one frame takes.

### Your branch

`origin/ml/validation` (smile threshold checked on 4,500 faces, `SMILE_ON` 0.5 to 0.35) is
**not merged**. It touches `lib/camera/expression.ts`, `scripts/test-camera.mts` and
`docs/PROJECT.md`. `main` has moved a lot since; rebase it on `main` before merging.

## Running it

Web interface (fastest loop, works for Part 2 in a desktop browser with a webcam):

```bash
pnpm install
pnpm dev          # http://localhost:3470, the hello is at /hello
```

Phone app, simulator (reads the web interface from the dev server):

```bash
cd mobile && npm install && npx expo run:ios
```

Phone app on a real iPhone (needed for camera, microphone and speech; the simulator has no
camera). On macOS set `export LANG=en_US.UTF-8` first, or CocoaPods crashes.

```bash
pnpm build
cd mobile && npm run web:copy -- --build
npx expo prebuild --platform ios
open ios/CheerPressure.xcworkspace   # choose your Team, Release configuration, Run
```

A Debug build on a real phone shows "could not open the web dev server": use Release, which
carries the web interface inside the app. More in `mobile/README.md`.

Checks before you push: `pnpm test`, `pnpm lint`, `pnpm build`.

## State of things, honestly

- Verified by automated checks only: the hello flow, the fallbacks, the layout.
- One known red check: the wording when the camera is refused on `/hello` reads "Camera
  starting". Old, small, not fixed.
- Not tried by a person on a real phone: camera and microphone in the hello, sound, real
  sleep data. Dante has the app on his iPhone since 00:14 and is trying it now.
- Not built: everything in "Part 1, the phone side".

## If time runs out

Order of value for the demo: (1) `speak`, so Cheri is heard; (2) `listen`, so the person's
words appear; (3) your face model; (4) `converse` with a local model. With only 1 and 2 the
hello already feels like a conversation, using the pre-written replies.

Questions: ask Dante, or open the repository with Claude and point it at this file.
