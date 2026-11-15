"""Render each case's `said` to 16 kHz mono wav with macOS `say` (several voices).

Output: evals/audio/synthetic/<id>__<voice>.wav. Real recordings (evals/record.py) go to
evals/audio/real/<id>.wav and are picked up by run.py automatically.
"""
import subprocess
import sys
from pathlib import Path

from evals.cases import all_turns

HERE = Path(__file__).parent
VOICES = ["Samantha", "Daniel", "Karen"]


def main() -> None:
    out = HERE / "audio" / "synthetic"
    out.mkdir(parents=True, exist_ok=True)
    voices = sys.argv[1:] or VOICES
    for c in all_turns():
        if not c["said"].strip():
            continue  # opening turns: Cheri speaks first, no audio
        for v in voices:
            dst = out / f"{c['id']}__{v.replace(' ', '_')}.wav"
            if dst.exists():
                continue
            subprocess.run(["say", "-v", v, "-o", str(dst), "--file-format=WAVE", "--data-format=LEI16@16000",
                            "--", c["said"]], check=True)
    print("wrote", len(list(out.glob("*.wav"))), "files to", out)


if __name__ == "__main__":
    main()
