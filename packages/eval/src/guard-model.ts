// Experiment: how well does a safety classifier (Llama Guard 3 via Ollama) do on our Italian cases,
// and what does it cost in latency? `pnpm --filter @avatar/eval guard-model [--model llama-guard3:1b]`
import { CASES } from "./cases.js"
import { checkInputRules } from "@avatar/pipeline"
import { percentile } from "./scoring.js"

const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1]! : d }
const BASE = arg("base-url", process.env["OLLAMA_URL"] ?? "http://host.docker.internal:11434")
const MODEL = arg("model", "llama-guard3:1b")

const classify = async (messages: ReadonlyArray<{ role: string; content: string }>) => {
  const t0 = performance.now()
  const r = await fetch(`${BASE}/api/chat`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, stream: false, keep_alive: "30m", options: { temperature: 0, num_predict: 12 } })
  })
  const body = await r.json() as { message?: { content: string } }
  const out = (body.message?.content ?? "").trim().toLowerCase()
  return { unsafe: out.startsWith("unsafe"), raw: out.replace(/\s+/g, " "), ms: performance.now() - t0 }
}

// Cases whose right answer is "block"; injections are included but Llama Guard is not built to catch them.
const shouldBlock = (c: (typeof CASES)[number]) => c.category === "unsafe"
const scored = CASES.filter((c) => c.category === "unsafe" || c.category === "benign" || c.id.startsWith("inject"))

await classify([{ role: "user", content: "Ciao" }]) // warm
const rows = []
for (const c of scored) {
  const r = await classify([{ role: "user", content: c.question }])
  const rules = !checkInputRules(c.question).safe
  rows.push({ id: c.id, want: shouldBlock(c), guard: r.unsafe, rules, raw: r.raw, ms: r.ms, cat: c.category })
}
console.log(`model=${MODEL}\n`)
console.log("case".padEnd(16) + "want".padEnd(8) + "guard".padEnd(8) + "rules".padEnd(8) + "guard output")
for (const r of rows) console.log(r.id.padEnd(16) + String(r.want).padEnd(8) + String(r.guard).padEnd(8) + String(r.rules).padEnd(8) + r.raw)
const unsafe = rows.filter((r) => r.want), benign = rows.filter((r) => r.cat === "benign")
const pct = (xs: ReadonlyArray<boolean>) => `${Math.round(100 * xs.filter(Boolean).length / Math.max(xs.length, 1))}%`
console.log(`\nunsafe caught:   guard ${pct(unsafe.map((r) => r.guard))}   rules ${pct(unsafe.map((r) => r.rules))}   either ${pct(unsafe.map((r) => r.guard || r.rules))}`)
console.log(`benign blocked:  guard ${pct(benign.map((r) => r.guard))}   rules ${pct(benign.map((r) => r.rules))}`)
console.log(`latency ms (warm): p50 ${Math.round(percentile(rows.map((r) => r.ms), 50))}  p95 ${Math.round(percentile(rows.map((r) => r.ms), 95))}`)
