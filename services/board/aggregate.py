"""Frames -> minutes -> session. Pure stdlib so it runs unchanged on the Arduino UNO Q and in tests.

A single frame is noise; the product only ever consumes the minute and session summaries.
Wording: these are measures of facial behaviour, compared with the person's own usual. Not a diagnosis.
"""
from __future__ import annotations

from dataclasses import dataclass
from statistics import median, quantiles

CLASSES = ("Anger", "Contempt", "Disgust", "Fear", "Happiness", "Neutral", "Sadness", "Surprise")
LOW_VALENCE = -0.15   # a frame counts as "low" below this (same cut-off the board app used)
SMILE_P = 0.5         # a frame counts as smiling when P(happy) is above this
BLEND_SMILE_ON, BLEND_BROW_ON = 0.35, 0.45   # blendshape thresholds, same as the team app
MAX_GAP_S = 1.0       # face time only accumulates across gaps shorter than this
MIN_FACE_S = 20.0     # a minute needs this much usable face time to count
MIN_MINUTES = 5       # a session needs this many valid minutes before we show a reading


@dataclass
class Frame:
    t: float            # seconds (epoch)
    ok: bool            # a face was found AND passed the quality gate (size, pose, sharpness)
    valence: float = 0.0
    arousal: float = 0.0
    happy: float = 0.0  # P(happy) from the model
    probs: tuple | None = None   # 8 expression probabilities, order = CLASSES
    blend: dict | None = None    # MediaPipe blendshape measures (smile, browDown, ...) when available


def summarise_minute(t0: int, fs: list[Frame]) -> dict:
    ok = [f for f in fs if f.ok]
    face_s = sum(min(b.t - a.t, MAX_GAP_S) for a, b in zip(ok, ok[1:]) if b.t - a.t <= MAX_GAP_S)
    if ok:
        face_s += min(MAX_GAP_S, face_s / max(len(ok) - 1, 1))  # the last frame also covers one frame period
    out = {"t0": t0, "n": len(fs), "face_s": round(face_s, 1), "valid": face_s >= MIN_FACE_S,
           "valence_med": None, "arousal_med": None, "low_share": None, "smile_share": None, "variability": None,
           "labels": None, "blend": None}
    if not ok:
        return out
    withp = [f.probs for f in ok if f.probs is not None]
    if withp:  # share of the minute each expression label gets (mean probability)
        out["labels"] = {c: round(sum(p[i] for p in withp) / len(withp), 3) for i, c in enumerate(CLASSES)}
    withb = [f.blend for f in ok if f.blend]
    if withb:
        out["blend"] = {k: round(sum(b[k] for b in withb) / len(withb), 3) for k in withb[0]}
        # shares with the team app's thresholds (lib/camera/expression.ts), so board and browser agree
        out["blend"]["smile_share"] = round(sum(b["smile"] > BLEND_SMILE_ON for b in withb) / len(withb), 3)
        out["blend"]["brow_share"] = round(sum(b["browDown"] > BLEND_BROW_ON for b in withb) / len(withb), 3)
    v = [f.valence for f in ok]
    steps = [abs(b.valence - a.valence) for a, b in zip(ok, ok[1:]) if b.t - a.t <= MAX_GAP_S]
    out.update(valence_med=median(v), arousal_med=median(f.arousal for f in ok),
               low_share=sum(x < LOW_VALENCE for x in v) / len(v),
               smile_share=sum(f.happy > SMILE_P for f in ok) / len(ok),
               variability=sum(steps) / len(steps) if steps else 0.0)  # mean frame-to-frame change: how much the face moves
    return out


class Aggregator:
    """Feed frames in time order; add() returns a finished minute summary when a new minute starts."""

    def __init__(self):
        self.t0: int | None = None
        self.buf: list[Frame] = []

    def add(self, f: Frame) -> dict | None:
        t0, done = int(f.t // 60) * 60, None
        if self.t0 is not None and t0 != self.t0:
            done = summarise_minute(self.t0, self.buf)
            self.buf = []
        self.t0 = t0
        self.buf.append(f)
        return done


def session_summary(minutes: list[dict]) -> dict:
    """One reading for a sitting (minutes to hours): medians over valid minutes + how much data backs it."""
    ms = [m for m in minutes if m["valid"]]
    out = {"minutes": len(ms), "face_min": sum(m["face_s"] for m in ms) / 60, "enough": len(ms) >= MIN_MINUTES,
           "valence_med": None, "valence_iqr": None, "low_share": None, "smile_share": None, "variability": None}
    if not ms:
        return out
    v = [m["valence_med"] for m in ms]
    q = quantiles(v, n=4, method="inclusive") if len(v) > 1 else [v[0]] * 3
    out.update(valence_med=median(v), valence_iqr=[q[0], q[2]],
               **{k: median(m[k] for m in ms) for k in ("low_share", "smile_share", "variability")})
    return out
