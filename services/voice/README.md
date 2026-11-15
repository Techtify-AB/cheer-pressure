# talk: local voice conversation for Cheri

Fully local STT -> LLM -> TTS service plus an eval harness. Python via `uv`, own project (not part of `ml/pyproject.toml`).

```
uv sync
uv run pytest                                   # rules, face sentence, prompt
uv run python -m talk --config config.toml      # serve on 127.0.0.1:8766 (add --mute to skip playback)
```
Needs Ollama running with the model named in the config (`ollama pull gemma4:e4b-it-qat`).

## HTTP contract (CORS: http://localhost:3470)
| call | result |
|---|---|
| `GET /capabilities` | `{"listen":true,"converse":true,"speak":true}` |
| `POST /listen/start {}` / `POST /listen/stop {}` | mic on (16 kHz mono) / `{"text": "..."}` |
| `POST /converse {"text","context":{"answer","observation"}}` | `{"text": reply}`; `""` if the rules guard failed twice (page uses its own line) |
| `POST /speak {"text"}` | plays, returns when done. Cache hit if `text` is a reply `/converse` just produced |
| `GET /health` | status |

Speculative TTS: while the LLM streams, every finished sentence goes to the TTS worker; audio is cached by final reply text,
so `/speak` starts at once. Guard: `rules.check(reply)`; on violations one retry with the violations appended, else `""`.
Optional face feed: set `face_feed_url` (or `--face-feed-url`); 300 ms timeout, failure is ignored, only one behaviour sentence
(never labels or numbers) reaches the LLM. Per-turn timing: one JSON line per turn in `traces/`.

## Profiles and context
`profile = "strict" | "helpful"` in `[service]` (override per request with `context.profile`).
`strict`: 1-2 short sentences, never an offer. `helpful`: up to 3 sentences, one offer only when `context.help` is
`{"phrase","note"}`, multi-turn via `context.history` (`[{role: person|cheri, text}]`, last 4), Cheri speaks first when
`context.opening` is true and `text` is empty. Same deterministic safety rules in both (`rules.check(reply, profile, help_given, final_turn)`).
Terminal demo without the page: `uv run python -m talk.chat --profile helpful --help-phrase "a short walk"`.

## Stages (`talk/stages.py`)
- STT: `transcribe(samples: float32 16 kHz) -> str`. Adapters `parakeet_mlx`, `whisper_mlx`.
- LLM: `stream(system, user) -> iterator of text deltas`. Adapter `openai_compat` (Ollama, LM Studio, hosted).
  Ollama + Qwen3.5: thinking is off via `extra_body = { reasoning_effort = "none" }` (`think: false` is ignored on `/v1`).
- TTS: `sample_rate` + `synthesize(text) -> iterator of float32 chunks`. Adapters `say`, `kokoro`, `phonon`, `pocket`.

Add a model: write a class with that method, decorate with `@register("stt"|"llm"|"tts", "name")`, then create
`configs/<name>.toml` with `[stt]/[llm]/[tts]` `adapter = "name"` plus constructor args. For another LLM server only change
`base_url`/`model`/`api_key`.

## Evals
```
uv run python -m evals.make_audio                         # say -> evals/audio/synthetic (3 voices)
uv run python -m evals.record <case_id>                   # real voice -> evals/audio/real/<id>.wav (picked up automatically)
uv run python -m evals.run --config configs/base_pocket.toml --runs 3
```
Writes `evals/results/<config>.json` and regenerates `evals/RESULTS.md`. Cases: `evals/cases.jsonl`
(`id, said, context, must, must_not`). Synthetic audio is easier than a real voice; playback device latency is not included.
