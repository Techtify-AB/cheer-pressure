"""Board runtime: camera -> face -> 8 MB expression model -> JSON feed. Runs on the Arduino UNO Q (host venv) or a laptop.

    python face_stream.py --model student_kd.onnx --yunet face_detection_yunet_2023mar.onnx [--device /dev/video0]

No frame or image is stored or sent: only numbers leave this process.

Feed (HTTP, CORS open, default port 8765):
  GET /events    Server-Sent Events: `frame` (~2/s, smoothed), `minute`, `update` (every --update_s, with check-in decision)
  GET /context   snapshot for the speech/LLM pipeline: labels now + last 10 min + vs own usual + one plain sentence
  GET /face?last_s=5[&text=...]   the face over the last N seconds (+ a fused prompt if you pass the words)
  GET /history?bucket=hour|day   averages over time for the care team's report
  POST /speech   {"text", "t0", "t1"} from voice_stream.py -> `speech` event: the words + the face while they were said
  GET /health
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import queue
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np
import onnxruntime as ort

from aggregate import CLASSES, Aggregator, Frame
from signals import checkin, context, face_during, fuse, history

MARGIN = 0.15        # --crop square: face box + 15% each side (the training framing). Default is the tight box, see README
MIN_FACE_PX = 64     # smaller faces are too blurry to read
MIN_SCORE = 0.8
MAX_YAW = 0.35       # nose offset from the eye midpoint, in eye distances
MAX_ROLL_DEG = 25
SMOOTH_S = 3.0       # time constant of the live label (a single frame is noise)


def crop_square(frame: np.ndarray, box, margin: float = MARGIN) -> np.ndarray:
    x, y, w, h = box
    s = max(w, h) * (1 + 2 * margin)
    x0, y0 = int(round(x + w / 2 - s / 2)), int(round(y + h / 2 - s / 2))
    s = int(round(s))
    H, W = frame.shape[:2]
    pad = [max(0, -y0), max(0, y0 + s - H), max(0, -x0), max(0, x0 + s - W)]
    c = frame[max(0, y0):min(H, y0 + s), max(0, x0):min(W, x0 + s)]
    return cv2.copyMakeBorder(c, *pad, cv2.BORDER_REPLICATE)


def gate(face: np.ndarray) -> str | None:
    """YuNet row [x, y, w, h, right-eye, left-eye, nose, mouth-r, mouth-l, score] -> reason the frame is unusable, or None."""
    w, h, score = face[2], face[3], face[14]
    (rx, ry), (lx, ly), (nx, _) = face[4:6], face[6:8], face[8:10]
    eye = math.hypot(lx - rx, ly - ry)
    if score < MIN_SCORE:
        return "low-score"
    if min(w, h) < MIN_FACE_PX or eye < 1:
        return "too-small"
    if abs(nx - (rx + lx) / 2) / eye > MAX_YAW:
        return "turned-away"
    if abs(math.degrees(math.atan2(ly - ry, lx - rx))) > MAX_ROLL_DEG:
        return "tilted"
    return None


class FaceReader:
    def __init__(self, model: str, yunet: str, threads: int = 2, tight: bool = True, fl: str | None = None):
        self.tight = tight
        self.blend = None
        if fl and Path(fl, "face_blendshapes.tflite").exists():
            from blend import Blendshapes
            self.blend = Blendshapes(fl)
        cv2.setNumThreads(threads)
        self.det = cv2.FaceDetectorYN.create(yunet, "", (320, 240), 0.6, 0.3, 50)
        self.size = None
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = threads
        opts.add_session_config_entry("session.intra_op.allow_spinning", "0")  # idle threads sleep: leaves CPU for speech-to-text
        self.sess = ort.InferenceSession(model, opts, providers=["CPUExecutionProvider"])

    def read(self, frame_bgr: np.ndarray, t: float, tight: bool | None = None) -> tuple[Frame, str | None]:
        tight = self.tight if tight is None else tight
        # detect on a half-size copy (4x cheaper; a desk face is still >60 px), then map the boxes back
        k = 2 if frame_bgr.shape[1] >= 640 else 1
        small = cv2.resize(frame_bgr, None, fx=1 / k, fy=1 / k, interpolation=cv2.INTER_AREA) if k > 1 else frame_bgr
        h, w = small.shape[:2]
        if self.size != (w, h):
            self.det.setInputSize((w, h))
            self.size = (w, h)
        _, faces = self.det.detect(small)
        if faces is None or len(faces) == 0:
            return Frame(t=t, ok=False), "no-face"
        faces = faces.copy()
        faces[:, :14] *= k
        f = faces[np.argmax(faces[:, 2] * faces[:, 3])]
        why = gate(f)
        if why:
            return Frame(t=t, ok=False), why
        if tight:  # detector box stretched to a square: the framing the valence head was originally trained on
            x, y, bw, bh = f[:4].astype(int)
            crop = frame_bgr[max(y, 0):y + bh, max(x, 0):x + bw]
        else:
            crop = crop_square(frame_bgr, f[:4])
        rgb = cv2.cvtColor(cv2.resize(crop, (112, 112), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        x = ((rgb.astype(np.float32) / 255 - 0.5) / 0.5).transpose(2, 0, 1)[None]
        out = self.sess.run(None, {self.sess.get_inputs()[0].name: x})[0][0]
        e = np.exp(out[:8] - out[:8].max())
        p = e / e.sum()
        blend = self.blend.measures(frame_bgr, f[:4], (f[4:6], f[6:8]), t) if self.blend else None
        return Frame(t=t, ok=True, valence=float(out[8]), arousal=float(out[9]), happy=float(p[4]),
                     probs=tuple(float(v) for v in p), blend=blend), None


class State:
    """Everything the HTTP side reads. Minutes are appended to a JSONL file so history survives restarts."""

    def __init__(self, store: Path, window_min: int = 30, baseline_min: int = 120):
        self.window_min, self.baseline_min = window_min, baseline_min
        self.store = store
        store.parent.mkdir(parents=True, exist_ok=True)
        self.minutes = [json.loads(l) for l in store.read_text().splitlines() if l.strip()] if store.exists() else []
        self.agg = Aggregator()
        self.lock = threading.Lock()
        self.clients: list[queue.Queue] = []
        self.live = None           # latest smoothed frame
        self.smooth = None         # EMA of probs + valence
        self.last_t = None
        self.last_checkin = None
        self.recent = collections.deque(maxlen=600)   # (t, probs, valence) of usable frames, about 2 minutes
        self.last_speech = None
        self.started = time.time()

    def publish(self, event: str, data: dict):
        msg = f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()
        for q in list(self.clients):
            try:
                q.put_nowait(msg)
            except queue.Full:
                self.clients.remove(q)  # a stalled client must not block the camera loop

    def on_frame(self, f: Frame, why: str | None):
        with self.lock:
            if f.ok:
                self.recent.append((f.t, f.probs, f.valence))
                a = 1.0 if self.smooth is None or f.t - self.last_t > SMOOTH_S else 1 - math.exp(-(f.t - self.last_t) / SMOOTH_S)
                cur = np.array([*f.probs, f.valence])
                self.smooth = cur if self.smooth is None else self.smooth + a * (cur - self.smooth)
                self.last_t = f.t
                i = int(self.smooth[:8].argmax())
                self.live = {"t": round(f.t, 2), "face": True, "label": CLASSES[i], "confidence": round(float(self.smooth[i]), 3),
                             "valence": round(float(self.smooth[8]), 3), "arousal": round(f.arousal, 3),
                             "probs": {c: round(float(p), 3) for c, p in zip(CLASSES, self.smooth[:8])}, "blend": f.blend}
            elif self.live is None or f.t - (self.last_t or 0) > SMOOTH_S:
                self.live = {"t": round(f.t, 2), "face": False, "why": why}
            done = self.agg.add(f)
            if done:
                self.minutes.append(done)
                with self.store.open("a") as fh:
                    fh.write(json.dumps(done) + "\n")
        self.publish("frame", self.live)
        if done:
            self.publish("minute", done)

    def on_speech(self, text: str, t0: float, t1: float, extra: dict) -> dict:
        with self.lock:
            face = face_during(list(self.recent), t0, t1)
            ctx = context(self.minutes, t1, self.live_face())
        self.last_speech = {"t0": round(t0, 2), "t1": round(t1, 2), "text": text, "face": face, **extra,
                            "prompt": fuse(text, face, ctx["text"])}
        self.publish("speech", self.last_speech)
        return self.last_speech

    def live_face(self):
        return self.live if self.live and self.live.get("face") else None

    def update(self, now: float):
        with self.lock:
            c = checkin(self.minutes, now, self.last_checkin, self.window_min, self.baseline_min)
            if c:
                self.last_checkin = now
            ctx = context(self.minutes, now, self.live_face())
        self.publish("update", {"context": ctx, "checkin": c})


def handler(state: State):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        def send_json(self, obj, code=200):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", "0")
            self.end_headers()

        def do_POST(self):
            if urlparse(self.path).path != "/speech" or self.client_address[0] not in ("127.0.0.1", "::1"):
                return self.send_json({"error": "not found"}, 404)  # only the voice process on this board may post
            d = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            extra = {k: d[k] for k in ("stt_s", "words_per_s") if k in d}
            self.send_json(state.on_speech(str(d["text"]), float(d["t0"]), float(d["t1"]), extra))

        def do_GET(self):
            u = urlparse(self.path)
            q = parse_qs(u.query)
            now = time.time()
            if u.path == "/health":
                return self.send_json({"ok": True, "uptime_s": round(now - state.started), "minutes": len(state.minutes), "live": state.live,
                                       "last_checkin": state.last_checkin})
            if u.path == "/context":
                with state.lock:
                    return self.send_json({**context(state.minutes, now, state.live_face()), "last_speech": state.last_speech})
            if u.path == "/face":  # the face over the last N seconds: for a speech pipeline that runs off the board
                last_s = min(float(q.get("last_s", ["5"])[0]), 120.0)
                text = q.get("text", [None])[0]
                with state.lock:
                    face = face_during(list(state.recent), now - last_s, now)
                    trend = context(state.minutes, now, state.live_face())["text"]
                return self.send_json({"face": face, "trend": trend, "prompt": fuse(text, face, trend) if text else None})
            if u.path == "/history":
                bucket = 86400 if q.get("bucket", ["hour"])[0] == "day" else 3600
                with state.lock:
                    return self.send_json(history(state.minutes, bucket))
            if u.path != "/events":
                return self.send_json({"error": "not found"}, 404)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Connection", "close")
            self.end_headers()
            box: queue.Queue = queue.Queue(maxsize=200)
            state.clients.append(box)
            try:
                while True:
                    try:
                        self.wfile.write(box.get(timeout=15))
                    except queue.Empty:
                        self.wfile.write(b": keep-alive\n\n")
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                if box in state.clients:
                    state.clients.remove(box)
            self.close_connection = True
    return H


def frames_from(args):
    """Yields (bgr frame, timestamp). --replay loops over a folder of images instead of a camera (tests, demos)."""
    if args.replay:
        files = sorted(p for p in Path(args.replay).rglob("*.jpg") if ".discarded" not in p.parts)
        while True:
            for p in files:
                yield cv2.imread(str(p)), time.time()
                time.sleep(1 / args.hz)
    dev = int(args.device) if args.device.isdigit() else args.device
    if dev == "auto":  # the USB camera's /dev/videoN changes across reboots; its by-id link does not
        ids = sorted(Path("/dev/v4l/by-id").glob("*-video-index0")) if Path("/dev/v4l/by-id").exists() else []
        dev = str(ids[0].resolve()) if ids else 0
        print(f"camera: {dev}", flush=True)
    cap = cv2.VideoCapture(dev, cv2.CAP_V4L2) if isinstance(dev, str) else cv2.VideoCapture(dev)
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    while True:
        t0 = time.time()
        ok, frame = cap.read()
        if not ok:
            print("camera read failed", flush=True)
            time.sleep(2)
            continue
        yield frame, t0
        time.sleep(max(0.0, 1 / args.hz - (time.time() - t0)))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--model", required=True)
    p.add_argument("--yunet", required=True)
    p.add_argument("--device", default="auto", help="auto = the USB camera (Linux) or camera 0; or an index / /dev/videoN")
    p.add_argument("--replay", default=None, help="folder of .jpg frames instead of a camera")
    p.add_argument("--hz", type=float, default=5.0)
    p.add_argument("--crop", choices=["tight", "square"], default="tight")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--store", default=str(Path.home() / "cheer-face" / "minutes.jsonl"))
    p.add_argument("--update_s", type=float, default=300, help="seconds between `update` events (context + check-in decision)")
    p.add_argument("--fl", default=str(Path.home() / "models" / "fl"), help="folder with the unzipped MediaPipe face_landmarker.task")
    p.add_argument("--window_min", type=int, default=30, help="check-in looks at this many recent minutes")
    p.add_argument("--baseline_min", type=int, default=120, help="valid minutes of history before any check-in (demo: 10)")
    args = p.parse_args()
    state = State(Path(args.store), args.window_min, args.baseline_min)
    reader = FaceReader(args.model, args.yunet, tight=args.crop == "tight", fl=args.fl)
    print(f"blendshapes: {'on' if reader.blend else 'off'}", flush=True)
    srv = ThreadingHTTPServer(("0.0.0.0", args.port), handler(state))
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    print(f"feed on http://0.0.0.0:{args.port}/events  ({len(state.minutes)} stored minutes)", flush=True)
    next_update = time.time() + args.update_s
    for frame, t in frames_from(args):
        if frame is None:
            continue
        state.on_frame(*reader.read(frame, t))
        if t >= next_update:
            state.update(t)
            next_update = t + args.update_s


if __name__ == "__main__":
    main()
