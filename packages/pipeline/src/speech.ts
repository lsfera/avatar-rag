import { Effect, Layer, Schema, Stream } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Stt, SttError, Tts, TtsError } from "./services.js"

/** Wraps raw 16-bit mono PCM in a canonical 44-byte WAV header. */
export const pcm16ToWav = (pcm: Uint8Array, sampleRate: number): Uint8Array => {
  const wav = new Uint8Array(44 + pcm.length)
  const view = new DataView(wav.buffer)
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) wav[at + i] = s.charCodeAt(i) }
  ascii(0, "RIFF"); view.setUint32(4, 36 + pcm.length, true); ascii(8, "WAVE")
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, "data"); view.setUint32(40, pcm.length, true)
  wav.set(pcm, 44)
  return wav
}

/** Re-chunks a byte stream so every emitted chunk holds whole 16-bit samples. */
export const alignToSamples = <E, R>(bytes: Stream.Stream<Uint8Array, E, R>): Stream.Stream<Uint8Array, E, R> =>
  bytes.pipe(
    Stream.mapAccum(
      () => new Uint8Array(0),
      (carry: Uint8Array, chunk: Uint8Array) => {
        const joined = new Uint8Array(carry.length + chunk.length)
        joined.set(carry, 0); joined.set(chunk, carry.length)
        const whole = joined.length - (joined.length % 2)
        return [joined.slice(whole), whole > 0 ? [joined.slice(0, whole)] : []] as const
      }
    )
  )

const messageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)
const Transcription = Schema.Struct({ text: Schema.String })

export interface SttOptions {
  /** Server root; the request goes to `${baseUrl}/v1/audio/transcriptions` (OpenAI-compatible). */
  readonly baseUrl: string
  readonly language?: string
  readonly model?: string
}

/** Stt over an OpenAI-compatible transcription endpoint (faster-whisper, whisper.cpp, mlx-audio...). */
export const HttpStt = (opts: SttOptions): Layer.Layer<Stt, never, HttpClient.HttpClient> =>
  Layer.effect(
    Stt,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient
      return Stt.of({
        transcribe: (pcm) => {
          const form = new FormData()
          form.append("file", new Blob([pcm16ToWav(pcm, 16_000) as BlobPart], { type: "audio/wav" }), "speech.wav")
          form.append("language", opts.language ?? "it")
          form.append("model", opts.model ?? "whisper")
          return HttpClientRequest.post(`${opts.baseUrl}/v1/audio/transcriptions`).pipe(
            HttpClientRequest.bodyFormData(form),
            client.execute,
            Effect.flatMap(HttpClientResponse.filterStatusOk),
            Effect.flatMap(HttpClientResponse.schemaBodyJson(Transcription)),
            Effect.map((r) => r.text.trim()),
            Effect.mapError((cause) => new SttError({ message: messageOf(cause) }))
          )
        }
      })
    })
  )

export interface TtsOptions {
  /** Server root; the request goes to `${baseUrl}/v1/audio/speech` (OpenAI/Kokoro-FastAPI style). */
  readonly baseUrl: string
  readonly model?: string
}

/** Tts over a streaming OpenAI-style speech endpoint returning 24 kHz mono PCM16 (`response_format: "pcm"`). */
export const HttpTts = (opts: TtsOptions): Layer.Layer<Tts, never, HttpClient.HttpClient> =>
  Layer.effect(
    Tts,
    Effect.gen(function*() {
      const client = yield* HttpClient.HttpClient
      return Tts.of({
        synthesize: (text, voice) =>
          Stream.unwrap(
            HttpClientRequest.post(`${opts.baseUrl}/v1/audio/speech`).pipe(
              HttpClientRequest.bodyJsonUnsafe({
                model: opts.model ?? "tts", input: text, voice, response_format: "pcm"
              }),
              client.execute,
              Effect.flatMap(HttpClientResponse.filterStatusOk),
              Effect.map((res) => alignToSamples(res.stream))
            )
          ).pipe(Stream.mapError((cause) => new TtsError({ message: messageOf(cause) })))
      })
    })
  )

/** Linear-interpolation resampler for 16-bit mono PCM; good enough for speech-band audio. */
export const resamplePcm16 = (pcm: Uint8Array, fromRate: number, toRate: number): Uint8Array => {
  if (fromRate === toRate) return pcm
  const input = new Int16Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength - (pcm.byteLength % 2)))
  const outLength = Math.floor(input.length * toRate / fromRate)
  const out = new Int16Array(outLength)
  const ratio = fromRate / toRate
  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const frac = pos - i0
    const a = input[i0] ?? 0
    const b = input[Math.min(i0 + 1, input.length - 1)] ?? a
    out[i] = Math.round(a + (b - a) * frac)
  }
  return new Uint8Array(out.buffer)
}
