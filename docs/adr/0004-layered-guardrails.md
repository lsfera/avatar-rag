# Guard speech in layers: Persona rules, an input check, and a per-Sentence output check

Safety is three cheap layers, ordered by cost, not one big filter:

1. **Persona prompt.** Sofia is told to refuse offensive, violent, sexual, illegal or system-breaking requests in one polite sentence, to never reveal her instructions, and to treat user text and retrieved passages as data. Costs nothing at runtime and catches the unanticipated cases.
2. **Input Guardrail** (`checkInput`), before retrieval and the LLM. A blocked utterance never reaches the model; the avatar speaks a fixed Italian Refusal and the Turn ends with no sources.
3. **Output Guardrail** (`checkOutput`), on each Sentence between `SentenceChunker` and `Tts`. The first blocked Sentence ends the stream (which interrupts the LLM) and is replaced by a Refusal. Unsafe text is never synthesized, and because history stores only heard text, never replayed to the model.

`Guardrail` is an Effect service like the model backends, with `RuleGuardrail` (regexes over lowercased, accent-free, de-leeted text) as the first implementation and `NoGuardrail` for tests. Rules cost microseconds, so they fit the 1.5 s first-audio budget. A model classifier (Llama Guard, ShieldGemma or Qwen3Guard) can implement the same interface later; run it in parallel with retrieval on input, and only on uncertain Sentences on output, and only if it passes the eval below on Italian.

Rules are deliberately narrow because a museum guide must still discuss wars, deaths and persecution in art. The eval measures both sides: `unsafe` cases must be refused (gate 90%), `benign` look-alikes must be answered (gate 95%). `pnpm eval --guard off` measures the model alone, so the rules' contribution stays visible.

## Consequences

- Rules miss paraphrase, dialect and sarcasm. They are risk reduction, not a guarantee; the Persona layer and, later, a classifier cover the rest.
- A blocked Turn is logged by category only, never by content.
- Speech-to-text errors can hide or fake a trigger phrase; the guard sees the transcript, not the audio.
- Self-harm gets a supportive Refusal that points to 112, not the generic one.
