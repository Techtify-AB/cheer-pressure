"""Talk to Cheri from the terminal: Enter to start, Enter to stop, hear the reply (up to 3 turns).

  uv run python -m talk.chat --profile helpful --help-phrase "a short walk" --observation "Smiled less than your usual this week."
Stop the HTTP service first (or use another config port); both load the models.
"""
import argparse
import time

from .pipeline import Engine, Turn, load_config
from .server import MIC_RATE, Recorder, play


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="config.toml")
    ap.add_argument("--profile", choices=["strict", "helpful"], default=None)
    ap.add_argument("--help-phrase", default="")
    ap.add_argument("--help-note", default="")
    ap.add_argument("--observation", default=None)
    ap.add_argument("--answer", choices=["good", "okay", "not-so-good"], default=None)
    ap.add_argument("--opening", action="store_true", help="Cheri speaks first (helpful profile)")
    ap.add_argument("--turns", type=int, default=3)
    a = ap.parse_args()
    cfg = load_config(a.config)
    if a.profile:
        cfg["service"]["profile"] = a.profile
    engine = Engine(cfg)
    print("warming up ...", engine.warmup())
    rec, history = Recorder(), []
    ctx = {"answer": a.answer, "observation": a.observation}
    if a.help_phrase or a.help_note:
        ctx["help"] = {"phrase": a.help_phrase, "note": a.help_note}
    for i in range(a.turns):
        turn, text = Turn(cfg["name"]), ""
        if i == 0 and a.opening:
            ctx["opening"] = True
        else:
            input(f"\n[turn {i + 1}/{a.turns}] press Enter and talk ... ")
            rec.start()
            input("recording, press Enter to stop ")
            turn.mark("release")
            samples = rec.stop()
            text = engine.transcribe(samples, turn)
            ctx.pop("opening", None)
            print(f"you: {text!r}")
            if not text:
                print("(heard nothing)")
                continue
        reply = engine.converse(text, {**ctx, "history": history}, max(1.0, len(text.split()) / 2.5), turn)
        print(f"Cheri: {reply.text!r}" if reply.text else "Cheri: (guard failed twice: the page would use its own line)")
        jobs, _ = engine.replay_jobs(reply.text) if reply.text else ([], False)
        first = play(jobs, mute=False)
        if first and "release" in turn.t:
            turn.t["play_start"] = first
        print("timings:", {k: v for k, v in turn.metrics().items() if v is not None},
              "attempts", reply.attempts)
        history += [{"role": "person", "text": text}, {"role": "cheri", "text": reply.text}]
        history = [h for h in history if h["text"]][-4:]
        engine.write_trace(turn)


if __name__ == "__main__":
    main()
