import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { Persona, SentenceId, TurnId, type ServerMessage } from "@avatar/core"
import { FakeLlm, FakeRetriever, FakeStt, FakeTts, Tts, makeSession, type Outbound } from "../src/index.js"

const persona = new Persona({ name: "Sofia", language: "it", systemPrompt: "Sei Sofia.", voice: "if_sara" })

const capture = () => {
  const control: Array<ServerMessage> = []
  const audio: Array<number> = []
  const out: Outbound = {
    control: (m) => Effect.sync(() => { control.push(m) }),
    audio: (id) => Effect.sync(() => { audio.push(id) })
  }
  return { control, audio, out }
}

const played = (turn: string, sentence: number) =>
  ({ _tag: "SentencePlayed", turnId: TurnId.make(turn), sentenceId: SentenceId.make(sentence) }) as const

describe("Session", () => {
  it.effect("runs a turn and reports TurnEnd", () =>
    Effect.scoped(Effect.gen(function*() {
      const { control, audio, out } = capture()
      const session = yield* makeSession(persona, out)
      yield* session.receive({ _tag: "UserText", text: "Ciao" })
      yield* session.idle
      assert.deepStrictEqual(control.map((m) => m._tag), ["SentenceStart", "SentenceStart", "TurnEnd"])
      assert.deepStrictEqual(audio, [0, 1])
      const end = control.at(-1)
      assert.isFalse(end?._tag === "TurnEnd" ? end.interrupted : true)
    }).pipe(Effect.provide(Layer.mergeAll(FakeLlm(["Uno. ", "Due."]), FakeTts(), FakeRetriever([]))))))

  it.effect("history keeps only sentences the client acked as played", () =>
    Effect.scoped(Effect.gen(function*() {
      const prompts: Array<ReadonlyArray<{ role: string; content: string }>> = []
      const { out } = capture()
      const layer = Layer.mergeAll(
        FakeLlm(["Prima frase. ", "Seconda frase."], (m) => { prompts.push(m as never) }),
        FakeTts(), FakeRetriever([])
      )
      yield* Effect.gen(function*() {
        const session = yield* makeSession(persona, out)
        yield* session.receive({ _tag: "UserText", text: "Raccontami" })
        yield* session.idle
        yield* session.receive(played("t1", 0)) // only the first sentence was heard
        yield* session.receive({ _tag: "UserText", text: "E poi?" })
        yield* session.idle
      }).pipe(Effect.provide(layer))
      const second = prompts[1]!
      const assistant = second.filter((m) => m.role === "assistant").map((m) => m.content)
      assert.deepStrictEqual(assistant, ["Prima frase."])
    })))

  it.live("barge-in interrupts the running turn and marks it interrupted", () =>
    Effect.scoped(Effect.gen(function*() {
      const { control, out } = capture()
      const hangingTts = Layer.succeed(Tts, Tts.of({ synthesize: () => Stream.fromEffect(Effect.never) }))
      yield* Effect.gen(function*() {
        const session = yield* makeSession(persona, out)
        yield* session.receive({ _tag: "UserText", text: "Parlami" })
        yield* Effect.sleep(30)
        yield* session.receive({ _tag: "BargeIn" })
        const turns = yield* session.turns
        assert.strictEqual(turns[0]?.status, "interrupted")
      }).pipe(Effect.provide(Layer.mergeAll(FakeLlm(["Frase lunga. ", "Altra."]), hangingTts, FakeRetriever([]))))
      const end = control.find((m) => m._tag === "TurnEnd")
      assert.isTrue(end?._tag === "TurnEnd" && end.interrupted)
    })))

  it.effect("a new user message interrupts the previous turn", () =>
    Effect.scoped(Effect.gen(function*() {
      const { out } = capture()
      const hangingTts = Layer.succeed(Tts, Tts.of({ synthesize: () => Stream.fromEffect(Effect.never) }))
      yield* Effect.gen(function*() {
        const session = yield* makeSession(persona, out)
        yield* session.receive({ _tag: "UserText", text: "Uno" })
        yield* session.receive({ _tag: "UserText", text: "Due" })
        const turns = yield* session.turns
        assert.deepStrictEqual(turns.map((t) => [t.userText, t.status]), [["Uno", "interrupted"]])
        yield* session.receive({ _tag: "BargeIn" })
      }).pipe(Effect.provide(Layer.mergeAll(FakeLlm(["Ok. "]), hangingTts, FakeRetriever([]))))
    })))

  it.effect("speech is transcribed and answered", () =>
    Effect.scoped(Effect.gen(function*() {
      const { control, out } = capture()
      yield* Effect.gen(function*() {
        const session = yield* makeSession(persona, out)
        yield* session.receiveSpeech(new Uint8Array([0, 0]))
        yield* session.idle
      }).pipe(Effect.provide(Layer.mergeAll(FakeLlm(["Certo."]), FakeTts(), FakeRetriever([]), FakeStt("Quando apre?"))))
      const t = control.find((m) => m._tag === "Transcript")
      assert.isTrue(t?._tag === "Transcript" && t.text === "Quando apre?")
      assert.isTrue(control.some((m) => m._tag === "TurnEnd"))
    })))
})
