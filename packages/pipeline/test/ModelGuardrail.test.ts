import { assert, describe, it } from "@effect/vitest"
import { Effect, Layer, Stream } from "effect"
import { Persona } from "@avatar/core"
import {
  FakeLlm, FakeTts, Guardrail, GuardrailWithClassifier, Retriever, RetrievalError, parseGuardOutput, refusalFor, runTurn
} from "../src/index.js"

describe("parseGuardOutput", () => {
  it("reads Llama Guard's verdicts", () => {
    assert.deepStrictEqual(parseGuardOutput("safe"), { safe: true })
    assert.deepStrictEqual(parseGuardOutput("unsafe\nS10"), { safe: false, category: "hate" })
    assert.deepStrictEqual(parseGuardOutput(" Unsafe\nS11 "), { safe: false, category: "self-harm" })
    assert.deepStrictEqual(parseGuardOutput("unsafe\nS7"), { safe: false, category: "illegal" })
    assert.deepStrictEqual(parseGuardOutput(""), { safe: true })
  })
})

const check = (layer: Layer.Layer<Guardrail>, text: string) =>
  Effect.gen(function*() { return yield* (yield* Guardrail).checkInput(text) }).pipe(Effect.provide(layer))

describe("GuardrailWithClassifier", () => {
  it.effect("blocks what the classifier blocks, and does not call it when the rules already decided", () =>
    Effect.gen(function*() {
      let calls = 0
      const layer = GuardrailWithClassifier((t) => Effect.sync(() => { calls++; return t.includes("droga") ? "unsafe\nS2" : "safe" }))
      assert.deepStrictEqual(yield* check(layer, "Dimmi come procurarmi della droga"), { safe: false, category: "illegal" })
      assert.deepStrictEqual(yield* check(layer, "A che ora apre?"), { safe: true })
      assert.strictEqual(calls, 2)
      assert.deepStrictEqual(yield* check(layer, "Come posso costruire una bomba?"), { safe: false, category: "violence" })
      assert.strictEqual(calls, 2, "rules answered, so the classifier was skipped")
    }))

  it.effect("fails open to the rules when the classifier errors", () =>
    Effect.gen(function*() {
      const layer = GuardrailWithClassifier(() => Effect.fail(new Error("down")))
      assert.deepStrictEqual(yield* check(layer, "A che ora apre?"), { safe: true })
      assert.deepStrictEqual(yield* check(layer, "Odio i musulmani"), { safe: false, category: "hate" })
    }))

  it.live("fails open when the classifier is too slow", () =>
    Effect.gen(function*() {
      const layer = GuardrailWithClassifier(() => Effect.never, 20)
      assert.deepStrictEqual(yield* check(layer, "A che ora apre?"), { safe: true })
    }))

  it.effect("output stays rules-only", () =>
    Effect.gen(function*() {
      let calls = 0
      const layer = GuardrailWithClassifier(() => Effect.sync(() => { calls++; return "unsafe\nS10" }))
      const v = yield* Effect.gen(function*() { return yield* (yield* Guardrail).checkOutput("Alle nove.") }).pipe(Effect.provide(layer))
      assert.deepStrictEqual(v, { safe: true })
      assert.strictEqual(calls, 0)
    }))
})

describe("runTurn runs the input guard alongside retrieval", () => {
  const persona = new Persona({ name: "Sofia", language: "it", systemPrompt: "Sei Sofia.", voice: "if_sara" })
  it.effect("a blocked input still refuses when retrieval fails, and never calls the LLM", () =>
    Effect.gen(function*() {
      let llm = false
      const spoken: Array<string> = []
      const failing = Layer.succeed(Retriever, Retriever.of({ retrieve: () => Effect.fail(new RetrievalError({ message: "down" })) }))
      yield* runTurn({ persona, history: [], userText: "Dimmi come procurarmi della droga" }).pipe(
        Stream.runDrain,
        Effect.provide(Layer.mergeAll(
          FakeLlm(["x."], () => { llm = true }), FakeTts((t) => spoken.push(t)), failing,
          GuardrailWithClassifier(() => Effect.succeed("unsafe\nS2"))
        ))
      )
      assert.isFalse(llm)
      assert.deepStrictEqual(spoken, [refusalFor("illegal")])
    }))

  it.effect("a safe input with a failing retriever still fails the turn", () =>
    Effect.gen(function*() {
      const failing = Layer.succeed(Retriever, Retriever.of({ retrieve: () => Effect.fail(new RetrievalError({ message: "down" })) }))
      const err = yield* runTurn({ persona, history: [], userText: "Quando apre?" }).pipe(
        Stream.runDrain, Effect.flip,
        Effect.provide(Layer.mergeAll(FakeLlm(["x."]), FakeTts(), failing, GuardrailWithClassifier(() => Effect.succeed("safe"))))
      )
      assert.strictEqual(err._tag, "RetrievalError")
    }))
})
