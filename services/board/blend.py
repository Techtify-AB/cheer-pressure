"""MediaPipe blendshapes on the board without the mediapipe package (it does not run on the board's CPU).

MediaPipe = Google's library of small face/hand/pose models. Its "face landmarker" is three models in a row:
find the face -> 478 landmark points -> 52 blendshape scores (mouth corners up, brows down, jaw open, ...).
Here the first step is replaced by the YuNet box we already have, and the other two run on LiteRT.

The landmark subset and the score names are copied from MediaPipe's own source
(mediapipe/tasks/cc/vision/face_landmarker/face_blendshapes_graph.cc).
The measures mirror the team app's lib/camera/expression.ts so board and browser numbers mean the same thing.
"""
from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np

SUBSET = [0, 1, 4, 5, 6, 7, 8, 10, 13, 14, 17, 21, 33, 37, 39, 40, 46, 52, 53, 54, 55, 58, 61, 63, 65, 66, 67, 70, 78, 80, 81, 82, 84, 87, 88, 91, 93, 95, 103, 105, 107, 109, 127, 132, 133, 136, 144, 145, 146, 148, 149, 150, 152, 153, 154, 155, 157, 158, 159, 160, 161, 162, 163, 168, 172, 173, 176, 178, 181, 185, 191, 195, 197, 234, 246, 249, 251, 263, 267, 269, 270, 276, 282, 283, 284, 285, 288, 291, 293, 295, 296, 297, 300, 308, 310, 311, 312, 314, 317, 318, 321, 323, 324, 332, 334, 336, 338, 356, 361, 362, 365, 373, 374, 375, 377, 378, 379, 380, 381, 382, 384, 385, 386, 387, 388, 389, 390, 397, 398, 400, 402, 405, 409, 415, 454, 466, 468, 469, 470, 471, 472, 473, 474, 475, 476, 477]
NAMES = ['_neutral', 'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight', 'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight', 'eyeBlinkLeft', 'eyeBlinkRight', 'eyeLookDownLeft', 'eyeLookDownRight', 'eyeLookInLeft', 'eyeLookInRight', 'eyeLookOutLeft', 'eyeLookOutRight', 'eyeLookUpLeft', 'eyeLookUpRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeWideLeft', 'eyeWideRight', 'jawForward', 'jawLeft', 'jawOpen', 'jawRight', 'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight', 'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel', 'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker', 'mouthRight', 'mouthRollLower', 'mouthRollUpper', 'mouthShrugLower', 'mouthShrugUpper', 'mouthSmileLeft', 'mouthSmileRight', 'mouthStretchLeft', 'mouthStretchRight', 'mouthUpperUpLeft', 'mouthUpperUpRight', 'noseSneerLeft', 'noseSneerRight']
ROI_SCALE = 1.2      # landmark crop = YuNet face box x 1.2, square (tuned against MediaPipe's own output, see README)
SMILE_ON = 0.35      # same thresholds as lib/camera/expression.ts
BROW_ON = 0.45
DEADBAND = 0.05      # per-shape jitter ignored when measuring how much the face moves
ANIMATION = [i for i, n in enumerate(NAMES) if n != "_neutral" and not n.startswith("eye")]  # 37 shapes, eyes left out


def shape_spread(rows: list[np.ndarray]) -> float:
    """How much the face varied over about one second: per-shape standard deviation less the deadband, summed."""
    if len(rows) < 2:
        return 0.0
    sd = np.std(np.stack(rows)[:, ANIMATION], axis=0, ddof=1)
    return float(np.maximum(0, sd - DEADBAND).sum())


class Blendshapes:
    def __init__(self, model_dir: str, threads: int = 2):
        from ai_edge_litert.interpreter import Interpreter
        d = Path(model_dir)
        self.lm = Interpreter(str(d / "face_landmarks_detector.tflite"), num_threads=threads)
        self.bs = Interpreter(str(d / "face_blendshapes.tflite"), num_threads=1)
        self.lm.allocate_tensors()
        self.bs.allocate_tensors()
        self.lm_in = self.lm.get_input_details()[0]["index"]
        self.lm_out = next(o["index"] for o in self.lm.get_output_details() if o["shape"][-1] == 1434)
        self.bs_in = self.bs.get_input_details()[0]["index"]
        self.bs_out = self.bs.get_output_details()[0]["index"]
        self.second: list[tuple[float, np.ndarray]] = []

    def scores(self, frame_bgr: np.ndarray, box, eyes=None) -> np.ndarray:
        """box = x, y, w, h of the face; eyes = (right-eye xy, left-eye xy) to level a tilted head. -> 52 scores."""
        x, y, w, h = box
        s = max(w, h) * ROI_SCALE
        cx, cy = x + w / 2, y + h / 2
        ang = math.atan2(eyes[1][1] - eyes[0][1], eyes[1][0] - eyes[0][0]) if eyes is not None else 0.0
        c, n = math.cos(ang) * s / 256, math.sin(ang) * s / 256
        M = np.array([[c, -n, cx - (c - n) * 128], [n, c, cy - (n + c) * 128]], np.float32)  # crop pixel -> image pixel
        crop = cv2.warpAffine(frame_bgr, M, (256, 256), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
        rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
        self.lm.set_tensor(self.lm_in, rgb[None])
        self.lm.invoke()
        pts = self.lm.get_tensor(self.lm_out).reshape(478, 3)[:, :2]
        img = pts @ M[:, :2].T + M[:, 2]  # landmarks back in image pixels, as MediaPipe feeds them
        self.bs.set_tensor(self.bs_in, img[SUBSET][None].astype(np.float32))
        self.bs.invoke()
        return self.bs.get_tensor(self.bs_out).reshape(52)

    def measures(self, frame_bgr: np.ndarray, box, eyes, t: float) -> dict:
        """The numbers the feed carries: smile, browDown (0..1) and animation (movement over the last second)."""
        s = self.scores(frame_bgr, box, eyes)
        self.second = [(tt, r) for tt, r in self.second if t - tt <= 1.0] + [(t, s)]
        g = lambda k: float(s[NAMES.index(k)])
        return {"smile": round((g("mouthSmileLeft") + g("mouthSmileRight")) / 2, 3),
                "browDown": round((g("browDownLeft") + g("browDownRight")) / 2, 3),
                "jawOpen": round(g("jawOpen"), 3),
                "animation": round(shape_spread([r for _, r in self.second]), 3)}
