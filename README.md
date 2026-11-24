# Sofia — real-time Italian AI avatar

Speak or type Italian; a 3D VRM avatar answers aloud with lip-sync, grounded in a knowledge base (RAG).
Open-source models only, [Effect](https://effect.website) 4 + TypeScript 7.

```
browser (VRM, VAD, WebAudio)  <--WebSocket-->  server (Effect)  --HTTP-->  Ollama   (LLM + bge-m3 embeddings)
                                                                 --HTTP-->  STT      (OpenAI /v1/audio/transcriptions)
                                                                 --HTTP-->  TTS      (OpenAI-style /v1/audio/speech, PCM 24 kHz)
```

Terms are defined in [GLOSSARY.md](GLOSSARY.md); decisions in [docs/adr](docs/adr).

## Run it (everything in the dev container, CPU speech models)

```bash
pnpm install
./infra/setup.sh && ./infra/run.sh &                  # STT :8001 (faster-whisper small), TTS :8002 (Piper it_IT)
pnpm --filter @avatar/web prepare-assets              # VAD models + sample avatar (VRM 1.0, pixiv, redistributable)
OLLAMA_URL=http://host.docker.internal:11434 STT_URL=http://localhost:8001 TTS_URL=http://localhost:8002 \
  pnpm --filter @avatar/server start                  # :3000  (/ws, /health)
pnpm --filter @avatar/web dev                         # :5173  open it, press Avvia
```

Server env: `OLLAMA_URL`, `LLM_MODEL` (default `qwen3.6:35b-a3b`), `EMBED_MODEL` (`bge-m3`), `KNOWLEDGE_FILE`,
`STT_URL`, `TTS_URL`, `TTS_VOICE`, `PORT`. Without `STT_URL` voice input is off; without `TTS_URL` replies are silent.

Ollama must be reachable and have the models: `ollama pull bge-m3` and your LLM. Keep the model loaded (`keep_alive` is set on warm-up).

## Better speech on the Mac host

The CPU servers are only the default. Anything with the same HTTP shape works, so run faster models on the M4 and point
`STT_URL` / `TTS_URL` at them (e.g. `http://host.docker.internal:PORT`):

- STT: `whisper.cpp` server or an MLX Whisper server exposing `POST /v1/audio/transcriptions` (multipart, `file`, `language=it`).
- TTS: Kokoro-FastAPI (Italian voices `if_sara`, `im_nicola`) with `POST /v1/audio/speech`, `response_format=pcm`; set `TTS_VOICE=if_sara`.

## Tests and proofs

| Command | What it proves |
|---|---|
| `pnpm test` | unit tests (chunker, Turn, Session, protocol, lip-sync, speech helpers, server connection with a fake socket) |
| `pnpm typecheck` | all packages on TypeScript 7 |
| `pnpm eval` | model eval: retrieval, fact recall, refusals, injection, Italian, latency, with pass/fail gates |
| `pnpm e2e` | live stack over WebSocket: text turn, voice turn, barge-in, history; reply audio is transcribed back with STT |
| `pnpm e2e:browser` | real client in headless Chromium: fake microphone, VAD, lip-sync, barge-in, acks; screenshots in `docs/proof/` |

`pnpm e2e:browser` needs `./infra/browser-setup.sh` once (Chromium + libs without root), plus the web dev server running.
