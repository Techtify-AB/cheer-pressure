"""Board runtime, audio side: mic -> speech detector -> speech-to-text -> POST to the face feed, which adds the face.

    python voice_stream.py --stt_dir ~/cheer-face/stt [--engine moonshine|whisper] [--wav test.wav]

How it works:
  1. arecord streams 16 kHz mono audio from the camera's microphone.
  2. Silero VAD (voice activity detector, 2 MB) cuts the stream into utterances: speech, then 0.6 s of silence.
  3. A small speech-to-text model turns each utterance into text (after it ends, not word by word).
  4. The text + start/end time go to face_stream.py on the same board (POST /speech), which attaches the face
     reading for exactly those seconds and publishes a `speech` event with a ready prompt for the language model.
No audio is stored or sent: only the text leaves this process.
"""
from __future__ import annotations

import argparse
import json
import queue
import subprocess
import threading
import time
import urllib.request
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx

RATE = 16000
CHUNK = 512            # 32 ms: the window Silero VAD expects
MIN_SPEECH_S = 0.4     # shorter sounds (clicks, coughs) are dropped
MAX_SPEECH_S = 20.0    # a longer monologue is cut into pieces


def recognizer(engine: str, d: Path, threads: int):
    if engine == "moonshine":
        m = d / "sherpa-onnx-moonshine-tiny-en-int8"
        return sherpa_onnx.OfflineRecognizer.from_moonshine(
            preprocessor=str(m / "preprocess.onnx"), encoder=str(m / "encode.int8.onnx"),
            uncached_decoder=str(m / "uncached_decode.int8.onnx"), cached_decoder=str(m / "cached_decode.int8.onnx"),
            tokens=str(m / "tokens.txt"), num_threads=threads)
    m = d / "sherpa-onnx-whisper-tiny.en"
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=str(m / "tiny.en-encoder.int8.onnx"), decoder=str(m / "tiny.en-decoder.int8.onnx"),
        tokens=str(m / "tiny.en-tokens.txt"), num_threads=threads)


def detector(d: Path):
    c = sherpa_onnx.VadModelConfig()
    c.silero_vad.model = str(d / "silero_vad.onnx")
    c.silero_vad.min_silence_duration = 0.6
    c.silero_vad.min_speech_duration = MIN_SPEECH_S
    c.silero_vad.max_speech_duration = MAX_SPEECH_S
    c.sample_rate = RATE
    return sherpa_onnx.VoiceActivityDetector(c, buffer_size_in_seconds=60)


def mic_chunks(device: str):
    """Yields (float32 chunk, wall time at its end). A reader thread keeps arecord drained while speech-to-text is busy."""
    proc = subprocess.Popen(["arecord", "-D", device, "-f", "S16_LE", "-r", str(RATE), "-c", "1", "-t", "raw", "-q"],
                            stdout=subprocess.PIPE)
    q: queue.Queue = queue.Queue()

    def pump():
        while True:
            b = proc.stdout.read(CHUNK * 2)
            if len(b) < CHUNK * 2:
                q.put(None)
                return
            q.put((np.frombuffer(b, np.int16).astype(np.float32) / 32768, time.time()))

    threading.Thread(target=pump, daemon=True).start()
    while (item := q.get()) is not None:
        yield item


def wav_chunks(path: str):
    with wave.open(path) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, "need 16 kHz mono 16-bit"
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
    x = np.concatenate([x, np.zeros(RATE, np.float32)])  # trailing silence closes the last utterance
    for i in range(0, len(x) - CHUNK + 1, CHUNK):
        yield x[i:i + CHUNK], (i + CHUNK) / RATE


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--stt_dir", default=str(Path.home() / "cheer-face" / "stt"))
    p.add_argument("--engine", choices=["moonshine", "whisper"], default="moonshine")
    p.add_argument("--device", default="plughw:0,0")
    p.add_argument("--threads", type=int, default=2)
    p.add_argument("--feed", default="http://127.0.0.1:8765/speech")
    p.add_argument("--wav", default=None, help="transcribe a 16 kHz mono wav instead of the mic (test); nothing is posted")
    a = p.parse_args()
    d = Path(a.stt_dir)
    rec, vad = recognizer(a.engine, d, a.threads), detector(d)
    print(f"listening ({a.engine})", flush=True)
    seen = 0
    for chunk, t_end in (wav_chunks(a.wav) if a.wav else mic_chunks(a.device)):
        vad.accept_waveform(chunk)
        seen += len(chunk)
        while not vad.empty():
            seg = vad.front
            samples, start = np.array(seg.samples, np.float32), seg.start
            vad.pop()
            dur = len(samples) / RATE
            t0 = t_end - (seen - start) / RATE
            tic = time.time()
            s = rec.create_stream()
            s.accept_waveform(RATE, samples)
            rec.decode_stream(s)
            text, stt_s = s.result.text.strip(), time.time() - tic
            if not text:
                continue
            ev = {"text": text, "t0": t0, "t1": t0 + dur, "stt_s": round(stt_s, 2), "words_per_s": round(len(text.split()) / dur, 2)}
            print(f"[{dur:.1f}s speech, {stt_s:.1f}s to transcribe] {text}", flush=True)
            if a.wav:
                continue
            try:
                req = urllib.request.Request(a.feed, json.dumps(ev).encode(), {"Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=3).read()
            except OSError as e:
                print(f"feed not reachable: {e}", flush=True)


if __name__ == "__main__":
    main()
