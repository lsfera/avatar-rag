"""OpenAI-compatible speech-to-text (POST /v1/audio/transcriptions) on faster-whisper.

Same HTTP contract as whisper.cpp's server, speaches and mlx-audio, so a host-side
server (e.g. on Apple Silicon) can replace this one by changing STT_URL only.
"""
import io
import os
import wave

import numpy as np
import soxr
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL = os.environ.get("WHISPER_MODEL", "small")
THREADS = int(os.environ.get("WHISPER_THREADS", "8"))
model = WhisperModel(MODEL, device="cpu", compute_type="int8", cpu_threads=THREADS,
                     download_root=os.path.join(os.path.dirname(__file__), ".cache", "whisper"))
app = FastAPI(title="stt")


def read_wav_16k_mono(data: bytes) -> np.ndarray:
    try:
        with wave.open(io.BytesIO(data)) as w:
            if w.getsampwidth() != 2:
                raise HTTPException(400, "only 16-bit PCM wav is supported")
            rate, channels, frames = w.getframerate(), w.getnchannels(), w.readframes(w.getnframes())
    except wave.Error as e:
        raise HTTPException(400, f"invalid wav: {e}") from e
    pcm = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1)
    return soxr.resample(pcm, rate, 16000) if rate != 16000 else pcm


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/v1/audio/transcriptions")
def transcribe(file: UploadFile = File(...), model_name: str = Form("whisper", alias="model"),
               language: str = Form("it"), prompt: str = Form("")):
    audio = read_wav_16k_mono(file.file.read())
    if audio.size < 1600:  # under 100 ms
        return {"text": ""}
    segments, _ = model.transcribe(audio, language=language or None, beam_size=1,
                                   initial_prompt=prompt or None, condition_on_previous_text=False)
    return {"text": " ".join(s.text.strip() for s in segments).strip()}
