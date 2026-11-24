import { Effect, Fiber, Stream } from "effect"
import type { Scope } from "effect"
import {
  SentenceId, SpokenSentence, Turn, TurnId, type ClientMessage, type Persona, type ServerMessage
} from "@avatar/core"
import { runTurn } from "./Turn.js"
import { Llm, Retriever, Stt, Tts, type ChatMessage } from "./services.js"

/** Where a Session sends things: control JSON and binary audio. */
export interface Outbound {
  readonly control: (message: ServerMessage) => Effect.Effect<void>
  readonly audio: (sentenceId: number, chunk: Uint8Array) => Effect.Effect<void>
}

export interface Session {
  /** Feed one control message from the client. */
  readonly receive: (message: ClientMessage) => Effect.Effect<void, never, Llm | Tts | Retriever>
  /** Feed one complete speech Utterance (16 kHz mono PCM16). */
  readonly receiveSpeech: (pcm: Uint8Array) => Effect.Effect<void, never, Llm | Tts | Retriever | Stt>
  /** Resolves when no Turn is running. */
  readonly idle: Effect.Effect<void>
  /** Completed and interrupted Turns so far, oldest first. */
  readonly turns: Effect.Effect<ReadonlyArray<Turn>>
}

interface Mutable {
  id: TurnId
  userText: string
  sentences: Array<{ id: number; text: string; played: boolean }>
  sources: ReadonlyArray<string>
  status: Turn["status"]
}

const freeze = (t: Mutable): Turn =>
  new Turn({
    id: t.id, userText: t.userText, sources: t.sources, status: t.status,
    sentences: t.sentences.map((s) => new SpokenSentence({ id: SentenceId.make(s.id), text: s.text, played: s.played }))
  })

/** History the model sees: each user line, and only what the user actually heard. */
export const historyOf = (turns: ReadonlyArray<Turn>): ReadonlyArray<ChatMessage> =>
  turns.flatMap((t): ReadonlyArray<ChatMessage> => {
    const heard = t.heardText
    return heard.length > 0
      ? [{ role: "user", content: t.userText }, { role: "assistant", content: heard }]
      : [{ role: "user", content: t.userText }]
  })

/**
 * One Session per connection. A Turn is a fiber; barge-in and a new user input
 * both interrupt the running Turn, which tears down its LLM and TTS streams.
 */
export const makeSession = (persona: Persona, out: Outbound): Effect.Effect<Session, never, Scope.Scope> =>
  Effect.gen(function*() {
    const scope = yield* Effect.scope
    const done: Array<Mutable> = []
    let current: {
      readonly fiber: Fiber.Fiber<void>
      readonly record: Mutable
      /** Idempotent: ends the Turn as interrupted unless it already ended. */
      readonly cancel: Effect.Effect<void>
    } | undefined
    let counter = 0

    // A fiber interrupted before it ever ran never reaches its own onInterrupt, so cancel() settles the record.
    const interruptCurrent = Effect.suspend(() => {
      const turn = current
      return turn === undefined ? Effect.void : Fiber.interrupt(turn.fiber).pipe(Effect.andThen(turn.cancel))
    })

    const startTurn = (userText: string) =>
      Effect.gen(function*() {
        yield* interruptCurrent
        const record: Mutable = {
          id: TurnId.make(`t${++counter}`), userText, sentences: [], sources: [], status: "completed"
        }
        const history = historyOf(done.map(freeze))
        let finished = false
        const finish = (interrupted: boolean) => {
          if (finished) return Effect.void
          finished = true
          done.push(record)
          if (current?.record === record) current = undefined
          return Effect.logInfo(
            `turn ${record.id} ${interrupted ? "interrupted" : record.status} first-sentence=${firstSentenceMs ?? "-"}ms first-audio=${firstAudioMs ?? "-"}ms`
          ).pipe(Effect.andThen(out.control({ _tag: "TurnEnd", turnId: record.id, interrupted, sources: record.sources })))
        }

        const t0 = performance.now()
        let firstSentenceMs: number | undefined, firstAudioMs: number | undefined
        const body = runTurn({ persona, history, userText }).pipe(
          Stream.runForEach((event) => {
            switch (event._tag) {
              case "SentenceStart":
                firstSentenceMs ??= Math.round(performance.now() - t0)
                record.sentences.push({ id: event.sentenceId, text: event.text, played: false })
                return out.control({
                  _tag: "SentenceStart", turnId: record.id, sentenceId: SentenceId.make(event.sentenceId), text: event.text
                })
              case "Audio":
                firstAudioMs ??= Math.round(performance.now() - t0)
                return out.audio(event.sentenceId, event.chunk)
              case "Finished":
                record.sources = event.sources
                return Effect.void
            }
          }),
          Effect.flatMap(() => finish(false)),
          Effect.catch((error) => {
            record.status = "failed"
            return out.control({ _tag: "Failure", message: error.message }).pipe(Effect.andThen(finish(false)))
          }),
          Effect.onInterrupt(() => Effect.suspend(() => {
            record.status = "interrupted"
            return finish(true)
          }))
        )
        const fiber = yield* Effect.forkIn(body, scope)
        current = {
          fiber, record,
          cancel: Effect.suspend(() => {
            if (finished) return Effect.void
            record.status = "interrupted"
            return finish(true)
          })
        }
      })

    const receive: Session["receive"] = (message) => {
      switch (message._tag) {
        case "UserText":
          return startTurn(message.text)
        case "SpeechStart":
        case "BargeIn":
          return interruptCurrent
        case "SpeechEnd":
          return Effect.void
        case "SentencePlayed":
          return Effect.sync(() => {
            const record = [...done, ...(current ? [current.record] : [])].find((t) => t.id === message.turnId)
            const sentence = record?.sentences.find((s) => s.id === message.sentenceId)
            if (sentence) sentence.played = true
          })
      }
    }

    const receiveSpeech: Session["receiveSpeech"] = (pcm) => {
      const t0 = performance.now()
      return Stt.use((stt) => stt.transcribe(pcm)).pipe(
        Effect.tap(() => Effect.logInfo(`stt ${(pcm.length / 32000).toFixed(1)}s of speech in ${Math.round(performance.now() - t0)}ms`)),
        Effect.flatMap((text) =>
          text.trim().length === 0
            ? Effect.void
            : out.control({ _tag: "Transcript", turnId: TurnId.make(`t${counter + 1}`), text, final: true }).pipe(
              Effect.andThen(startTurn(text))
            )
        ),
        Effect.catch((error) => out.control({ _tag: "Failure", message: error.message }))
      )
    }

    return {
      receive,
      receiveSpeech,
      idle: Effect.suspend(() => current === undefined ? Effect.void : Fiber.await(current.fiber).pipe(Effect.asVoid)),
      turns: Effect.sync(() => done.map(freeze))
    }
  })
