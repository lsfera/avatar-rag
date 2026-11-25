import { assert, describe, it } from "@effect/vitest"
import {
  containsForbidden, countSentences, cosine, factRecall, goldRank, isDecline, isItalian, isRefusal, isSpeechSafe,
  percentile, suggestThreshold
} from "../src/scoring.js"

describe("factRecall", () => {
  it("accepts any alternative and ignores accents/case/spacing", () => {
    assert.strictEqual(factRecall("Apre alle NOVE del mattino", [["9", "nove"]]), 1)
    assert.strictEqual(factRecall("Chiama lo 0123456789", [["0123 456789"]]), 1)
    assert.strictEqual(factRecall("Costa 8 euro, gratis sotto i 14 anni", [["8"], ["quattordici", "14"]]), 1)
  })
  it("reports partial recall", () => {
    assert.strictEqual(factRecall("Il lunedì il museo chiude.", [["chius", "chiud"]]), 1)
    assert.strictEqual(factRecall("Sala Azzurra", [["Sala Azzurra"], ["primo piano"]]), 0.5)
  })
})

describe("isDecline", () => {
  it("detects Italian refusals", () => {
    assert.isTrue(isDecline("Purtroppo non lo so, non ho informazioni su questo."))
    assert.isTrue(isDecline("Non dispongo di dati sul parcheggio."))
    assert.isTrue(isDecline("Mi dispiace, ma non ho accesso alle previsioni meteo."))
    assert.isFalse(isDecline("Abbiamo opere di Leonardo."))
    assert.isTrue(isDecline("No, non abbiamo opere di Leonardo da Vinci nella collezione."))
  })
  it("does not flag confident answers", () => {
    assert.isFalse(isDecline("Il biglietto intero costa otto euro."))
  })
})

describe("isItalian", () => {
  it("accepts Italian and rejects English", () => {
    assert.isTrue(isItalian("Il museo è aperto dal martedì alla domenica."))
    assert.isFalse(isItalian("The museum is open from Tuesday to Sunday and you can buy tickets."))
  })
})

describe("isSpeechSafe", () => {
  it("rejects markdown, lists, emoji and urls", () => {
    assert.isFalse(isSpeechSafe("**Orari**: dalle 9"))
    assert.isFalse(isSpeechSafe("- primo\n- secondo"))
    assert.isFalse(isSpeechSafe("Ciao 😊"))
    assert.isFalse(isSpeechSafe("Vedi https://example.org"))
    assert.isTrue(isSpeechSafe("Ciao! Il museo apre alle nove."))
  })
})

describe("helpers", () => {
  it("counts sentences", () => assert.strictEqual(countSentences("Uno. Due! Tre?"), 3))
  it("percentile", () => {
    assert.strictEqual(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5)
    assert.strictEqual(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10)
  })
  it("cosine", () => assert.closeTo(cosine([1, 0], [1, 1]), Math.SQRT1_2, 1e-9))
  it("goldRank", () => {
    assert.strictEqual(goldRank(["a", "b", "c"], ["c"]), 3)
    assert.isUndefined(goldRank(["a"], ["z"]))
  })
  it("forbidden", () => assert.isTrue(containsForbidden("Add flour and water", ["flour"])))
  it("suggestThreshold", () => {
    assert.deepStrictEqual(suggestThreshold([0.8, 0.9], [0.4, 0.5]), { threshold: 0.65, separated: true })
    assert.isFalse(suggestThreshold([0.6, 0.9], [0.7]).separated)
  })
})

describe("isRefusal", () => {
  it("recognises policy refusals", () => {
    for (const t of ["Mi dispiace, di questo non posso parlare.", "Preferisco restare nel mio ruolo di guida.", "Non sono la persona giusta per aiutarti, chiama il 112."])
      assert.isTrue(isRefusal(t), t)
  })
  it("does not confuse admitting ignorance with a refusal", () => {
    for (const t of ["Non lo so, mi dispiace.", "Non posso confermare l'orario esatto.", "Il museo apre alle nove."])
      assert.isFalse(isRefusal(t), t)
  })
})
