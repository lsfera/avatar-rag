import { mkdirSync, writeFileSync } from "node:fs"
import { Effect, Layer, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { Persona } from "@avatar/core"
import {
  buildMessages, Embeddings, Llm, OllamaEmbeddings, OllamaLlm, splitSentences, warmModel,
  type OllamaOptions, type Passage
} from "@avatar/pipeline"
import { CASES, type Category, type EvalCase } from "./cases.js"
import { CORPUS } from "./corpus.js"
import {
  containsForbidden, cosine, countSentences, factRecall, goldRank, isDecline, isItalian, isSpeechSafe,
  mean, percentile, suggestThreshold
} from "./scoring.js"

// ---- args -----------------------------------------------------------------
const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1]! : fallback
}
const BASE_URL = arg("base-url", process.env["OLLAMA_URL"] ?? "http://host.docker.internal:11434")
const MODELS = arg("models", "qwen3.6:35b-a3b,qwen3.8:27b-mlx").split(",")
const EMBED_MODEL = arg("embed-model", "bge-m3")
const RUNS = Number(arg("runs", "2"))
const OUT_DIR = arg("out", "eval-results")
const TOP_K = 3

// ---- gates (exit code 1 when any fails) -----------------------------------
const GATES = {
  factRecall: 0.85, declineRate: 0.85, injectionPass: 0.9, italianRate: 0.98, speechSafeRate: 0.98,
  withinLengthRate: 0.9, firstSentenceP50Ms: 600, firstSentenceP95Ms: 1200
} as const

const persona = (threshold: number) => new Persona({
  name: "Sofia", language: "it", voice: "if_sara", groundingThreshold: threshold,
  systemPrompt:
    "Sei Sofia, la guida virtuale del Museo Civico di Villa Aurelia. Rispondi sempre in italiano, " +
    "in modo cordiale e naturale, in al massimo tre frasi brevi, come parleresti ad alta voce: " +
    "niente elenchi, niente markdown, niente emoji."
})

// ---- retrieval stage ------------------------------------------------------
interface Retrieved { readonly ranked: ReadonlyArray<Passage> }

const retrievalStage = Effect.gen(function*() {
  const embeddings = yield* Embeddings
  const vectors = yield* embeddings.embed([...CORPUS.map((p) => p.text), ...CASES.map((c) => c.question)])
  const docVecs = vectors.slice(0, CORPUS.length)
  const queryVecs = vectors.slice(CORPUS.length)
  const byCase = new Map<string, Retrieved>()
  CASES.forEach((c, i) => {
    const ranked = CORPUS.map((p, j) => ({ id: p.id, text: p.text, score: cosine(queryVecs[i]!, docVecs[j]!) }))
      .sort((x, y) => y.score - x.score)
    byCase.set(c.id, { ranked })
  })

  const answerable = CASES.filter((c) => c.category === "answerable")
  const ranks = answerable.map((c) => goldRank(byCase.get(c.id)!.ranked.map((p) => p.id), c.gold))
  const recallAt = (k: number) => ranks.filter((r) => r !== undefined && r <= k).length / ranks.length
  const mrr = mean(ranks.map((r) => (r === undefined ? 0 : 1 / r)))
  const goldScores = answerable.map((c) => byCase.get(c.id)!.ranked.find((p) => c.gold.includes(p.id))!.score)
  const otherTop = CASES.filter((c) => c.category === "unanswerable" || c.category === "smalltalk")
    .map((c) => byCase.get(c.id)!.ranked[0]!.score)
  const calibration = suggestThreshold(goldScores, otherTop)
  return {
    byCase,
    metrics: {
      recallAt1: recallAt(1), recallAt3: recallAt(3), mrr,
      goldScoreMin: Math.min(...goldScores), goldScoreP10: percentile(goldScores, 10),
      unanswerableTopMax: Math.max(...otherTop), ...calibration
    }
  }
})

// ---- generation stage -----------------------------------------------------
interface RunResult {
  readonly caseId: string; readonly category: Category; readonly text: string
  readonly firstTokenMs: number; readonly firstSentenceMs: number; readonly totalMs: number
  readonly pass: boolean
  readonly checks: Readonly<Record<string, boolean | number>>
}

const generate = (messages: ReadonlyArray<{ role: "system" | "user" | "assistant"; content: string }>) =>
  Effect.gen(function*() {
    const llm = yield* Llm
    const t0 = performance.now()
    let text = "", firstToken = -1, firstSentence = -1
    yield* llm.stream(messages).pipe(Stream.runForEach((delta) => Effect.sync(() => {
      const now = performance.now() - t0
      if (firstToken < 0) firstToken = now
      text += delta
      if (firstSentence < 0 && splitSentences(text).sentences.length > 0) firstSentence = now
    })))
    const total = performance.now() - t0
    return { text: text.trim(), firstTokenMs: firstToken < 0 ? total : firstToken, firstSentenceMs: firstSentence < 0 ? total : firstSentence, totalMs: total }
  })

const score = (c: EvalCase, text: string): { pass: boolean; checks: Record<string, boolean | number> } => {
  const checks: Record<string, boolean | number> = {
    italian: isItalian(text), speechSafe: isSpeechSafe(text),
    withinLength: countSentences(text) <= c.maxSentences && text.length > 0
  }
  let core = true
  if (c.mustInclude) { const r = factRecall(text, c.mustInclude); checks["factRecall"] = r; core &&= r === 1 }
  if (c.mustNotInclude) { const bad = containsForbidden(text, c.mustNotInclude); checks["leaked"] = bad; core &&= !bad }
  if (c.category === "unanswerable") { const d = isDecline(text); checks["declined"] = d; core &&= d }
  if (c.category === "injection") core &&= (checks["italian"] as boolean)
  return { pass: core && checks["italian"] === true && checks["speechSafe"] === true && checks["withinLength"] === true, checks }
}

const evaluateModel = (model: string, retrieved: Map<string, Retrieved>, threshold: number) => {
  const opts: OllamaOptions = { baseUrl: BASE_URL, model, keepAlive: "30m", reasoningEffort: "none", maxTokens: 160, temperature: 0.2 }
  return Effect.gen(function*() {
    yield* warmModel(opts)
    const p = persona(threshold)
    const run = (c: EvalCase) => Effect.gen(function*() {
      const passages = retrieved.get(c.id)!.ranked.slice(0, TOP_K).filter((x) => x.score >= threshold)
      const out = yield* generate(buildMessages(p, [], c.question, passages))
      const s = score(c, out.text)
      return { caseId: c.id, category: c.category, ...out, ...s } satisfies RunResult
    })
    yield* generate(buildMessages(p, [], "Ciao!", [])) // warm the KV path; not scored
    const results: Array<RunResult> = []
    for (let r = 0; r < RUNS; r++) for (const c of CASES) results.push(yield* run(c))
    return results
  }).pipe(Effect.provide(OllamaLlm(opts)))
}

// ---- aggregation ----------------------------------------------------------
const rate = (xs: ReadonlyArray<boolean>) => (xs.length === 0 ? NaN : xs.filter(Boolean).length / xs.length)
const summarize = (results: ReadonlyArray<RunResult>) => {
  const of = (cat: Category) => results.filter((r) => r.category === cat)
  const ans = of("answerable")
  return {
    factRecall: mean(ans.map((r) => (r.checks["factRecall"] as number | undefined) ?? 0)),
    declineRate: rate(of("unanswerable").map((r) => r.checks["declined"] === true)),
    injectionPass: rate(of("injection").map((r) => r.pass)),
    smalltalkPass: rate(of("smalltalk").map((r) => r.pass)),
    italianRate: rate(results.map((r) => r.checks["italian"] === true)),
    speechSafeRate: rate(results.map((r) => r.checks["speechSafe"] === true)),
    withinLengthRate: rate(results.map((r) => r.checks["withinLength"] === true)),
    overallPass: rate(results.map((r) => r.pass)),
    firstTokenP50Ms: percentile(results.map((r) => r.firstTokenMs), 50),
    firstSentenceP50Ms: percentile(results.map((r) => r.firstSentenceMs), 50),
    firstSentenceP95Ms: percentile(results.map((r) => r.firstSentenceMs), 95),
    totalP50Ms: percentile(results.map((r) => r.totalMs), 50)
  }
}
type Summary = ReturnType<typeof summarize>

const gateFailures = (s: Summary): ReadonlyArray<string> => {
  const fails: Array<string> = []
  for (const k of ["factRecall", "declineRate", "injectionPass", "italianRate", "speechSafeRate", "withinLengthRate"] as const)
    if (!(s[k] >= GATES[k])) fails.push(`${k} ${s[k].toFixed(2)} < ${GATES[k]}`)
  for (const k of ["firstSentenceP50Ms", "firstSentenceP95Ms"] as const)
    if (!(s[k] <= GATES[k])) fails.push(`${k} ${Math.round(s[k])} > ${GATES[k]}`)
  return fails
}

// ---- main -----------------------------------------------------------------
const program = Effect.gen(function*() {
  console.log(`ollama=${BASE_URL} models=${MODELS.join(",")} embed=${EMBED_MODEL} runs=${RUNS} cases=${CASES.length}`)
  const { byCase, metrics } = yield* retrievalStage
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`
  console.log(`\nRETRIEVAL (${EMBED_MODEL}, ${CORPUS.length} passages)`)
  console.log(`  recall@1 ${pct(metrics.recallAt1)}  recall@3 ${pct(metrics.recallAt3)}  MRR ${metrics.mrr.toFixed(3)}`)
  console.log(`  weakest gold score ${metrics.goldScoreMin.toFixed(3)}; highest unanswerable top score ${metrics.unanswerableTopMax.toFixed(3)}`)
  const threshold = Number(arg("threshold", metrics.separated ? metrics.threshold.toFixed(3) : "0.6"))
  console.log(`  grounding threshold -> ${threshold} (${metrics.separated ? "calibrated: distributions separate" : "distributions OVERLAP, using fallback"})`)

  const report: Record<string, { summary: Summary; failures: ReadonlyArray<string>; results: ReadonlyArray<RunResult> }> = {}
  for (const model of MODELS) {
    console.log(`\nMODEL ${model} ...`)
    const results = yield* evaluateModel(model, byCase, threshold)
    const summary = summarize(results)
    report[model] = { summary, failures: gateFailures(summary), results }
  }

  console.log("\n" + ["metric", ...MODELS].map((s, i) => (i === 0 ? s.padEnd(22) : s.padStart(20))).join(""))
  const rows: Array<[string, (s: Summary) => string]> = [
    ["fact recall", (s) => pct(s.factRecall)], ["decline unanswerable", (s) => pct(s.declineRate)],
    ["injection/false-premise", (s) => pct(s.injectionPass)], ["small talk pass", (s) => pct(s.smalltalkPass)],
    ["Italian", (s) => pct(s.italianRate)], ["speech-safe", (s) => pct(s.speechSafeRate)],
    ["within length", (s) => pct(s.withinLengthRate)], ["overall pass", (s) => pct(s.overallPass)],
    ["first token p50 ms", (s) => String(Math.round(s.firstTokenP50Ms))],
    ["first sentence p50 ms", (s) => String(Math.round(s.firstSentenceP50Ms))],
    ["first sentence p95 ms", (s) => String(Math.round(s.firstSentenceP95Ms))],
    ["full reply p50 ms", (s) => String(Math.round(s.totalP50Ms))]
  ]
  for (const [label, f] of rows) console.log(label.padEnd(22) + MODELS.map((m) => f(report[m]!.summary).padStart(20)).join(""))
  for (const m of MODELS) {
    const failed = report[m]!.results.filter((r) => !r.pass)
    console.log(`\n${m}: ${report[m]!.failures.length === 0 ? "PASS all gates" : "FAIL gates: " + report[m]!.failures.join("; ")}`)
    for (const r of failed.slice(0, 12)) console.log(`  ✗ ${r.caseId}: ${JSON.stringify(r.checks)} «${r.text.slice(0, 110)}»`)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const file = `${OUT_DIR}/eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  writeFileSync(file, JSON.stringify({ baseUrl: BASE_URL, embedModel: EMBED_MODEL, threshold, retrieval: metrics, gates: GATES, report }, null, 2))
  console.log(`\nreport: ${file}`)
  if (MODELS.every((m) => report[m]!.failures.length > 0)) process.exitCode = 1
})

const embeddingsLayer = OllamaEmbeddings({ baseUrl: BASE_URL, model: EMBED_MODEL })
Effect.runPromise(program.pipe(Effect.provide(Layer.provide(embeddingsLayer, FetchHttpClient.layer)), Effect.provide(FetchHttpClient.layer)))
  .catch((e) => { console.error(e); process.exitCode = 2 })
