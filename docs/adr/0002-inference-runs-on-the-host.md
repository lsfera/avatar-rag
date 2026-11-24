# Run all model inference on the host, not in the container

Docker on macOS cannot use Metal, so the Effect server in the container only calls HTTP model servers (Ollama, Whisper, TTS) on the M4 Pro host at `host.docker.internal`. Every base URL comes from Effect `Config`, so moving to a CUDA server is a Layer and config change, not a rewrite.
