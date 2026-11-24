#!/usr/bin/env bash
# Starts the STT (8001) and TTS (8002) servers. Run `./setup.sh` once first.
set -euo pipefail
cd "$(dirname "$0")"
.venv/bin/uvicorn stt_server:app --host 0.0.0.0 --port "${STT_PORT:-8001}" &
.venv/bin/uvicorn tts_server:app --host 0.0.0.0 --port "${TTS_PORT:-8002}" &
trap 'kill 0' EXIT
wait
