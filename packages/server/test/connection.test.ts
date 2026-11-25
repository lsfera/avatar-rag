import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { Socket } from "effect/socket"
import { Persona, decodeAudioFrame } from "@avatar/core"
import { FakeLlm, FakeRetriever, FakeStt, FakeTts, RuleGuardrail } from "@avatar/pipeline"
import { serveConnection } from "../src/connection.js"

const persona = new Persona({ name: "Sofia", language: "it", systemPrompt: "Sei Sofia.", voice: "if_sara" })

/** A socket fed from `incoming`, recording everything the server writes. */
const fakeSocket = (incoming: ReadonlyArray<string | Uint8Array>) => {
  const sent: Array<string | Uint8Array> = []
  let delivered = false
  const socket = {
    [Socket.TypeId]: Socket.TypeId,
    reader: Effect.succeed({
      pull: Effect.suspend(() =>
        delivered || incoming.length === 0
          ? Effect.fail(new Socket.SocketError({ reason: new Socket.SocketReadError({ cause: "closed" }) }))
          : Effect.sync(() => { delivered = true; return incoming as [string | Uint8Array, ...Array<string | Uint8Array>] })
      ),
      upgrade: () => Effect.void
    }),
    writer: Effect.succeed({
      write: (chunk: Uint8Array | string | Socket.CloseEvent) =>
        Effect.sync(() => { if (!Socket.isCloseEvent(chunk)) sent.push(chunk) }),
      writeAll: (chunks: ReadonlyArray<Uint8Array | string>) => Effect.sync(() => { sent.push(...chunks) })
    })
  } as unknown as Socket.Socket
  return { socket, sent }
}

const backends = (text: string[]) =>
  Layer.mergeAll(FakeLlm(text), FakeTts(undefined, new Uint8Array([5, 6])), FakeRetriever([]), RuleGuardrail, FakeStt("Quando apre?"))

describe("serveConnection", () => {
  it.live("answers a text message with control frames and tagged audio", () =>
    Effect.gen(function*() {
      const { socket, sent } = fakeSocket([JSON.stringify({ _tag: "UserText", text: "Ciao" })])
      yield* Effect.scoped(Effect.gen(function*() {
        yield* serveConnection(socket, persona)
        yield* Effect.sleep(50) // let the Turn fiber finish before the scope closes it
      })).pipe(Effect.provide(backends(["Ciao! ", "Come va?"])))
      const text = sent.filter((f): f is string => typeof f === "string").map((s) => JSON.parse(s)._tag)
      assert.deepStrictEqual(text, ["SentenceStart", "SentenceStart", "TurnEnd"])
      const audio = sent.filter((f): f is Uint8Array => typeof f !== "string").map(decodeAudioFrame)
      assert.deepStrictEqual(audio.map((a) => a.sentenceId), [0, 1])
      assert.deepStrictEqual(Array.from(audio[0]!.pcm), [5, 6])
    }))

  it.live("buffers binary speech between SpeechStart and SpeechEnd, then transcribes", () =>
    Effect.gen(function*() {
      const { socket, sent } = fakeSocket([
        JSON.stringify({ _tag: "SpeechStart" }), new Uint8Array([1, 2, 3, 4]), JSON.stringify({ _tag: "SpeechEnd" })
      ])
      yield* Effect.scoped(Effect.gen(function*() {
        yield* serveConnection(socket, persona)
        yield* Effect.sleep(50)
      })).pipe(Effect.provide(backends(["Apre alle nove."])))
      const tags = sent.filter((f): f is string => typeof f === "string").map((s) => JSON.parse(s))
      assert.strictEqual(tags[0]._tag, "Transcript")
      assert.strictEqual(tags[0].text, "Quando apre?")
    }))

  it.live("reports malformed messages as Failure without dropping the connection", () =>
    Effect.gen(function*() {
      const { socket, sent } = fakeSocket(["not json"])
      yield* Effect.scoped(serveConnection(socket, persona)).pipe(Effect.provide(backends(["x."])))
      const first = JSON.parse(sent[0] as string)
      assert.strictEqual(first._tag, "Failure")
    }))
})
