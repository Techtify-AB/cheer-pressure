"""Stage interfaces (STT / LLM / TTS) and adapters registered by name.

Add a model: write a class with the right method, decorate it with
@register("stt"|"llm"|"tts", "name"), and point config.toml at it.
Heavy imports live inside adapter constructors so unused adapters cost nothing.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, Iterator, Protocol

import numpy as np

STT_RATE = 16_000


class STT(Protocol):
    def transcribe(self, samples: np.ndarray) -> str: ...


class LLM(Protocol):
    def stream(self, system: str, user: str, history: list[dict] | None = None) -> Iterator[str]: ...


class TTS(Protocol):
    sample_rate: int

    def synthesize(self, text: str) -> Iterator[np.ndarray]: ...


_REGISTRY: dict[str, dict[str, Callable]] = {"stt": {}, "llm": {}, "tts": {}}


def register(kind: str, name: str):
    def deco(cls):
        _REGISTRY[kind][name] = cls
        return cls
    return deco


def build(kind: str, cfg: dict):
    """Instantiate the adapter named cfg['adapter'] with the remaining keys as kwargs."""
    cfg = dict(cfg)
    name = cfg.pop("adapter")
    if name not in _REGISTRY[kind]:
        raise KeyError(f"unknown {kind} adapter {name!r}; have {sorted(_REGISTRY[kind])}")
    return _REGISTRY[kind][name](**cfg)


# ----------------------------------------------------------------------------- STT

@register("stt", "parakeet_mlx")
class ParakeetMLX:
    def __init__(self, model: str = "mlx-community/parakeet-tdt-0.6b-v3"):
        import mlx.core as mx
        from parakeet_mlx import from_pretrained
        self._mx = mx
        self.model = from_pretrained(model)

    def transcribe(self, samples: np.ndarray) -> str:
        from parakeet_mlx.audio import get_logmel
        mx = self._mx
        audio = mx.array(np.asarray(samples, dtype=np.float32))
        if audio.shape[0] < self.model.preprocessor_config.hop_length:
            return ""
        mel = get_logmel(audio, self.model.preprocessor_config)
        return self.model.generate(mel)[0].text.strip()


@register("stt", "whisper_mlx")
class WhisperMLX:
    def __init__(self, model: str = "mlx-community/whisper-large-v3-turbo"):
        self.model = model

    def transcribe(self, samples: np.ndarray) -> str:
        import mlx_whisper
        out = mlx_whisper.transcribe(np.asarray(samples, dtype=np.float32), path_or_hf_repo=self.model,
                                     language="en", condition_on_previous_text=False, fp16=True)
        return out["text"].strip()


# ----------------------------------------------------------------------------- LLM

@register("llm", "openai_compat")
class OpenAICompat:
    """Streaming /chat/completions client. Works with Ollama, LM Studio, hosted APIs.

    extra_body is merged into the request (Ollama: {"reasoning_effort": "none"} turns
    Qwen3.5 thinking off; "think": false is ignored on the /v1 route).
    ollama_keep_alive: if set (e.g. "30m"), a thread pings Ollama's native API so the
    model stays loaded (the /v1 route ignores keep_alive).
    """

    def __init__(self, base_url: str = "http://localhost:11434/v1", model: str = "qwen3.5:9b",
                 api_key: str = "", max_tokens: int = 80, temperature: float = 0.6,
                 extra_body: dict | None = None, ollama_keep_alive: str = "", timeout: float = 120.0):
        import httpx
        self.model, self.max_tokens, self.temperature = model, max_tokens, temperature
        self.extra_body = extra_body or {}
        self.url = base_url.rstrip("/") + "/chat/completions"
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self.http = httpx.Client(headers=headers, timeout=timeout)
        self.keep_alive = ollama_keep_alive
        self._native = base_url.rstrip("/").removesuffix("/v1")
        if self.keep_alive:
            self._ping()
            threading.Thread(target=self._ping_loop, daemon=True).start()

    def _ping(self) -> None:
        try:
            self.http.post(self._native + "/api/generate",
                           json={"model": self.model, "keep_alive": self.keep_alive})
        except Exception:
            pass

    def _ping_loop(self) -> None:
        while True:
            time.sleep(120)
            self._ping()

    def stream(self, system: str, user: str, history: list[dict] | None = None) -> Iterator[str]:
        """history: earlier chat turns as [{"role": "user"|"assistant", "content": str}]."""
        body = {"model": self.model, "stream": True, "max_tokens": self.max_tokens,
                "temperature": self.temperature,
                "messages": [{"role": "system", "content": system}, *(history or []),
                             {"role": "user", "content": user}],
                **self.extra_body}
        with self.http.stream("POST", self.url, json=body) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    return
                delta = json.loads(data)["choices"][0].get("delta", {})
                # Reasoning tokens (if a server emits them) are ignored on purpose.
                if delta.get("content"):
                    yield delta["content"]


# ----------------------------------------------------------------------------- TTS

@register("tts", "say")
class Say:
    """macOS `say` rendered to a temp WAV. Not streaming: first audio = full render time."""

    sample_rate = 22_050

    def __init__(self, voice: str = "Samantha", rate_wpm: int = 190):
        self.voice, self.rate = voice, rate_wpm

    def synthesize(self, text: str) -> Iterator[np.ndarray]:
        import soundfile as sf
        with tempfile.TemporaryDirectory() as d:
            out = Path(d) / "s.wav"
            subprocess.run(["say", "-v", self.voice, "-r", str(self.rate), "-o", str(out),
                            "--file-format=WAVE", f"--data-format=LEF32@{self.sample_rate}", "--", text],
                           check=True, capture_output=True)
            audio, sr = sf.read(out, dtype="float32")
        assert sr == self.sample_rate
        yield audio.reshape(-1)


@register("tts", "kokoro")
class Kokoro:
    """Kokoro-82M via mlx-audio (safetensors build; yields one chunk per internal segment)."""

    sample_rate = 24_000

    def __init__(self, model: str = "mlx-community/Kokoro-82M-bf16", voice: str = "af_heart",
                 speed: float = 1.0, lang_code: str = "a"):
        from mlx_audio.tts.utils import load_model
        self.model = load_model(model)
        self.voice, self.speed, self.lang = voice, speed, lang_code

    def synthesize(self, text: str) -> Iterator[np.ndarray]:
        for r in self.model.generate(text=text, voice=self.voice, speed=self.speed, lang_code=self.lang):
            yield np.asarray(r.audio, dtype=np.float32).reshape(-1)


@register("tts", "phonon")
class Phonon:
    """Gradium Phonon (ptts, Rust runtime, streams frame by frame)."""

    def __init__(self, model: str = "", voice: str = "", lang: str = "en"):
        import ptts
        self.tts = ptts.TTS(model, lang=lang) if model else ptts.TTS(lang=lang)
        self.voice = voice or None
        self.sample_rate = int(self.tts.sample_rate)

    def synthesize(self, text: str) -> Iterator[np.ndarray]:
        kw = {"voice": self.voice} if self.voice else {}
        with self.tts.stream(text, **kw) as audio:
            for chunk in audio:
                yield np.asarray(chunk, dtype=np.float32).reshape(-1)


@register("tts", "pocket")
class Pocket:
    """Kyutai Pocket-TTS (CPU, streaming)."""

    def __init__(self, voice: str = "alba", language: str = ""):
        from pocket_tts import TTSModel
        self.model = TTSModel.load_model(language) if language else TTSModel.load_model()
        self.state = self.model.get_state_for_audio_prompt(voice)
        self.sample_rate = int(self.model.sample_rate)

    def synthesize(self, text: str) -> Iterator[np.ndarray]:
        for chunk in self.model.generate_audio_stream(self.state, text):
            yield chunk.detach().cpu().numpy().astype(np.float32).reshape(-1)
