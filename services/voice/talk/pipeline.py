"""Engine: STT -> guarded LLM with speculative TTS -> playback, plus per-turn tracing."""
from __future__ import annotations

import json
import queue
import re
import threading
import time
import tomllib
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import numpy as np

from . import face as face_mod
from .prompt import SYSTEMS, history_messages, is_final_turn, user_message
from .rules import check
from .stages import build

ROOT = Path(__file__).resolve().parent.parent
_SENT_END = re.compile(r"(?<=[.!?])\s+")


def load_config(path: str | Path) -> dict:
    path = Path(path)
    with open(path, "rb") as f:
        cfg = tomllib.load(f)
    cfg.setdefault("service", {})
    cfg["name"] = path.stem
    return cfg


# ------------------------------------------------------------------------- tracing

@dataclass
class Turn:
    """Monotonic timestamps (seconds, time.perf_counter) for every stage of one turn."""
    config: str = ""
    t: dict[str, float] = field(default_factory=dict)
    meta: dict = field(default_factory=dict)
    jobs: list = field(default_factory=list, repr=False)  # AudioJobs of the accepted reply

    def mark(self, name: str) -> float:
        self.t[name] = time.perf_counter()
        return self.t[name]

    def _d(self, a: str, b: str) -> float | None:
        if a in self.t and b in self.t:
            return round((self.t[b] - self.t[a]) * 1000, 1)
        return None

    def metrics(self) -> dict:
        if self.jobs and self.jobs[0].t_first and self.jobs[0].t_start:
            self.t["tts_start"], self.t["tts_first_audio"] = self.jobs[0].t_start, self.jobs[0].t_first
        m = {
            "stt_ms": self._d("stt_start", "stt_end"),
            "llm_ttft_ms": self._d("llm_start", "llm_first_token"),
            "llm_total_ms": self._d("llm_start", "llm_end"),
            "tts_first_audio_ms": self._d("tts_start", "tts_first_audio"),
            "release_to_first_audio_ms": self._d("release", "play_start"),
        }
        return m

    def to_json(self) -> str:
        return json.dumps({"ts": datetime.now().isoformat(timespec="milliseconds"), "config": self.config,
                           **self.metrics(), **self.meta,
                           "t_monotonic": {k: round(v, 4) for k, v in self.t.items()}}, ensure_ascii=False)


# ------------------------------------------------------------------------- speculative TTS

class AudioJob:
    """Audio for one sentence, filled by the TTS worker, consumed (while filling) by playback."""

    def __init__(self, text: str):
        self.text = text
        self.chunks: list[np.ndarray] = []
        self.sample_rate = 0
        self.done = threading.Event()
        self.error: Exception | None = None
        self.t_start: float | None = None
        self.t_first: float | None = None
        self._cv = threading.Condition()

    def push(self, chunk: np.ndarray) -> None:
        with self._cv:
            if self.t_first is None:
                self.t_first = time.perf_counter()
            self.chunks.append(chunk)
            self._cv.notify_all()

    def finish(self, err: Exception | None = None) -> None:
        with self._cv:
            self.error = err
            self.done.set()
            self._cv.notify_all()

    def iter_chunks(self):
        i = 0
        while True:
            with self._cv:
                while i >= len(self.chunks) and not self.done.is_set():
                    self._cv.wait(0.05)
                if i < len(self.chunks):
                    c = self.chunks[i]
                else:
                    return
            i += 1
            yield c

    def wait_first(self, timeout: float = 30.0) -> float | None:
        """Block until first chunk (or done); return its timestamp."""
        end = time.perf_counter() + timeout
        with self._cv:
            while self.t_first is None and not self.done.is_set() and time.perf_counter() < end:
                self._cv.wait(0.02)
        return self.t_first


class Reply:
    """A guarded reply plus the speculative audio jobs rendered for it."""

    def __init__(self, text: str, jobs: list[AudioJob], attempts: int, violations: list[str]):
        self.text, self.jobs, self.attempts, self.violations = text, jobs, attempts, violations


class Engine:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        svc = cfg["service"]
        self.stt = build("stt", cfg["stt"])
        self.llm = build("llm", cfg["llm"])
        self.tts = build("tts", cfg["tts"])
        self.face_url = svc.get("face_feed_url", "")
        self.profile = svc.get("profile", "strict")
        self.trace_dir = ROOT / svc.get("trace_dir", "traces")
        self._jobs: queue.Queue[AudioJob | None] = queue.Queue()
        self._cache: dict[str, Reply] = {}
        threading.Thread(target=self._tts_worker, daemon=True).start()

    # ---- TTS worker: one thread, because TTS models are not thread-safe
    def _tts_worker(self) -> None:
        while True:
            job = self._jobs.get()
            if job is None:
                return
            job.t_start = time.perf_counter()
            job.sample_rate = self.tts.sample_rate
            try:
                for chunk in self.tts.synthesize(job.text):
                    job.push(chunk)
                job.finish()
            except Exception as e:  # noqa: BLE001
                job.finish(e)

    def submit_tts(self, text: str) -> AudioJob:
        job = AudioJob(text)
        self._jobs.put(job)
        return job

    # ---- stages
    def transcribe(self, samples: np.ndarray, turn: Turn | None = None) -> str:
        if turn:
            turn.mark("stt_start")
        text = self.stt.transcribe(samples)
        if turn:
            turn.mark("stt_end")
        return text

    def _generate(self, system: str, user: str, history: list[dict], turn: Turn,
                  first: bool) -> tuple[str, list[AudioJob]]:
        """Stream the LLM; hand each finished sentence to the TTS worker immediately."""
        buf, text_parts, jobs = "", [], []
        if first:
            turn.mark("llm_start")
        for delta in self.llm.stream(system, user, history):
            if first and "llm_first_token" not in turn.t:
                turn.mark("llm_first_token")
            buf += delta
            parts = _SENT_END.split(buf)
            for sent in parts[:-1]:
                if sent.strip():
                    text_parts.append(sent.strip())
                    jobs.append(self.submit_tts(sent.strip()))
            buf = parts[-1]
        if buf.strip():
            text_parts.append(buf.strip())
            jobs.append(self.submit_tts(buf.strip()))
        return " ".join(text_parts).strip(), jobs

    def converse(self, text: str, context: dict | None, utterance_s: float = 6.0,
                 turn: Turn | None = None) -> Reply:
        turn = turn or Turn(self.cfg["name"])
        ctx = context or {}
        profile = ctx.get("profile") or self.profile
        help_ = ctx.get("help") if isinstance(ctx.get("help"), dict) else None
        help_given = bool(help_ and (help_.get("phrase") or help_.get("note")))
        history = ctx.get("history") if isinstance(ctx.get("history"), list) else None
        final_turn = profile == "helpful" and is_final_turn(history)
        face_sentence = face_mod.fetch_sentence(self.face_url, utterance_s)
        base = dict(text=text, answer=ctx.get("answer"), observation=ctx.get("observation"),
                    face_sentence=face_sentence, profile=profile, help=help_, opening=bool(ctx.get("opening")),
                    final_turn=final_turn)
        hist_msgs = history_messages(history)
        turn.meta.update(profile=profile, said=text, face_sentence=face_sentence, answer=ctx.get("answer"),
                         observation=ctx.get("observation"))
        turn.mark("converse_start")
        violations: list[str] = []
        reply, jobs, attempts = "", [], 0
        for attempt in range(2):
            attempts += 1
            user = user_message(**base, violations=violations or None)
            try:
                reply, jobs = self._generate(SYSTEMS[profile], user, hist_msgs, turn, first=(attempt == 0))
            except Exception as e:  # noqa: BLE001 - LLM down: let the page use its own line
                turn.meta["llm_error"] = repr(e)
                reply, jobs = "", []
                break
            turn.mark("llm_end")
            violations = check(reply, profile, help_given, final_turn)
            if attempt == 0:
                turn.meta.update(first_reply=reply, first_violations=violations)
            if not violations:
                break
        if violations:
            turn.meta["final_violations"] = violations
            reply, jobs = "", []
        turn.mark("converse_end")
        turn.meta.update(reply=reply, attempts=attempts, empty=(reply == ""))
        if jobs:
            turn.jobs = jobs
            r = Reply(reply, jobs, attempts, violations)
            self._cache[reply] = r
            while len(self._cache) > 16:
                self._cache.pop(next(iter(self._cache)))
            return r
        return Reply(reply, [], attempts, violations)

    def lookup(self, text: str) -> Reply | None:
        return self._cache.get(text.strip())

    def replay_jobs(self, text: str) -> tuple[list[AudioJob], bool]:
        """Jobs for /speak: the cached ones (hit) or fresh, sentence by sentence (miss)."""
        hit = self.lookup(text)
        if hit and not any(j.error for j in hit.jobs):
            return hit.jobs, True
        sents = [s.strip() for s in _SENT_END.split(text.strip()) if s.strip()]
        return [self.submit_tts(s) for s in sents], False

    # ---- measurement helper shared with the eval
    def first_audio_after(self, jobs: list[AudioJob]) -> float | None:
        return jobs[0].wait_first() if jobs else None

    def write_trace(self, turn: Turn) -> None:
        self.trace_dir.mkdir(parents=True, exist_ok=True)
        with open(self.trace_dir / f"{datetime.now():%Y%m%d}.jsonl", "a") as f:
            f.write(turn.to_json() + "\n")

    def warmup(self) -> dict:
        """Run each stage once so the first real turn is not slow."""
        out = {}
        t = time.perf_counter()
        self.stt.transcribe((np.random.randn(16000) * 0.01).astype(np.float32))
        out["stt_warm_ms"] = round((time.perf_counter() - t) * 1000)
        t = time.perf_counter()
        r = self.converse("Good morning.", {"answer": "good", "observation": None}, turn=Turn("warmup"))
        if r.jobs:
            r.jobs[-1].done.wait(30)
        out["llm_tts_warm_ms"] = round((time.perf_counter() - t) * 1000)
        self._cache.clear()
        return out
