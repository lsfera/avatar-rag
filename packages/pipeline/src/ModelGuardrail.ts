import { Effect, Layer, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { checkInputRules, checkOutputRules, Guardrail, type HarmCategory, type Verdict } from "./Guardrail.js"

/** Llama Guard 3 hazard codes mapped to our categories. Anything unlisted counts as `illegal`. */
const CODES: Readonly<Record<string, HarmCategory>> = {
  s1: "violence", s2: "illegal", s3: "sexual", s4: "sexual", s5: "hate", s9: "violence",
  s10: "hate", s11: "self-harm", s12: "sexual"
}

/** Llama Guard answers `safe`, or `unsafe` followed by a line of hazard codes such as `S10`. */
export const parseGuardOutput = (raw: string): Verdict => {
  const text = raw.trim().toLowerCase()
  if (!text.startsWith("unsafe")) return { safe: true }
  const code = /s\d+/.exec(text)?.[0]
  return { safe: false, category: (code === undefined ? undefined : CODES[code]) ?? "illegal" }
}

/**
 * Rules first (free), then a model classifier on what the rules let through. The classifier is advisory:
 * a timeout or an error fails open to the rules' verdict, so a slow or down guard never takes the avatar down.
 * Output stays rules-only, because classifying every Sentence would add latency to every spoken word.
 */
export const GuardrailWithClassifier = (
  classify: (text: string) => Effect.Effect<string, unknown>,
  timeoutMs = 400
): Layer.Layer<Guardrail> =>
  Layer.succeed(Guardrail, Guardrail.of({
    checkInput: (text) => {
      const byRules = checkInputRules(text)
      return !byRules.safe ? Effect.succeed(byRules) : classify(text).pipe(
        Effect.timeout(`${timeoutMs} millis`),
        Effect.map(parseGuardOutput),
        Effect.catch((e) => Effect.as(Effect.logWarning(`guard model unavailable, using rules only: ${e instanceof Error ? e.message : String(e)}`), byRules))
      )
    },
    checkOutput: (sentence) => Effect.succeed(checkOutputRules(sentence))
  }))

const ChatResponse = Schema.Struct({
  choices: Schema.Array(Schema.Struct({ message: Schema.Struct({ content: Schema.String }) }))
})
const decodeChat = Schema.decodeUnknownEffect(ChatResponse)

export interface LlamaGuardOptions {
  /** Server root such that `${baseUrl}/v1/chat/completions` works: Ollama, or Docker Model Runner's `.../engines`. */
  readonly baseUrl: string
  readonly model: string
  readonly timeoutMs?: number
}

/** Llama Guard 3 behind any OpenAI-compatible server (ADR 0004). */
export const LlamaGuardrail = (opts: LlamaGuardOptions): Layer.Layer<Guardrail, never, HttpClient.HttpClient> =>
  Layer.unwrap(Effect.gen(function*() {
    const client = yield* HttpClient.HttpClient
    const classify = (text: string) =>
      HttpClientRequest.post(`${opts.baseUrl}/v1/chat/completions`).pipe(
        HttpClientRequest.bodyJsonUnsafe({
          model: opts.model, stream: false, temperature: 0, max_tokens: 12,
          messages: [{ role: "user", content: text }]
        }),
        client.execute,
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((res) => res.json),
        Effect.flatMap(decodeChat),
        Effect.map((r) => r.choices[0]?.message.content ?? "safe")
      )
    return GuardrailWithClassifier(classify, opts.timeoutMs)
  }))
