import { Schema } from "effect"
import { SentenceId, TurnId } from "./domain.js"

/** Control messages sent as JSON text frames. Audio travels in binary frames. */
export const ClientMessage = Schema.Union([
  Schema.TaggedStruct("UserText", { text: Schema.NonEmptyString }),
  Schema.TaggedStruct("SpeechStart", {}),
  Schema.TaggedStruct("SpeechEnd", {}),
  Schema.TaggedStruct("BargeIn", {}),
  Schema.TaggedStruct("SentencePlayed", { turnId: TurnId, sentenceId: SentenceId })
])
export type ClientMessage = typeof ClientMessage.Type

export const ServerMessage = Schema.Union([
  Schema.TaggedStruct("Transcript", { turnId: TurnId, text: Schema.String, final: Schema.Boolean }),
  Schema.TaggedStruct("SentenceStart", { turnId: TurnId, sentenceId: SentenceId, text: Schema.String }),
  Schema.TaggedStruct("TurnEnd", { turnId: TurnId, interrupted: Schema.Boolean, sources: Schema.Array(Schema.String) }),
  Schema.TaggedStruct("Failure", { message: Schema.String })
])
export type ServerMessage = typeof ServerMessage.Type

export const decodeClientMessage = Schema.decodeUnknownEffect(Schema.fromJsonString(ClientMessage))
export const encodeServerMessage = Schema.encodeEffect(Schema.fromJsonString(ServerMessage))

/** Audio formats for binary WebSocket frames. */
export const AUDIO_IN = { sampleRate: 16_000, channels: 1, format: "pcm16" } as const
export const AUDIO_OUT = { sampleRate: 24_000, channels: 1, format: "pcm16" } as const

/** Server -> client audio frame: u32 big-endian sentence id, then raw PCM16 bytes. */
export const encodeAudioFrame = (sentenceId: number, pcm: Uint8Array): Uint8Array => {
  const frame = new Uint8Array(4 + pcm.length)
  new DataView(frame.buffer).setUint32(0, sentenceId)
  frame.set(pcm, 4)
  return frame
}

export const decodeAudioFrame = (frame: Uint8Array): { readonly sentenceId: number; readonly pcm: Uint8Array } => ({
  sentenceId: new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0),
  pcm: frame.subarray(4)
})
