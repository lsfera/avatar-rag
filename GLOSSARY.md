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
Answering facts only from retrieved passages scoring above the Persona's threshold; otherwise the avatar says it doesn't know.
_Avoid_: Hallucination guard, fact-checking

**Passage**:
A chunk of the knowledge base that can be retrieved as grounding.
_Avoid_: Document, snippet, context

**Knowledge base**:
The Italian corpus the avatar answers from.
_Avoid_: Corpus (in code), database, index
