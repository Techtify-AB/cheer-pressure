"""Optional face-feed context. Never lets labels or numbers reach the LLM: only one behaviour sentence."""
from __future__ import annotations

import httpx

TIMEOUT_S = 0.3
MIN_FRAMES = 5


def sentence_from_face(face: dict | None) -> str | None:
    if not face or (face.get("frames") or 0) < MIN_FRAMES:
        return None
    smile = float(face.get("smile_share") or 0.0)
    valence = float(face.get("valence") or 0.0)
    if smile > 0.3:
        return "They smiled while saying it."
    if valence < -0.1 and smile < 0.1:
        return "Their face stayed flat while saying it."
    return None


def fetch_sentence(url: str, last_s: float) -> str | None:
    """GET the feed with a hard 300 ms timeout; any failure -> None."""
    if not url:
        return None
    try:
        r = httpx.get(url, params={"last_s": f"{max(1.0, last_s):.0f}"}, timeout=TIMEOUT_S)
        r.raise_for_status()
        return sentence_from_face(r.json().get("face"))
    except Exception:
        return None
