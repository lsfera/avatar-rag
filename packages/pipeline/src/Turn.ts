import { Effect, Stream } from "effect"
import type { Persona, SentenceId } from "@avatar/core"
import { chunkSentences } from "./SentenceChunker.js"
import { Llm, Retriever, Tts, type ChatMessage, type LlmError, type Passage, type RetrievalError, type TtsError } from "./services.js"

export type TurnEvent =
  | { readonly _tag: "SentenceStart"; readonly sentenceId: number; readonly text: string }
  | { readonly _tag: "Audio"; readonly sentenceId: number; readonly chunk: Uint8Array }
  | { readonly _tag: "Finished"; readonly sources: ReadonlyArray<string> }

const TRIVIAL = /^\s*(ok|okay|s[iì]|no|grazie|prego|ciao|va bene|certo)[\s.!?]*$/i

const UNGROUNDED_RULE =
  "Non hai trovato informazioni pertinenti nella base di conoscenza: non inventare fatti, " +
  "ammetti con naturalezza di non saperlo. Puoi comunque fare conversazione generica."

export const buildMessages = (
  persona: Persona,
  history: ReadonlyArray<ChatMessage>,
  userText: string,
  passages: ReadonlyArray<Passage>
): ReadonlyArray<ChatMessage> => {
  const context = passages.length > 0
    ? `Usa solo queste informazioni per i fatti. Se non rispondono alla domanda, di' con naturalezza che non lo sai e non inventare:\n${passages.map((p) => `- ${p.text}`).join("\n")}`
    : UNGROUNDED_RULE
  return [
    { role: "system", content: `${persona.systemPrompt}\n\n${context}` },
    ...history,
    { role: "user", content: userText }
  ]
}

export interface RunTurnInput {
  readonly persona: Persona
  readonly history: ReadonlyArray<ChatMessage>
  readonly userText: string
  readonly retrievalLimit?: number
}

/**
 * One conversational Turn as a lazy stream. Barge-in is interruption of whoever
 * consumes it: the LLM and TTS streams are children, so they are cancelled with it.
 */
export const runTurn = (
  input: RunTurnInput
): Stream.Stream<TurnEvent, LlmError | TtsError | RetrievalError, Llm | Tts | Retriever> =>
  Stream.unwrap(Effect.gen(function*() {
    const retriever = yield* Retriever
    const llm = yield* Llm
    const tts = yield* Tts

    const found = TRIVIAL.test(input.userText)
      ? []
      : yield* retriever.retrieve(input.userText, input.retrievalLimit ?? 4)
    const passages = found.filter((p) => p.score >= input.persona.groundingThreshold)
    const messages = buildMessages(input.persona, input.history, input.userText, passages)

    const speech = llm.stream(messages).pipe(
      chunkSentences,
      Stream.zipWithIndex,
      Stream.flatMap(([text, index]) =>
        Stream.concat(
          Stream.make<[TurnEvent]>({ _tag: "SentenceStart", sentenceId: index as number, text }),
          tts.synthesize(text, input.persona.voice).pipe(
            Stream.map((chunk): TurnEvent => ({ _tag: "Audio", sentenceId: index, chunk }))
          )
        )
      )
    )
    return Stream.concat(
      speech,
      Stream.make<[TurnEvent]>({ _tag: "Finished", sources: passages.map((p) => p.id) })
    )
  }))

export type { SentenceId }
