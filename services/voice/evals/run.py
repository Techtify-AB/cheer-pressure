"""Headless eval: wav -> STT -> converse (same code path as the server, guard + speculative TTS)
-> TTS until first audio chunk. No mic, no speakers.

  uv run python -m evals.run --config configs/baseline.toml --runs 3
"""
from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

import jiwer
import numpy as np
import soundfile as sf

from evals import cases as cases_mod
from talk.pipeline import Engine, Turn, load_config
from talk.prompt import is_final_turn
from talk.rules import check

HERE = Path(__file__).parent
RESULTS = HERE / "results"

_NORM = jiwer.Compose([jiwer.ToLowerCase(), jiwer.RemovePunctuation(), jiwer.RemoveMultipleSpaces(),
                       jiwer.Strip(), jiwer.ReduceToListOfListOfWords()])


def wer(ref: str, hyp: str) -> float | None:
    if not ref.strip():
        return None
    return float(jiwer.wer(ref, hyp, reference_transform=_NORM, hypothesis_transform=_NORM))


def wav_inputs(case: dict, voices: list[str] | None) -> list[tuple[str, Path]]:
    out = []
    for p in sorted((HERE / "audio" / "synthetic").glob(f"{case['id']}__*.wav")):
        v = p.stem.split("__", 1)[1]
        if not voices or v in voices:
            out.append((v, p))
    real = HERE / "audio" / "real" / f"{case['id']}.wav"
    if real.exists() and (not voices or "real" in voices):
        out.append(("real", real))
    return out


def regex_failures(case: dict, reply: str) -> list[str]:
    f = [f"must_not: {rx}" for rx in case.get("must_not", []) if re.search(rx, reply)]
    f += [f"must: {rx}" for rx in case.get("must", []) if not re.search(rx, reply)]
    return f


def pct(xs: list[float], q: float) -> float | None:
    xs = [x for x in xs if x is not None]
    return round(float(np.percentile(xs, q)), 1) if xs else None


def stat(rows: list[dict], key: str) -> dict:
    xs = [r[key] for r in rows if r.get(key) is not None]
    return {"p50": pct(xs, 50), "p95": pct(xs, 95), "n": len(xs)}


def run_turn(engine: Engine, case: dict, voice: str, wav: Path | None, run: int, profile: str,
             history: list[dict] | None = None) -> dict:
    turn = Turn(engine.cfg["name"])
    if wav is None:  # Cheri speaks first: no utterance
        samples, heard = np.zeros(0, np.float32), ""
    else:
        samples, sr = sf.read(wav, dtype="float32")
        assert sr == 16000, f"{wav} must be 16 kHz"
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        heard = engine.transcribe(samples, turn)
    ctx = {**case["context"], "profile": profile}
    if history:
        ctx["history"] = [*case["context"].get("history", []), *history][-4:]
    reply = engine.converse(heard, ctx, len(samples) / 16000, turn)
    row = {"case": case["id"], "voice": voice, "run": run, "profile": profile, "said": case["said"], "heard": heard,
           "wer": wer(case["said"], heard), "reply": reply.text, "first_reply": turn.meta.get("first_reply", ""),
           "attempts": reply.attempts, "empty": reply.text == ""}
    if reply.jobs:
        first = reply.jobs[0].wait_first()
        engine.replay_jobs(reply.text)  # exercises the /speak cache lookup (hit expected)
        assert engine.lookup(reply.text) is not None
        m = turn.metrics()
        stt = m["stt_ms"] or 0.0  # 0 for an opening turn (no utterance)
        t0 = turn.t["converse_start"]
        row["e2e_first_audio_ms"] = round(stt + (first - t0) * 1000, 1) if first else None
        row["e2e_contract_ms"] = round(stt + (max(turn.t["converse_end"], first or 0) - t0) * 1000, 1)
        for j in reply.jobs:
            j.done.wait(60)
        row.update(m)
    else:
        row.update(turn.metrics())
        row["e2e_first_audio_ms"] = row["e2e_contract_ms"] = None
    help_given = bool((case["context"].get("help") or {}).get("phrase") or (case["context"].get("help") or {}).get("note"))
    final_turn = profile == "helpful" and is_final_turn(ctx.get("history"))
    rc = lambda r: check(r, profile, help_given, final_turn) + regex_failures(case, r)  # noqa: E731
    row["first_try_violations"] = rc(row["first_reply"])
    row["final_violations"] = [] if row["empty"] else rc(reply.text)
    return row


def summarize(rows: list[dict]) -> dict:
    n = len(rows)
    non_empty = [r for r in rows if not r["empty"]]
    s = {
        "n_turns": n,
        "profile": rows[0]["profile"],
        "wer_mean": round(float(np.mean([r["wer"] for r in rows if r["wer"] is not None])), 4),
        "wer_by_voice": {v: round(float(np.mean([r["wer"] for r in rows if r["voice"] == v and r["wer"] is not None])), 4)
                         for v in sorted({r["voice"] for r in rows if r["wer"] is not None})},
        "rule_pass_rate": round(sum(1 for r in non_empty if not r["final_violations"]) / n, 3),
        "first_try_pass_rate": round(sum(1 for r in rows if not r["first_try_violations"]) / n, 3),
        "empty_replies": sum(r["empty"] for r in rows),
        "retries": sum(r["attempts"] > 1 for r in rows),
    }
    for k in ["stt_ms", "llm_ttft_ms", "llm_total_ms", "tts_first_audio_ms", "e2e_first_audio_ms",
              "e2e_contract_ms"]:
        s[k] = stat(rows, k)
    return s


def fmt(d: dict) -> str:
    return f"{d['p50']:.0f}/{d['p95']:.0f}" if d["p50"] is not None else "-"


def write_results_md() -> str:
    cols = ["config", "profile", "STT", "LLM", "TTS", "turns", "WER", "stt ms", "llm ttft", "llm total", "tts 1st audio",
            "release->1st audio (streamed)", "release->1st audio (contract)", "rule pass", "1st-try pass",
            "empty"]
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for p in sorted(RESULTS.glob("*.json")):
        if p.name == "examples.json":
            continue
        r = json.loads(p.read_text())
        s, c = r["summary"], r["config"]
        lines.append("| " + " | ".join([
            r["name"], s.get("profile", "strict"), c["stt"].get("model", c["stt"]["adapter"]).split("/")[-1],
            c["llm"]["model"], c["tts"]["adapter"] + (f":{c['tts'].get('voice')}" if c["tts"].get("voice") else ""),
            str(s["n_turns"]), f"{s['wer_mean'] * 100:.1f}%", fmt(s["stt_ms"]), fmt(s["llm_ttft_ms"]),
            fmt(s["llm_total_ms"]), fmt(s["tts_first_audio_ms"]), fmt(s["e2e_first_audio_ms"]),
            fmt(s["e2e_contract_ms"]), f"{s['rule_pass_rate'] * 100:.0f}%", f"{s['first_try_pass_rate'] * 100:.0f}%",
            str(s["empty_replies"])]) + " |")
    table = "\n".join(lines)
    header = """# Eval results

All times in ms as **p50/p95**, measured on this Mac (M4 Max, 64 GB) by `evals/run.py`, warm models.

**Read this first**
- Input audio is mostly **synthetic macOS `say`** speech. It is cleaner and easier than a real voice, so WER here
  is a lower bound; real WER will be higher. Real recordings (`evals/record.py`) are included automatically when present.
- **Playback device latency is not included**: times stop when the first TTS audio chunk exists in memory
  (add roughly 20-100 ms for the audio output buffer).
- `release->1st audio (streamed)` = STT + time from start of `/converse` to the first TTS chunk of the first sentence
  (what a page could achieve if it played while the LLM streams).
  `release->1st audio (contract)` = STT + the full `/converse` (LLM + guard), then `/speak` hits the speculative cache:
  what the current non-streaming page contract really gives.
- `rule pass` = turns whose final reply is non-empty and passes `rules.py` plus the case regexes (empty fallback counts as not passing here;
  see `empty`). `1st-try pass` = same check on the first LLM attempt, i.e. what the guard would see.
- LLM judgement of reply quality is not measured; only the deterministic rules are.

"""
    ex = RESULTS / "examples.json"
    examples = render_examples(json.loads(ex.read_text())) if ex.exists() else ""
    (HERE / "RESULTS.md").write_text(header + table + "\n" + examples)
    return table


def render_examples(data: dict) -> str:
    """Verbatim replies for the same inputs, one table per input, one row per config and profile."""
    out = ["\n\n## Example replies (verbatim, same inputs, one sample each, temperature 0.6)\n"]
    for item in data["inputs"]:
        ctx = {k: v for k, v in item["context"].items() if k != "history"}
        out.append(f"\n**{item['id']}**: said `{item['said'] or '(Cheri speaks first)'}`; context `{json.dumps(ctx)}`"
                   + (f"; history `{json.dumps(item['context']['history'])}`" if item["context"].get("history") else "")
                   + "\n\n| config | strict | helpful |\n|---|---|---|")
        for cfg, per in data["replies"].items():
            cell = lambda p: (per[p].get(item["id"], "") or "(empty: page fallback)").replace("|", "/").replace("\n", " ")  # noqa: E731
            out.append(f"| {cfg} | {cell('strict')} | {cell('helpful')} |")
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", required=True)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--voices", nargs="*", help="subset of voices (Samantha Daniel Karen real)")
    ap.add_argument("--cases", nargs="*", help="subset of case ids")
    ap.add_argument("--profile", choices=["strict", "helpful"], default="strict")
    a = ap.parse_args()
    cfg = load_config(a.config)
    if a.profile == "helpful":
        cfg["name"] += "__helpful"
    cfg["service"]["trace_dir"] = "traces"
    cfg["service"]["profile"] = a.profile
    t = time.perf_counter()
    engine = Engine(cfg)
    print(f"[{cfg['name']}] loaded in {time.perf_counter() - t:.1f}s; warmup {engine.warmup()}", flush=True)
    items = cases_mod.load(a.profile, a.cases)
    rows = []
    for run in range(a.runs):
        for item in items:
            # a dialogue is replayed once per voice; Cheri's real replies become the history
            first = item["turns"][0]
            voices = ["text"] if not first["said"].strip() else [v for v, _ in wav_inputs(first, a.voices)]
            for voice in voices:
                history: list[dict] = []
                for t in item["turns"]:
                    wav = None if voice == "text" else dict(wav_inputs(t, a.voices)).get(voice)
                    if wav is None and voice != "text":
                        continue
                    row = run_turn(engine, t, voice, wav, run, a.profile, history)
                    rows.append(row)
                    history += [{"role": "person", "text": row["heard"]}, {"role": "cheri", "text": row["reply"]}]
                    history = [h for h in history if h["text"]][-4:]
        print(f"  run {run + 1}/{a.runs} done ({len(rows)} turns)", flush=True)
    summary = summarize(rows)
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"{cfg['name']}.json").write_text(json.dumps(
        {"name": cfg["name"], "config": {k: cfg[k] for k in ("stt", "llm", "tts")}, "summary": summary,
         "rows": rows}, indent=1, ensure_ascii=False))
    print(json.dumps(summary, indent=1))
    print(write_results_md())


if __name__ == "__main__":
    main()
