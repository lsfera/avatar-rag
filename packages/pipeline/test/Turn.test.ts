import { assert, describe, it } from "@effect/vitest"
import { Effect, Fiber, Layer, Stream } from "effect"
import { Persona } from "@avatar/core"
import { FakeLlm, FakeRetriever, FakeTts, Llm, RuleGuardrail, Tts, runTurn } from "../src/index.js"

const persona = new Persona({
  name: "Sofia", language: "it", systemPrompt: "Sei Sofia, un'assistente cordiale.",
  voice: "if_sara", groundingThreshold: 0.5
})

const run = (userText: string, layer: Layer.Layer<Llm | Tts | import("../src/index.js").Retriever>) =>
  runTurn({ persona, history: [], userText }).pipe(Stream.runCollect, Effect.provide(Layer.merge(layer, RuleGuardrail)))

describe("runTurn", () => {
  it.effect("streams sentences, audio and reports sources", () =>
    Effect.gen(function*() {
      const layer = Layer.mergeAll(
        FakeLlm(["Il museo apre ", "alle nove. ", "Ingresso libero."]),
        FakeTts(),
        FakeRetriever([{ id: "doc-1", text: "Il museo apre alle 9.", score: 0.9 }])
      )
      const events = Array.from(yield* run("Quando apre il museo?", layer))
      assert.deepStrictEqual(events.map((e) => e._tag), [
        "SentenceStart", "Audio", "SentenceStart", "Audio", "Finished"
      ])
      const last = events.at(-1)
      assert.deepStrictEqual(last?._tag === "Finished" ? last.sources : null, ["doc-1"])
    }))

  it.effect("injects passages above the threshold, and the don't-know rule below it", () =>
    Effect.gen(function*() {
      let grounded = "", ungrounded = ""
      const capture = (set: (s: string) => void) => (m: ReadonlyArray<unknown>) =>
        set((m[0] as { content: string }).content)
      yield* run("Quando apre?", Layer.mergeAll(
        FakeLlm(["Ok."], capture((s) => { grounded = s })), FakeTts(),
        FakeRetriever([{ id: "a", text: "Apre alle 9.", score: 0.8 }])
      ))
      yield* run("Quando apre?", Layer.mergeAll(
        FakeLlm(["Ok."], capture((s) => { ungrounded = s })), FakeTts(),
        FakeRetriever([{ id: "b", text: "Irrilevante.", score: 0.1 }])
      ))
      assert.include(grounded, "Apre alle 9.")
      assert.include(ungrounded, "non inventare")
      assert.notInclude(ungrounded, "Irrilevante.")
    }))

  it.effect("keeps low-scoring passages when no threshold is set", () =>
    Effect.gen(function*() {
      let seen = ""
      const open = new Persona({ name: "Sofia", language: "it", systemPrompt: "Sei Sofia.", voice: "if_sara" })
      yield* runTurn({ persona: open, history: [], userText: "Quando apre?" }).pipe(
        Stream.runDrain,
        Effect.provide(Layer.mergeAll(
          FakeLlm(["Ok."], (m) => { seen = (m[0] as { content: string }).content }), FakeTts(),
          FakeRetriever([{ id: "x", text: "Passaggio debole.", score: 0.05 }]), RuleGuardrail
        ))
      )
      assert.include(seen, "Passaggio debole.")
    }))

  it.effect("skips retrieval for trivial utterances", () =>
    Effect.gen(function*() {
      let seen = ""
      yield* run("Grazie!", Layer.mergeAll(
        FakeLlm(["Prego."], (m) => { seen = (m[0] as { content: string }).content }), FakeTts(),
        FakeRetriever([{ id: "a", text: "NON DEVE APPARIRE", score: 0.99 }])
      ))
      assert.notInclude(seen, "NON DEVE APPARIRE")
    }))

  it.live("interrupting the consumer cancels synthesis (barge-in)", () =>
    Effect.gen(function*() {
      let cancelled = false
      const slowTts = Layer.succeed(Tts, Tts.of({
        synthesize: () => Stream.fromEffect(Effect.never.pipe(Effect.onInterrupt(() => Effect.sync(() => { cancelled = true }))))
      }))
      const layer = Layer.mergeAll(FakeLlm(["Prima frase. ", "Seconda."]), slowTts, FakeRetriever([]), RuleGuardrail)
      const fiber = yield* Effect.forkChild(run("Raccontami tutto", layer))
      yield* Effect.sleep(20)
      yield* Fiber.interrupt(fiber)
      assert.isTrue(cancelled)
    }).pipe(Effect.provide(Layer.empty)), { timeout: 5000 })
})
