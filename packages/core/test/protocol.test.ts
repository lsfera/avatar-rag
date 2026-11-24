import { assert, describe, it } from "@effect/vitest"
import { Effect } from "effect"
import { decodeClientMessage, encodeServerMessage, SentenceId, Turn, TurnId, SpokenSentence } from "../src/index.js"

describe("protocol", () => {
  it.effect("decodes a client message from JSON", () =>
    Effect.gen(function*() {
      const m = yield* decodeClientMessage(`{"_tag":"UserText","text":"ciao"}`)
      assert.strictEqual(m._tag, "UserText")
    }))
  it.effect("rejects unknown tags", () =>
    Effect.gen(function*() {
      const r = yield* Effect.flip(decodeClientMessage(`{"_tag":"Nope"}`))
      assert.isDefined(r)
    }))
  it.effect("encodes a server message", () =>
    Effect.gen(function*() {
      const s = yield* encodeServerMessage({ _tag: "Failure", message: "x" })
      assert.strictEqual(JSON.parse(s)._tag, "Failure")
    }))
})

describe("Turn", () => {
  it("heardText keeps only played sentences", () => {
    const t = new Turn({
      id: TurnId.make("t1"), userText: "?", sources: [], status: "interrupted",
      sentences: [
        new SpokenSentence({ id: SentenceId.make(0), text: "Uno.", played: true }),
        new SpokenSentence({ id: SentenceId.make(1), text: "Due.", played: false })
      ]
    })
    assert.strictEqual(t.heardText, "Uno.")
  })
})
