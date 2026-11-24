"""Streaming text-to-speech on Piper, shaped like OpenAI/Kokoro-FastAPI: POST /v1/audio/speech.

With response_format=pcm it streams raw 16-bit mono PCM at 24 kHz (the avatar's output
format), so Kokoro-FastAPI or any compatible server can replace it via TTS_URL.
"""
import os

import numpy as np
import soxr
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from piper import PiperVoice
from pydantic import BaseModel

OUT_RATE = 24000
VOICE_DIR = os.path.join(os.path.dirname(__file__), ".cache", "piper")
DEFAULT_VOICE = os.environ.get("PIPER_VOICE", "it_IT-paola-medium")
_voices: dict[str, PiperVoice] = {}
app = FastAPI(title="tts")


def voice_for(name: str) -> PiperVoice:
    name = name if os.path.exists(os.path.join(VOICE_DIR, f"{name}.onnx")) else DEFAULT_VOICE
    if name not in _voices:
        _voices[name] = PiperVoice.load(os.path.join(VOICE_DIR, f"{name}.onnx"))
    return _voices[name]


class SpeechRequest(BaseModel):
    input: str
    voice: str = DEFAULT_VOICE
    model: str = "piper"
    response_format: str = "pcm"


@app.get("/health")
def health():
    return {"ok": True, "voice": DEFAULT_VOICE, "sample_rate": OUT_RATE}


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest):
    if req.response_format != "pcm":
        raise HTTPException(400, "only response_format=pcm is supported")
    if not req.input.strip():
        raise HTTPException(400, "empty input")
    voice = voice_for(req.voice)

    def stream():
        for chunk in voice.synthesize(req.input):
            pcm = chunk.audio_int16_array.astype(np.float32) / 32768.0
            if chunk.sample_rate != OUT_RATE:
                pcm = soxr.resample(pcm, chunk.sample_rate, OUT_RATE)
            yield (np.clip(pcm, -1, 1) * 32767).astype("<i2").tobytes()

    return StreamingResponse(stream(), media_type="audio/L16;rate=24000")
