import { Effect, Layer, Stream } from "effect"
import { Embeddings, Llm, Retriever, Stt, Tts, type Passage } from "./services.js"

export const FakeLlm = (tokens: ReadonlyArray<string>, onMessages?: (m: ReadonlyArray<unknown>) => void) =>
  Layer.succeed(Llm, Llm.of({
    stream: (messages) => {
      onMessages?.(messages)
      return Stream.fromIterable(tokens)
    }
  }))

export const FakeTts = (onSynthesize?: (text: string) => void, chunk = new Uint8Array([1, 2])) =>
  Layer.succeed(Tts, Tts.of({
    synthesize: (text) => {
      onSynthesize?.(text)
      return Stream.make(chunk)
    }
  }))

export const FakeRetriever = (passages: ReadonlyArray<Passage>) =>
  Layer.succeed(Retriever, Retriever.of({ retrieve: () => Effect.succeed(passages) }))

export const FakeStt = (text: string) =>
  Layer.succeed(Stt, Stt.of({ transcribe: () => Effect.succeed(text) }))

export const FakeEmbeddings = Layer.succeed(Embeddings, Embeddings.of({
  embed: (texts) => Effect.succeed(texts.map((t) => [t.length, 1]))
}))
