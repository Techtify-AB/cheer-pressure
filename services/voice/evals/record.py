"""Record a real utterance for a case: `uv run python -m evals.record <case_id> [seconds]`.

Shows the sentence to read, records from the Mac mic (16 kHz mono) until Enter (or `seconds`),
writes evals/audio/real/<id>.wav.
"""
import json
import sys
import threading
from pathlib import Path

import numpy as np
import sounddevice as sd
import soundfile as sf

HERE = Path(__file__).parent


def main() -> None:
    if len(sys.argv) < 2:
        ids = [json.loads(l)["id"] for l in (HERE / "cases.jsonl").read_text().splitlines()]
        sys.exit("usage: record.py <case_id> [seconds]\ncases: " + ", ".join(ids))
    cid = sys.argv[1]
    case = next((json.loads(l) for l in (HERE / "cases.jsonl").read_text().splitlines()
                 if json.loads(l)["id"] == cid), None)
    if case is None:
        sys.exit(f"unknown case {cid}")
    secs = float(sys.argv[2]) if len(sys.argv) > 2 else None
    print(f'Say: "{case["said"]}"')
    chunks: list[np.ndarray] = []
    stop = threading.Event()
    with sd.InputStream(samplerate=16000, channels=1, dtype="float32",
                        callback=lambda d, *_: chunks.append(d[:, 0].copy())):
        if secs:
            print(f"recording {secs}s ...")
            stop.wait(secs)
        else:
            input("recording... press Enter to stop ")
    out = HERE / "audio" / "real" / f"{cid}.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    audio = np.concatenate(chunks)
    sf.write(out, audio, 16000, subtype="PCM_16")
    print(f"wrote {out} ({len(audio) / 16000:.1f}s)")


if __name__ == "__main__":
    main()
