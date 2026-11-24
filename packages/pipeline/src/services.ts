import { Context, Effect, Schema, Stream } from "effect"

export class SttError extends Schema.TaggedError<SttError>()("SttError", { message: Schema.String }) {}
export class LlmError extends Schema.TaggedError<LlmError>()("LlmError", { message: Schema.String }) {}
export class TtsError extends Schema.TaggedError<TtsError>()("TtsError", { message: Schema.String }) {}
export class RetrievalError extends Schema.TaggedError<RetrievalError>()("RetrievalError", { message: Schema.String }) {}

export interface ChatMessage {
  readonly role: "system" | "user" | "assistant"
  readonly content: string
}

export interface Passage {
  readonly id: string
  readonly text: string
  /** Similarity in [0, 1]; higher is closer. */
  readonly score: number
}

/** Speech to text. Input is a complete 16 kHz mono PCM16 speech segment. */
export class Stt extends Context.Service<Stt, {
  transcribe(pcm: Uint8Array): Effect.Effect<string, SttError>
}>()("@avatar/pipeline/Stt") {}

/** Streaming chat completion; emits token deltas. */
export class Llm extends Context.Service<Llm, {
  stream(messages: ReadonlyArray<ChatMessage>): Stream.Stream<string, LlmError>
}>()("@avatar/pipeline/Llm") {}

/** Text to speech; emits 24 kHz mono PCM16 chunks for one sentence. */
export class Tts extends Context.Service<Tts, {
  synthesize(text: string, voice: string): Stream.Stream<Uint8Array, TtsError>
}>()("@avatar/pipeline/Tts") {}

export class Embeddings extends Context.Service<Embeddings, {
  embed(texts: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<ReadonlyArray<number>>, RetrievalError>
}>()("@avatar/pipeline/Embeddings") {}

export class Retriever extends Context.Service<Retriever, {
  retrieve(query: string, limit: number): Effect.Effect<ReadonlyArray<Passage>, RetrievalError>
}>()("@avatar/pipeline/Retriever") {}
