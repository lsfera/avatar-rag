FROM python:3.13-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" python-multipart numpy soxr faster-whisper piper-tts
COPY stt_server.py tts_server.py ./
# Models download into /app/.cache on first start; compose mounts a volume there.
