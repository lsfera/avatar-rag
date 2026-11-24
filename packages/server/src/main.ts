import { readFileSync } from "node:fs"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { Config, Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Persona } from "@avatar/core"
import {
  HttpStt, HttpTts, MemoryRetriever, OllamaEmbeddings, OllamaLlm, SilentTts, Stt, SttError, warmModel,
  type KnowledgePassage
} from "@avatar/pipeline"
import { serveConnection } from "./connection.js"

const makePersona = (voice: string) => new Persona({
  name: "Sofia", language: "it", voice,
  systemPrompt:
    "Sei Sofia, la guida virtuale del Museo Civico di Villa Aurelia. Rispondi sempre in italiano, " +
    "in modo cordiale e naturale, in una o due frasi brevi, come parleresti ad alta voce: " +
    "niente elenchi, niente markdown, niente emoji."
})

const NotConfiguredStt = Layer.succeed(Stt, Stt.of({
  transcribe: () => Effect.fail(new SttError({ message: "STT server not configured (set STT_URL); use text input" }))
}))

const App = Effect.gen(function*() {
  const ollamaUrl = yield* Config.String("OLLAMA_URL").pipe(Config.withDefault("http://host.docker.internal:11434"))
  const model = yield* Config.String("LLM_MODEL").pipe(Config.withDefault("qwen3.6:35b-a3b"))
  const embedModel = yield* Config.String("EMBED_MODEL").pipe(Config.withDefault("bge-m3"))
  const knowledgeFile = yield* Config.String("KNOWLEDGE_FILE").pipe(Config.withDefault(fileURLToPath(new URL("../../../knowledge/villa-aurelia.json", import.meta.url))))
  const sttUrl = yield* Config.String("STT_URL").pipe(Config.option)
  const ttsUrl = yield* Config.String("TTS_URL").pipe(Config.option)
  const ttsVoice = yield* Config.String("TTS_VOICE").pipe(Config.withDefault("it_IT-paola-medium"))
  const port = yield* Config.Number("PORT").pipe(Config.withDefault(3000))

  const llmOptions = { baseUrl: ollamaUrl, model, keepAlive: "30m", reasoningEffort: "none", maxTokens: 200, temperature: 0.3 } as const
  const knowledge: ReadonlyArray<KnowledgePassage> = JSON.parse(readFileSync(knowledgeFile, "utf8"))

  if (Option.isNone(sttUrl)) yield* Effect.logWarning("STT_URL not set: voice input disabled, text input only")
  if (Option.isNone(ttsUrl)) yield* Effect.logWarning("TTS_URL not set: using SilentTts (no audible speech)")
  yield* warmModel(llmOptions).pipe(Effect.provide(FetchHttpClient.layer))

  const Backends = Layer.mergeAll(
    OllamaLlm(llmOptions),
    MemoryRetriever(knowledge).pipe(Layer.provide(OllamaEmbeddings({ baseUrl: ollamaUrl, model: embedModel }))),
    Option.isSome(ttsUrl) ? HttpTts({ baseUrl: ttsUrl.value }) : SilentTts(),
    Option.isSome(sttUrl) ? HttpStt({ baseUrl: sttUrl.value }) : NotConfiguredStt
  ).pipe(Layer.provide(FetchHttpClient.layer))

  const persona = makePersona(ttsVoice)
  const Ws = HttpRouter.add("GET", "/ws", Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest
    const socket = yield* request.upgrade
    yield* serveConnection(socket, persona).pipe(Effect.scoped, Effect.provide(Backends))
    return HttpServerResponse.empty()
  }))
  const Health = HttpRouter.add("GET", "/health", HttpServerResponse.text("ok"))

  return HttpRouter.serve(Layer.mergeAll(Ws, Health)).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port, host: "0.0.0.0" }))
  )
})

Layer.unwrap(App).pipe(Layer.launch, NodeRuntime.runMain)
