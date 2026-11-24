import { assert, describe, it } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { alignToSamples, pcm16ToWav, resamplePcm16 } from "../src/index.js"

describe("pcm16ToWav", () => {
  it("writes a valid 16 kHz mono header", () => {
    const wav = pcm16ToWav(new Uint8Array([1, 0, 2, 0]), 16_000)
    const view = new DataView(wav.buffer)
    assert.strictEqual(String.fromCharCode(...wav.slice(0, 4)), "RIFF")
    assert.strictEqual(String.fromCharCode(...wav.slice(8, 12)), "WAVE")
    assert.strictEqual(view.getUint32(24, true), 16_000)
    assert.strictEqual(view.getUint16(22, true), 1)
    assert.strictEqual(view.getUint32(40, true), 4)
    assert.strictEqual(wav.length, 48)
  })
})

describe("alignToSamples", () => {
  it.effect("never splits a 16-bit sample across chunks", () =>
    Effect.gen(function*() {
      const out = yield* Stream.fromIterable([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])]).pipe(
        alignToSamples, Stream.runCollect
      )
      const chunks = Array.from(out)
      assert.isTrue(chunks.every((c) => c.length % 2 === 0))
      assert.deepStrictEqual(chunks.flatMap((c) => Array.from(c)), [1, 2, 3, 4, 5, 6])
    }))
})

describe("resamplePcm16", () => {
  const toBytes = (xs: number[]) => new Uint8Array(new Int16Array(xs).buffer)
  it("keeps length proportional to the rate ratio", () => {
    const out = resamplePcm16(toBytes(Array.from({ length: 2400 }, (_, i) => i)), 24_000, 16_000)
    assert.strictEqual(out.length / 2, 1600)
  })
  it("is the identity at equal rates and interpolates a ramp", () => {
    const ramp = toBytes([0, 100, 200, 300])
    assert.strictEqual(resamplePcm16(ramp, 16_000, 16_000), ramp)
    const up = new Int16Array(resamplePcm16(ramp, 16_000, 32_000).buffer)
    assert.deepStrictEqual(Array.from(up.slice(0, 5)), [0, 50, 100, 150, 200])
  })
})
