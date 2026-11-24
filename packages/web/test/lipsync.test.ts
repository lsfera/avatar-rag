import { assert, describe, it } from "@effect/vitest"
import { NO_VISEMES, bandsFromSpectrum, smooth, visemesFromBands } from "../src/lipsync.js"

const dominant = (v: object) => Object.entries(v as Record<string, number>).sort((a, b) => b[1] - a[1])[0]![0]

describe("visemesFromBands", () => {
  it("closes the mouth under the gate", () => {
    assert.deepStrictEqual(visemesFromBands({ low: 1, mid1: 1, mid2: 1, high: 1 }, 0.001), NO_VISEMES)
  })
  it("picks the vowel from the spectral balance", () => {
    assert.strictEqual(dominant(visemesFromBands({ low: 0.1, mid1: 1, mid2: 0.1, high: 0.05 }, 0.2)), "aa")
    assert.strictEqual(dominant(visemesFromBands({ low: 1, mid1: 0.1, mid2: 0.02, high: 0.01 }, 0.2)), "ou")
    assert.strictEqual(dominant(visemesFromBands({ low: 0.02, mid1: 0.1, mid2: 0.6, high: 1 }, 0.2)), "ee")
  })
  it("opens wider when louder, never beyond 1 in total", () => {
    const sum = (v: object) => Object.values(v as Record<string, number>).reduce((a, b) => a + b, 0)
    const quiet = sum(visemesFromBands({ low: 1, mid1: 1, mid2: 1, high: 1 }, 0.03))
    const loud = sum(visemesFromBands({ low: 1, mid1: 1, mid2: 1, high: 1 }, 0.4))
    assert.isAbove(loud, quiet)
    assert.isAtMost(loud, 1.0001)
  })
})

describe("smooth", () => {
  it("rises faster than it falls", () => {
    const up = smooth(0, 1, 0.016), down = 1 - smooth(1, 0, 0.016)
    assert.isAbove(up, down)
  })
})

describe("bandsFromSpectrum", () => {
  it("puts energy of a 700 Hz tone in the mid1 band", () => {
    const bins = 512, sampleRate = 24_000
    const db = new Float32Array(bins).fill(-120)
    db[Math.round(700 / (sampleRate / 2 / bins))] = -10
    const b = bandsFromSpectrum(db, sampleRate)
    assert.isAbove(b.mid1, b.low * 100)
    assert.isAbove(b.mid1, b.high * 100)
  })
})
