import { Schema } from "effect"

export const SessionId = Schema.String.pipe(Schema.brand("SessionId"))
export type SessionId = typeof SessionId.Type

export const TurnId = Schema.String.pipe(Schema.brand("TurnId"))
export type TurnId = typeof TurnId.Type

/** Identifies one spoken sentence within a Turn; used for playback acks. */
export const SentenceId = Schema.Int.pipe(Schema.brand("SentenceId"))
export type SentenceId = typeof SentenceId.Type

export class Persona extends Schema.Class<Persona>("@avatar/core/Persona")({
  name: Schema.NonEmptyString,
  language: Schema.Literals(["it"]),
  systemPrompt: Schema.NonEmptyString,
  voice: Schema.NonEmptyString,
  /** Minimum similarity for retrieved passages to count as grounding. */
  groundingThreshold: Schema.Number
}) {}

export const TurnStatus = Schema.Literals(["completed", "interrupted", "failed"])
export type TurnStatus = typeof TurnStatus.Type

/** A reply sentence the avatar actually produced, with playback confirmation. */
export class SpokenSentence extends Schema.Class<SpokenSentence>("@avatar/core/SpokenSentence")({
  id: SentenceId,
  text: Schema.String,
  played: Schema.Boolean
}) {}

export class Turn extends Schema.Class<Turn>("@avatar/core/Turn")({
  id: TurnId,
  userText: Schema.String,
  sentences: Schema.Array(SpokenSentence),
  sources: Schema.Array(Schema.String),
  status: TurnStatus
}) {
  /** Text to store in history: only what the user actually heard. */
  get heardText(): string {
    return this.sentences.filter((s) => s.played).map((s) => s.text).join(" ")
  }
}
