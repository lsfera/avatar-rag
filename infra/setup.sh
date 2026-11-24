#!/usr/bin/env bash
# One-time setup of the CPU STT/TTS servers (faster-whisper + Piper, Italian).
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv 2>/dev/null || {  # Debian images lack ensurepip
    python3 -m venv --without-pip .venv
    curl -fsSL https://bootstrap.pypa.io/get-pip.py | .venv/bin/python
  }
fi
.venv/bin/pip install -q fastapi "uvicorn[standard]" python-multipart numpy soxr faster-whisper piper-tts
mkdir -p .cache/piper
.venv/bin/python -m piper.download_voices it_IT-paola-medium --download-dir .cache/piper
