import { Effect, Layer, Stream } from "effect"
import { Embeddings, Retriever, Tts, type Passage } from "./services.js"

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return dot / Math.sqrt(na * nb)
}

export interface KnowledgePassage { readonly id: string; readonly text: string }

/** Small knowledge bases: embeds every passage once at startup, ranks by cosine per query. */
export const MemoryRetriever = (passages: ReadonlyArray<KnowledgePassage>): Layer.Layer<Retriever, never, Embeddings> =>
  Layer.effect(
    Retriever,
    Effect.gen(function*() {
      const embeddings = yield* Embeddings
      const vectors = yield* embeddings.embed(passages.map((p) => p.text)).pipe(Effect.orDie)
      return Retriever.of({
        retrieve: (query, limit) =>
          embeddings.embed([query]).pipe(
            Effect.map(([q]): ReadonlyArray<Passage> =>
              passages
                .map((p, i) => ({ id: p.id, text: p.text, score: cosine(q!, vectors[i]!) }))
                .sort((x, y) => y.score - x.score)
                .slice(0, limit)
            )
          )
      })
    })
  )

/**
 * Development stand-in for a real TTS server: emits silence of roughly speaking length.
 * Lets the LLM, chunking, protocol and barge-in be exercised before a TTS host exists.
 */
export const SilentTts = (sampleRate = 24_000, msPerChar = 60): Layer.Layer<Tts> =>
  Layer.succeed(Tts, Tts.of({
    synthesize: (text) => {
      const bytes = Math.round(sampleRate * (text.length * msPerChar) / 1000) * 2
      const chunkBytes = Math.round(sampleRate * 0.1) * 2
      return Stream.fromIterable(Array.from({ length: Math.ceil(bytes / chunkBytes) }, () => new Uint8Array(chunkBytes)))
    }
  }))
