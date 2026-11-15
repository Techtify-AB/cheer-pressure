"""What the rest of the system reads from the minute summaries. Pure stdlib, no camera.

- context():  compact JSON + one plain sentence for the speech/LLM pipeline to fuse with what the person said.
- checkin():  should the companion check in now? Compared with the person's OWN earlier minutes.
- history():  hourly/daily averages for the care team's report.
Wording rule: these describe facial expression, not a diagnosis.
"""
from __future__ import annotations

from statistics import median, quantiles

from aggregate import CLASSES, session_summary

WINDOW_MIN = 30          # check-in looks at the last 30 minutes ...
MIN_BASELINE = 120       # valid minutes of history before "own usual" is used
COOLDOWN_MIN = 120       # never ask twice within two hours


def _valid(minutes, t_from, t_to):
    return [m for m in minutes if m["valid"] and t_from <= m["t0"] < t_to]


def usual(minutes: list[dict], before: float, min_baseline: int = MIN_BASELINE) -> dict | None:
    """The person's own usual: 10th / 50th / 90th percentile of per-minute valence before `before`."""
    v = [m["valence_med"] for m in _valid(minutes, 0, before)]
    if len(v) < min_baseline:
        return None
    q = quantiles(v, n=10, method="inclusive")
    return {"n": len(v), "low": q[0], "median": median(v), "high": q[8]}


BASELINE_KEYS = ("valence_med", "smile_share", "variability", "blend.smile_share", "blend.animation")


def _pct(v: list[float]) -> dict | None:
    if len(v) < 2:
        return None
    q = quantiles(v, n=10, method="inclusive")
    return {"p10": q[0], "p50": median(v), "p90": q[8]}


def baseline(minutes: list[dict]) -> dict | None:
    """Summary of one person's valid minutes (their own usual). None if no valid minute. Facial expression only."""
    val = [m for m in minutes if m["valid"]]
    if not val:
        return None

    def get(m, k):
        if k.startswith("blend."):
            return (m.get("blend") or {}).get(k[6:])
        return m.get(k)

    out = {"n_minutes": len(minutes), "n_valid": len(val), "face_minutes": round(sum(m["face_s"] for m in val) / 60, 1)}
    for k in BASELINE_KEYS:
        out[k] = _pct([x for x in (get(m, k) for m in val) if x is not None])
    lab = [m["labels"] for m in val if m.get("labels")]
    out["labels"] = {c: sum(l[c] for l in lab) / len(lab) for c in CLASSES} if lab else None
    return out


def checkin(minutes: list[dict], now: float, last_checkin: float | None = None,
            window_min: int = WINDOW_MIN, min_baseline: int = MIN_BASELINE) -> dict | None:
    """-> {"reason", "text"} when the last `window_min` minutes sit clearly below the person's own usual, else None.

    There is no rule for a person without a baseline: a fixed cut-off fired on a normal concentrating face
    (measured on the board: 92% of frames "low" while simply working), so until `min_baseline` valid minutes
    exist the answer is always None.
    """
    if last_checkin is not None and now - last_checkin < COOLDOWN_MIN * 60:
        return None
    start = now - window_min * 60
    win = _valid(minutes, start, now + 1)
    if len(win) < max(2, window_min // 3):
        return None
    u = usual(minutes, start, min_baseline)
    if u is None:
        return None
    v = median(m["valence_med"] for m in win)
    if v >= u["low"]:
        return None
    return {"reason": "below-own-usual", "valence": round(v, 3), "usual_low": round(u["low"], 3),
            "text": f"For the last {window_min} minutes the face has been less positive than in 9 of 10 of this person's earlier minutes."}


def context(minutes: list[dict], now: float, live: dict | None = None, recent_min: int = 10) -> dict:
    """Snapshot for the language model. `live` is the latest smoothed frame: {"label", "confidence", "valence"} or None."""
    rec = _valid(minutes, now - recent_min * 60, now + 1)
    out = {"t": now, "now": live, "recent": None, "today": session_summary(_valid(minutes, now - 16 * 3600, now + 1)),
           "vs_usual": None, "text": "No face seen recently."}
    if not rec:
        if live:
            out["text"] = f"Face right now: {live['label'].lower()} ({live['confidence']:.0%}). Not enough minutes yet for a trend."
        return out
    labels = {c: sum(m["labels"][c] for m in rec if m["labels"]) / max(1, sum(1 for m in rec if m["labels"])) for c in CLASSES}
    top = sorted(labels.items(), key=lambda kv: -kv[1])[:2]
    v = median(m["valence_med"] for m in rec)
    smile = sum(m["smile_share"] for m in rec) / len(rec)
    out["recent"] = {"minutes": len(rec), "top": [[c, round(p, 2)] for c, p in top], "valence_med": round(v, 3),
                     "smile_share": round(smile, 3), "low_share": round(sum(m["low_share"] for m in rec) / len(rec), 3)}
    u = usual(minutes, now - recent_min * 60)
    text = (f"Face over the last {recent_min} min ({len(rec)} min seen): mostly {top[0][0].lower()} ({top[0][1]:.0%}), "
            f"then {top[1][0].lower()} ({top[1][1]:.0%}). Smiling {smile:.0%} of the time.")
    if u:
        out["vs_usual"] = "below" if v < u["low"] else "above" if v > u["high"] else "usual"
        text += {"below": " Less positive than this person's usual.", "above": " More positive than this person's usual.",
                 "usual": " Within this person's usual range."}[out["vs_usual"]]
    if live:
        text += f" Right now: {live['label'].lower()}."
    out["text"] = text
    return out


def history(minutes: list[dict], bucket_s: int = 3600) -> list[dict]:
    """Averages per hour (or per day with bucket_s=86400) over valid minutes: what the care team's report reads."""
    groups: dict[int, list[dict]] = {}
    for m in minutes:
        if m["valid"]:
            groups.setdefault(int(m["t0"] // bucket_s) * bucket_s, []).append(m)
    out = []
    for t0 in sorted(groups):
        ms = groups[t0]
        row = {"t0": t0, **session_summary(ms)}
        lab = [m["labels"] for m in ms if m["labels"]]
        row["labels"] = {c: round(sum(x[c] for x in lab) / len(lab), 3) for c in CLASSES} if lab else None
        out.append(row)
    return out


def face_during(frames: list[tuple], t0: float, t1: float) -> dict | None:
    """Face while the person was speaking. frames: (t, probs[8], valence) of usable frames. None if the face was not seen."""
    fs = [f for f in frames if t0 <= f[0] <= t1]
    if len(fs) < 3:
        return None
    mean = [sum(f[1][i] for f in fs) / len(fs) for i in range(len(CLASSES))]
    i = max(range(len(CLASSES)), key=mean.__getitem__)
    return {"label": CLASSES[i], "confidence": round(mean[i], 3), "valence": round(median(f[2] for f in fs), 3),
            "smile_share": round(sum(f[1][4] > 0.5 for f in fs) / len(fs), 3), "frames": len(fs)}


def fuse(text: str, face: dict | None, trend_text: str) -> str:
    """One paragraph for the language model: the words, the face while they were said, and the recent trend."""
    said = f'The person said: "{text}"'
    if face is None:
        return f"{said} Their face was not in view while they spoke. {trend_text}"
    smile = " and they smiled" if face["smile_share"] > 0.3 else ""
    return (f"{said} While saying it their face looked mostly {face['label'].lower()} ({face['confidence']:.0%}){smile}; "
            f"valence {face['valence']:+.2f} on a -1 to 1 scale. {trend_text} "
            "Treat the face reading as a weak hint next to the words, never as a fact about how they feel.")


if __name__ == "__main__":  # python3 signals.py minutes.jsonl > baseline.json
    import json
    import sys
    print(json.dumps(baseline([json.loads(l) for l in open(sys.argv[1]) if l.strip()]), indent=1))
