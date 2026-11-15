# Services that run beside the app (Filip)

Two small Python services. Neither is needed for the app to work; without them the hello falls back to one tap and the pre-written lines.

## `voice/`: the spoken hello on a laptop (macOS, Apple Silicon)
Answers the four requests in `lib/phoneBridge.ts` (`listen.start`, `listen.stop`, `converse`, `speak`) over HTTP on `127.0.0.1:8766`.
Microphone → Parakeet (speech to text) → Gemma 4 E4B via Ollama (reply) → Pocket TTS (voice). Everything runs on the laptop; nothing is sent anywhere.

```bash
brew install ollama && ollama serve &          # if Ollama is not running yet
ollama pull gemma4:e4b-it-qat                  # 6 GB, once
cd services/voice && uv sync                   # Python via uv (https://docs.astral.sh/uv/)
uv run python -m talk --config config.toml     # first start downloads the speech models (about 1.5 GB)
# second terminal, repo root:
NEXT_PUBLIC_VOICE_URL=http://127.0.0.1:8766 pnpm dev
# open http://localhost:3470/hello/  (or "Say hello out loud" on Home). Enter = start / stop talking.
```
- **Profile:** `config.toml` → `profile = "strict"` follows `docs/HANDOVER_FILIP.md` (one or two sentences, no advice). `"helpful"` is Filip's variant: up to three sentences, may offer one thing that helped before. Same safety rules in both.
- **Measured** (synthetic speech, M4 Max): button release → first audio about 0.3 s p50 in strict, 0.7 s in helpful; Filip's real voice: about 1.0 s. Details: `voice/evals/RESULTS.md`.
- **Without the page:** `uv run python -m talk.chat --profile strict` (Enter to talk, Enter to stop). Stop the server first; both use the microphone.
- **Camera:** the page's own camera reading reaches the model only as `context.observation` (one sentence against the person's usual). Optionally the service also reads the Arduino board's face feed (`face_feed_url`), as one behaviour sentence.

## `board/`: face feed on the Arduino UNO Q (reference)
Camera → face → 8 MB expression model + MediaPipe blendshapes → per-minute summaries → JSON on port 8765 (`/events`, `/context`, `/history`, `/face`). Typed client: `lib/face/feed.ts` (PR #2).
The model weights are not in this repository (licence and size), so `deploy.sh` runs only from Filip's machine. Explained step by step in Filip's ML notes.
