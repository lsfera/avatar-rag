import { Stream } from "effect"

/** Italian abbreviations whose trailing period does not end a sentence. */
const ABBREVIATIONS = new Set([
  "sig", "sigg", "sig.ra", "dott", "dr", "prof", "ing", "avv", "geom", "rag",
  "ecc", "p.es", "es", "cfr", "pag", "pagg", "cap", "art", "tel", "vs", "ca", "ill", "on", "gent", "spett"
])

const TERMINATORS = /[.!?…]/

const isAbbreviation = (text: string, dotIndex: number): boolean => {
  const before = text.slice(0, dotIndex)
  const word = before.match(/([\p{L}.]+)$/u)?.[1]?.toLowerCase()
  if (word === undefined) return false
  if (/^\p{L}$/u.test(word)) return true // single initial: "A. Rossi"
  return ABBREVIATIONS.has(word) || ABBREVIATIONS.has(word.replace(/\.$/, ""))
}

/** Splits complete sentences off the front of `buffer`; the rest stays pending. */
export const splitSentences = (buffer: string): { sentences: ReadonlyArray<string>; rest: string } => {
  const sentences: Array<string> = []
  let start = 0
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i]!
    if (!TERMINATORS.test(ch)) continue
    // swallow runs like "?!" or "..."
    let end = i
    while (end + 1 < buffer.length && TERMINATORS.test(buffer[end + 1]!)) end++
    const next = buffer[end + 1]
    // need to see what follows to decide; at end of buffer, wait for more input
    if (next === undefined) break
    if (!/\s/.test(next)) { i = end; continue } // "3.14", "www.x.it"
    if (ch === "." && end === i && isAbbreviation(buffer, i)) continue
    if (/\d/.test(buffer[i - 1] ?? "") && /\d/.test(buffer[end + 2] ?? "") && ch === ".") continue
    const sentence = buffer.slice(start, end + 1).trim()
    if (sentence.length > 0) sentences.push(sentence)
    start = end + 1
    i = end
  }
  return { sentences, rest: buffer.slice(start) }
}

/** Turns a stream of LLM token deltas into a stream of complete sentences. */
export const chunkSentences = <E, R>(tokens: Stream.Stream<string, E, R>): Stream.Stream<string, E, R> =>
  tokens.pipe(
    Stream.mapAccum(
      () => "",
      (pending: string, delta: string) => {
        const { rest, sentences } = splitSentences(pending + delta)
        return [rest, sentences] as const
      },
      {
        onHalt: (pending) => {
          const tail = pending.trim()
          return tail.length > 0 ? [tail] : []
        }
      }
    )
  )
