# Talk to the LLM and embeddings through the OpenAI-compatible HTTP API

The LLM and embedding services call `/v1/chat/completions` and `/v1/embeddings` over Effect's HttpClient, with SSE decoded by Schema, instead of Ollama's native API. Ollama is only the first server behind it, so llama.cpp, vLLM or MLX servers can replace it without changing the service interfaces.
