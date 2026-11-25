# Avatar

A real-time, voice-driven Italian avatar that answers from a knowledge base. A user speaks or types; the avatar replies with synthesized speech and a lip-synced 3D face.

## Language

**Session**:
One connected conversation between a user and the avatar, with its own history. Ends when the connection closes.
_Avoid_: Conversation, chat, call

**Turn**:
One user input and the avatar's reply to it. The unit of work, history, and interruption.
_Avoid_: Exchange, round, message

**Utterance**:
A segment of user speech between speech start and speech end, before transcription.
_Avoid_: Clip, recording

**Persona**:
The avatar's configured identity: name, language, voice, system prompt and grounding threshold.
_Avoid_: Character, bot, agent

**Sentence**:
The smallest unit of a reply that is synthesized, played, and acknowledged on its own.
_Avoid_: Chunk, segment, phrase

**Viseme**:
A mouth shape the avatar face shows while speaking.
_Avoid_: Phoneme, blendshape, mouth shape

**Barge-in**:
The user speaking or typing while the avatar is replying, which cancels the rest of the reply.
_Avoid_: Interruption, cutoff

**Heard text**:
The sentences of a reply the user actually heard played before any barge-in.
_Avoid_: Spoken text, output

**Grounding**:
Answering facts only from retrieved passages; when they don't answer the question, the avatar says it doesn't know instead of inventing.
_Avoid_: Hallucination guard, fact-checking

**Grounding threshold**:
An optional minimum similarity a Passage needs to be used; normally unset, so the top passages are always used.
_Avoid_: Cutoff, score limit

**Passage**:
A chunk of the knowledge base that can be retrieved as grounding.
_Avoid_: Document, snippet, context

**Knowledge base**:
The Italian corpus the avatar answers from.
_Avoid_: Corpus (in code), database, index

**Guardrail**:
The check that decides whether a user's words may reach the model (input) and whether a generated Sentence may be spoken (output). It answers with a Verdict.
_Avoid_: Filter, moderation, safety layer

**Verdict**:
A Guardrail's answer: safe, or blocked with a harm category (`hate`, `violence`, `sexual`, `self-harm`, `illegal`, `injection`, `leak`).
_Avoid_: Flag, score

**Refusal**:
The fixed Italian Sentence the avatar speaks in place of a blocked input or a blocked Sentence. Not the same as admitting it does not know a fact, which is grounding, not safety.
_Avoid_: Error message, fallback
