# Vendored: MediaPipe Tasks Vision, the lite pose model and the face model

Copied in by hand (no npm dependency), so the camera feature loads everything from the
app's own origin. Nothing here is fetched from a CDN at runtime. Fetched 2026-11-14.

## Files

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `vision_bundle.mjs` | 136,993 | `55d7ab624fbb70dcc5adc4ae6d7ea9cfcb569139d3dbfbf2b1deafcb966bc0fe` |
| `wasm/vision_wasm_internal.js` | 322,044 | `e7fd9858e8e8f221d9b96eddc11f8e077f263e0b7bbd79d3cbe882b134274f8c` |
| `wasm/vision_wasm_internal.wasm` | 11,153,617 | `6a5c64584c2ab61c763b6e204afbdbc7ce1caf7f5216187322bca8df94f646bc` |
| `../../models/pose_landmarker_lite.task` | 5,777,746 | `59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a` |
| `../../models/face_landmarker.task` | 3,758,596 | `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff` |
| `LICENSE` | 11,358 | Apache License 2.0, text from https://www.apache.org/licenses/LICENSE-2.0.txt |

The files are byte-for-byte as published; nothing was edited.

## Sources

- **Library:** npm package `@mediapipe/tasks-vision` **0.10.35** (published 2026-04-27),
  `https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-0.10.35.tgz`,
  integrity `sha512-HOvadwVRE6JC+45nyYhmnywnr5h/J8KZvOeUNVOG9q/0875pZgItznFB9bRTvLc264YSJqiZ1NsIpCStJw/egg==`.
  Taken from it: `vision_bundle.mjs` and `wasm/vision_wasm_internal.{js,wasm}`.
  Licence: Apache-2.0 (the package's `package.json`; the package ships no licence file, so
  the standard text is in `LICENSE` here).
- **Model:** `pose_landmarker_lite.task`, float16, version 1,
  `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
  (same file as `.../float16/latest/...` on 2026-11-14: ETag `04a75ddf7c811ac7a1a4523266dd7d88`,
  last modified 2023-04-27). Licence: Apache License 2.0, as stated in Google's model card
  "BlazePose GHUM 3D" (`https://storage.googleapis.com/mediapipe-assets/Model%20Card%20BlazePose%20GHUM%203D.pdf`).

- **Face model:** `face_landmarker.task`, float16, version 1 (face detector, face mesh and
  blendshapes in one bundle),
  `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`
  (same file as `.../float16/latest/...` on 2026-11-14: ETag `b0e7274907a1644404fef66b28dd6d85`,
  last modified 2023-05-03). Fetched 2026-11-14. Licence: Apache License 2.0, as stated in all
  three of Google's model cards: "MediaPipe BlazeFace (Short Range)", "MediaPipe Face Mesh V2"
  and "Blendshape V2" (`https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Blendshape%20V2.pdf`).
  Note from the Blendshape V2 card: intended for AR and avatars, "not intended for human
  life-critical decisions". This app uses only its blendshape numbers as behaviour (how much
  the face moves, raised mouth corners) compared with the person's own usual, never as a verdict.

## Why 0.10.35 and not the newest (1.2.3)

From **1.0.0** on, the library sends usage metrics to Google by itself: `vision_bundle.mjs`
1.0.0 and 1.2.3 contain a logger that POSTs to `https://odml.pa.googleapis.com/v1/log`
every 60 seconds, and its README says "MediaPipe Tasks APIs send metrics about the
performance and utilization of the APIs in your app to Google". That breaks this app's
promise that nothing leaves the device and no request goes to another origin. **0.10.35**
is the newest version without it (checked: no `odml.pa.googleapis.com` and no `fetch` other
than loading the model and a graph file). Do not upgrade past 0.10.x without checking this again.

## Not included

- `vision_wasm_nosimd_internal.*` (for browsers without WebAssembly SIMD, about 10 MB). Every
  current Chrome, Edge, Firefox and Safari 16.4 or newer (and so the macOS webview) has SIMD.
  Without it the camera screen says it could not start; nothing else breaks.
- `vision_wasm_module_internal.*` (the ES module variant of the loader, not used here).
- The source maps and type definitions. The types the app needs are written out in
  `lib/camera/pose.ts`.

## How it is loaded

`lib/camera/pose.ts` imports `/vendor/mediapipe/vision_bundle.mjs` with a dynamic `import()`
only when the person presses "Start the camera" (the bundler is told to leave it alone).
The library then adds `/vendor/mediapipe/wasm/vision_wasm_internal.js` as a script and
compiles the `.wasm`, and the models are fetched from `/models/pose_landmarker_lite.task` and
`/models/face_landmarker.task`. The same wasm serves both.
A content security policy needs `'wasm-unsafe-eval'` in `script-src` for the compile.
