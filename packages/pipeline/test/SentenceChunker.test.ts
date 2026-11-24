import { assert, describe, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { chunkSentences, splitSentences } from "../src/index.js"

describe("splitSentences", () => {
  it("splits plain Italian sentences, keeping the unfinished tail", () => {
    const r = splitSentences("Ciao! Come stai? Io sto be")
    assert.deepStrictEqual(r.sentences, ["Ciao!", "Come stai?"])
    assert.strictEqual(r.rest, " Io sto be")
  })
  it("does not split on abbreviations", () => {
    const r = splitSentences("Il dott. Rossi e la sig. Bianchi arrivano. Poi ecc. e basta. ")
    assert.deepStrictEqual(r.sentences, ["Il dott. Rossi e la sig. Bianchi arrivano.", "Poi ecc. e basta."])
  })
  it("does not split on decimals or initials", () => {
    const r = splitSentences("Costa 3.14 euro. A. Manzoni scrisse molto. ")
    assert.deepStrictEqual(r.sentences, ["Costa 3.14 euro.", "A. Manzoni scrisse molto."])
  })
  it("waits for more input after a trailing terminator", () => {
    const r = splitSentences("Fine.")
    assert.deepStrictEqual(r.sentences, [])
    assert.strictEqual(r.rest, "Fine.")
  })
  it("swallows ?! and ellipsis runs", () => {
    const r = splitSentences("Davvero?! Boh... Va bene. ")
    assert.deepStrictEqual(r.sentences, ["Davvero?!", "Boh...", "Va bene."])
  })
})

describe("chunkSentences", () => {
  it.effect("reassembles token deltas and flushes the tail", () =>
    Effect.gen(function*() {
      const out = yield* Stream.fromIterable(["Ciao", " mondo", ". Come", " va?", " Tutto b", "ene"]).pipe(
        chunkSentences,
        Stream.runCollect
      )
      assert.deepStrictEqual(Array.from(out), ["Ciao mondo.", "Come va?", "Tutto bene"])
    }))
})
