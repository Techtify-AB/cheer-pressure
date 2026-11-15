"""HTTP service on 127.0.0.1:8766 implementing the phone-bridge voice contract."""
from __future__ import annotations

import argparse
import threading
import time

import numpy as np
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .pipeline import Engine, Turn, load_config

MIC_RATE = 16_000
MAX_RECORD_S = 60


class Recorder:
    """Mac microphone -> 16 kHz mono float32 while started."""

    def __init__(self) -> None:
        self._stream = None
        self._chunks: list[np.ndarray] = []
        self._lock = threading.Lock()

    def start(self) -> None:
        import sounddevice as sd
        with self._lock:
            if self._stream is not None:
                return
            self._chunks = []
            self._stream = sd.InputStream(samplerate=MIC_RATE, channels=1, dtype="float32",
                                          callback=self._cb)
            self._stream.start()

    def _cb(self, indata, frames, time_info, status) -> None:  # noqa: ARG002
        if sum(len(c) for c in self._chunks) < MAX_RECORD_S * MIC_RATE:
            self._chunks.append(indata[:, 0].copy())

    def stop(self) -> np.ndarray:
        with self._lock:
            s, self._stream = self._stream, None
            if s is not None:
                s.stop()
                s.close()
            out = np.concatenate(self._chunks) if self._chunks else np.zeros(0, np.float32)
            self._chunks = []
            return out


class Converse(BaseModel):
    text: str = ""  # empty only when context.opening is true (Cheri speaks first)
    context: dict | None = None


class Speak(BaseModel):
    text: str


def play(jobs, mute: bool) -> float | None:
    """Play AudioJobs in order as chunks arrive. Returns monotonic time of first sample queued."""
    first_t = None
    if mute:
        for j in jobs:
            j.done.wait(30)
        return jobs[0].wait_first() if jobs else None
    import sounddevice as sd
    stream = None
    try:
        for j in jobs:
            for c in j.iter_chunks():
                if stream is None:
                    stream = sd.OutputStream(samplerate=j.sample_rate, channels=1, dtype="float32")
                    stream.start()
                if first_t is None:
                    first_t = time.perf_counter()
                stream.write(np.ascontiguousarray(c.reshape(-1, 1)))
        if stream is not None:
            time.sleep(stream.latency)  # let the device buffer drain before closing
    finally:
        if stream is not None:
            stream.stop()
            stream.close()
    return first_t


def create_app(engine: Engine, mute: bool = False) -> FastAPI:
    svc = engine.cfg["service"]
    app = FastAPI(title="Cheri talk service")
    app.add_middleware(CORSMiddleware, allow_origins=[svc.get("cors_origin", "http://localhost:3470")],
                       allow_methods=["*"], allow_headers=["*"])
    rec = Recorder()
    state: dict = {"turn": None, "utt_s": 6.0}
    play_lock = threading.Lock()

    def flush_turn() -> None:
        t = state["turn"]
        if t is not None:
            engine.write_trace(t)
            state["turn"] = None

    @app.get("/health")
    def health():
        return {"ok": True, "config": engine.cfg["name"], "mute": mute}

    @app.get("/capabilities")
    def capabilities():
        return {"listen": True, "converse": True, "speak": True}

    @app.post("/listen/start")
    async def listen_start(request: Request):
        await request.body()
        flush_turn()
        rec.start()
        return {"ok": True}

    @app.post("/listen/stop")
    def listen_stop():
        turn = Turn(engine.cfg["name"])
        turn.mark("release")
        samples = rec.stop()
        state["utt_s"] = max(1.0, len(samples) / MIC_RATE)
        text = engine.transcribe(samples, turn) if len(samples) > 1600 else ""
        turn.meta.update(utterance_s=round(len(samples) / MIC_RATE, 2), transcript=text)
        flush_turn()
        state["turn"] = turn
        return {"text": text}

    @app.post("/converse")
    def converse(body: Converse):
        turn = state["turn"] or Turn(engine.cfg["name"])
        state["turn"] = turn
        r = engine.converse(body.text, body.context, state["utt_s"], turn)
        return {"text": r.text}

    @app.post("/speak")
    def speak(body: Speak):
        text = body.text.strip()
        turn = state["turn"] or Turn(engine.cfg["name"])
        if not text:
            return {"ok": True}
        jobs, hit = engine.replay_jobs(text)
        turn.meta["speak_cache_hit"] = hit
        with play_lock:
            first = play(jobs, mute)
        if first is not None:
            turn.t["play_start"] = first
        turn.meta["speak_muted"] = mute
        engine.write_trace(turn)
        state["turn"] = None
        return {"ok": True, "cache_hit": hit}

    return app


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.toml")
    ap.add_argument("--mute", action="store_true", help="synthesize but do not play audio")
    ap.add_argument("--face-feed-url", default=None)
    a = ap.parse_args()
    cfg = load_config(a.config)
    if a.face_feed_url is not None:
        cfg["service"]["face_feed_url"] = a.face_feed_url
    print(f"loading stages ({cfg['name']}) ...", flush=True)
    engine = Engine(cfg)
    print("warmup:", engine.warmup(), flush=True)
    uvicorn.run(create_app(engine, a.mute), host=cfg["service"].get("host", "127.0.0.1"),
                port=int(cfg["service"].get("port", 8766)), log_level="info")


if __name__ == "__main__":
    main()
