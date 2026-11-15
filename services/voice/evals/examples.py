"""Verbatim replies for the same 6 inputs, both profiles, text in (no STT/TTS).

  uv run python -m evals.examples --config configs/base_pocket.toml
Merges into evals/results/examples.json (rendered into RESULTS.md by evals.run).
"""
from __future__ import annotations

import argparse
import json

from evals import cases as cases_mod
from evals.run import RESULTS, write_results_md
from talk.pipeline import Engine, Turn, load_config

IDS = ["fine_obs", "h_walk_offer", "h_help_absent", "h_opening", "h_decline", "h_what_should_help"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    a = ap.parse_args()
    cfg = load_config(a.config)
    engine = Engine(cfg)
    engine.warmup()
    turns = {t["id"]: t for it in cases_mod.load("helpful") for t in it["turns"]}
    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / "examples.json"
    data = json.loads(path.read_text()) if path.exists() else {"inputs": [], "replies": {}}
    data["inputs"] = [{"id": i, "said": turns[i]["said"], "context": turns[i]["context"]} for i in IDS]
    per = data["replies"].setdefault(cfg["name"], {})
    for profile in ("strict", "helpful"):
        per[profile] = {}
        for i in IDS:
            t = turns[i]
            if profile == "strict" and t["context"].get("opening"):
                per[profile][i] = "(n/a: strict never speaks first)"
                continue
            r = engine.converse(t["said"], {**t["context"], "profile": profile}, turn=Turn(cfg["name"]))
            per[profile][i] = r.text
            print(f"[{cfg['name']}/{profile}/{i}] {r.text!r}", flush=True)
    path.write_text(json.dumps(data, indent=1, ensure_ascii=False))
    write_results_md()


if __name__ == "__main__":
    main()
