#!/usr/bin/env bash
# Runs ON the board: (re)start the face feed and the speech pipeline in the background.
# Logs: ~/cheer-face/feed.log, ~/cheer-face/voice.log.  Usage: [FEED_ARGS="--window_min 3 --baseline_min 10 --update_s 60"] run_feed.sh [moonshine|whisper]
pkill -f "face_stream\.py" || true
pkill -f "voice_stream\.py" || true
sleep 1
cd ~/cheer-face/edge
nohup ~/venv/bin/python face_stream.py --model ../model.onnx \
  --yunet ~/hardware/cheer-pressure/python/models/face_detection_yunet_2023mar.onnx $FEED_ARGS > ~/cheer-face/feed.log 2>&1 < /dev/null &
if [ -f ~/cheer-face/stt/silero_vad.onnx ]; then
  nohup ~/venv/bin/python voice_stream.py --engine "${1:-moonshine}" > ~/cheer-face/voice.log 2>&1 < /dev/null &
fi
sleep 10
curl -s localhost:8765/health; echo
tail -2 ~/cheer-face/feed.log; tail -2 ~/cheer-face/voice.log
