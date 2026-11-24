import { Effect, Layer, Schema, Stream } from "effect"
import { Sse } from "effect/encoding"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Embeddings, Llm, LlmError, RetrievalError } from "./services.js"

export interface OllamaOptions {
  /** Server root, e.g. http://host.docker.internal:11434 */
  readonly baseUrl: string
  readonly model: string
  /** How long Ollama keeps the model loaded after a request. */
  readonly keepAlive?: string
  /** "none" turns thinking off on Qwen3-style models; required for latency. */
  readonly reasoningEffort?: "none" | "low" | "medium" | "high"
  readonly maxTokens?: number
  readonly temperature?: number
}

const ChatChunk = Schema.Struct({
  choices: Schema.Array(Schema.Struct({
    delta: Schema.Struct({ content: Schema.optional(Schema.NullOr(Schema.String)) })
  }))
})
const decodeChunk = Schema.decodeUnknownEffect(Schema.fromJsonString(ChatChunk))

const EmbeddingsResponse = Schema.Struct({
  data: Schema.Array(Schema.Struct({ embedding: Schema.Array(Schema.Number) }))
})

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

/** Loads the model into memory and keeps it there; failures are logged, not fatal. */
export const warmModel = (opts: OllamaOptions) =>
  Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    yield* HttpClientRequest.post(`${opts.baseUrl}/api/generate`).pipe(
      HttpClientRequest.bodyJsonUnsafe({ model: opts.model, keep_alive: opts.keepAlive ?? "30m" }),
      client.execute,
      Effect.flatMap(HttpClientResponse.filterStatusOk),
      Effect.asVoid
    )
  }).pipe(Effect.catch((e) => Effect.logWarning(`ollama warm-up failed: ${messageOf(e)}`)))

/** Llm over Ollama's OpenAI-compatible /v1/chat/completions (ADR 0001). */
export const OllamaLlm = (opts: OllamaOptions): Layer.Layer<Llm, never, HttpClient.HttpClient> =>
  Layer.effect(
    Llm,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient
      return Llm.of({
        stream: (messages) =>
          Stream.unwrap(
            HttpClientRequest.post(`${opts.baseUrl}/v1/chat/completions`).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                model: opts.model,
                stream: true,
                messages,
                reasoning_effort: opts.reasoningEffort ?? "none",
                max_tokens: opts.maxTokens,
                temperature: opts.temperature
              }),
              client.execute,
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.map((res) =>
                res.stream.pipe(
                  Stream.decodeText(),
                  Stream.pipeThroughChannel(Sse.decode()),
                  Stream.filter((event) => event.data !== "[DONE]"),
                  Stream.mapEffect((event) => decodeChunk(event.data)),
                  Stream.map((chunk) => chunk.choices[0]?.delta.content ?? ""),
                  Stream.filter((delta) => delta.length > 0)
                )
              )
            )
          ).pipe(Stream.mapError((cause) => new LlmError({ message: messageOf(cause) })))
      })
    })
  )

/** Embeddings over /v1/embeddings (bge-m3 gives 1024-dim vectors). */
export const OllamaEmbeddings = (opts: Pick<OllamaOptions, "baseUrl" | "model">): Layer.Layer<Embeddings, never, HttpClient.HttpClient> =>
  Layer.effect(
    Embeddings,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient
      return Embeddings.of({
        embed: (texts) =>
          HttpClientRequest.post(`${opts.baseUrl}/v1/embeddings`).pipe(
            HttpClientRequest.bodyJsonUnsafe({ model: opts.model, input: texts }),
            client.execute,
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(EmbeddingsResponse)),
            Effect.map((r) => r.data.map((d) => d.embedding)),
            Effect.mapError((cause) => new RetrievalError({ message: messageOf(cause) }))
          )
      })
    })
  )
