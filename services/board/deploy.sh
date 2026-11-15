#!/usr/bin/env bash
# Copy the runtime + model to the Arduino UNO Q and start the feed. Usage: edge/deploy.sh <board-ip>
# The board has no rsync, so files go as a tar over ssh. The start commands live in run_feed.sh on the board:
# passed inline over ssh, `pkill -f face_stream.py` matches the ssh shell's own command line and kills it.
set -euo pipefail
cd "$(dirname "$0")/.."; B=arduino@$1
COPYFILE_DISABLE=1 tar czf - edge/*.py edge/run_feed.sh -C runs/student_kd model.onnx | ssh "$B" 'mkdir -p ~/cheer-face && tar xzf - -C ~/cheer-face 2>/dev/null'
ssh "$B" 'bash ~/cheer-face/edge/run_feed.sh'
