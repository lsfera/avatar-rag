import { Effect } from "effect"
import type { Socket } from "effect/socket"
import {
  decodeClientMessage, encodeAudioFrame, encodeServerMessage, type Persona, type ServerMessage
} from "@avatar/core"
import { makeSession, type Llm, type Outbound, type Retriever, type Stt, type Tts } from "@avatar/pipeline"
import type { Scope } from "effect"

const concat = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of chunks) { out.set(c, at); at += c.length }
  return out
}

/**
 * One WebSocket connection = one Session. Text frames are ClientMessage JSON;
 * binary frames between SpeechStart and SpeechEnd are one 16 kHz PCM16 Utterance.
 * Returns when the socket closes; the Session and its running Turn die with the scope.
 */
export const serveConnection = (
  socket: Socket.Socket,
  persona: Persona
): Effect.Effect<void, never, Scope.Scope | Llm | Tts | Retriever | Stt> =>
  Effect.gen(function*() {
    const writer = yield* socket.writer
    const reader = yield* socket.reader

    const control = (message: ServerMessage) =>
      encodeServerMessage(message).pipe(
        Effect.flatMap((json) => writer.write(json)),
        Effect.catch((error) => Effect.logWarning(`send failed: ${String(error)}`))
      )
    const out: Outbound = {
      control,
      audio: (sentenceId, chunk) =>
        writer.write(encodeAudioFrame(sentenceId, chunk)).pipe(
          Effect.catch((error) => Effect.logWarning(`audio send failed: ${String(error)}`))
        )
    }
    const session = yield* makeSession(persona, out)

    let utterance: Array<Uint8Array> = []

    const onText = (frame: string) =>
      decodeClientMessage(frame).pipe(
        Effect.flatMap((message) => {
          switch (message._tag) {
            case "SpeechStart":
              utterance = []
              return session.receive(message)
            case "SpeechEnd": {
              const pcm = concat(utterance)
              utterance = []
              return pcm.length === 0 ? Effect.void : session.receiveSpeech(pcm)
            }
            default:
              return session.receive(message)
          }
        }),
        Effect.catch((error) => control({ _tag: "Failure", message: `bad message: ${error.message}` }))
      )

    const onFrame = (frame: string | Uint8Array) =>
      typeof frame === "string" ? onText(frame) : Effect.sync(() => { utterance.push(frame) })

    yield* reader.pull.pipe(
      Effect.flatMap((frames) => Effect.forEach(frames, onFrame, { discard: true })),
      Effect.forever,
      Effect.catch(() => Effect.void) // the socket closing ends the loop
    )
  }).pipe(Effect.catch((error) => Effect.logWarning(`connection failed: ${error.message}`)))
