"""Case loading shared by make_audio / run / examples. A case is one utterance, or a scripted
dialogue (`turns`, the person's side only) which is flattened to ids `<id>.1`, `<id>.2`, ..."""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).parent
STRICT_FILES = ["cases.jsonl"]
HELPFUL_FILES = ["cases.jsonl", "cases_helpful.jsonl"]


def load(profile: str = "strict", only: list[str] | None = None) -> list[dict]:
    """Items are {"id", "turns": [ {id, said, context, must, must_not} ... ]} (one turn for plain cases)."""
    items = []
    for fn in (HELPFUL_FILES if profile == "helpful" else STRICT_FILES):
        for line in (HERE / fn).read_text().splitlines():
            if not line.strip():
                continue
            c = json.loads(line)
            if only and c["id"] not in only:
                continue
            if "turns" in c:
                turns = [{"id": f"{c['id']}.{i + 1}", **t} for i, t in enumerate(c["turns"])]
            else:
                turns = [{k: v for k, v in c.items()}]
            items.append({"id": c["id"], "turns": turns})
    return items


def all_turns() -> list[dict]:
    return [t for p in ("helpful",) for it in load(p) for t in it["turns"]]
