const strip = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()

/** Lowercase, accent-free, and with whitespace collapsed. */
export const normalize = (s: string): string => strip(s).replace(/\s+/g, " ").trim()

const looseIncludes = (haystack: string, needle: string): boolean => {
  const h = normalize(haystack)
  const n = normalize(needle)
  return h.includes(n) || h.replace(/\s/g, "").includes(n.replace(/\s/g, ""))
}

/** Share of required fact groups present; each group is satisfied by any alternative. */
export const factRecall = (text: string, groups: ReadonlyArray<ReadonlyArray<string>>): number =>
  groups.length === 0 ? 1 : groups.filter((g) => g.some((alt) => looseIncludes(text, alt))).length / groups.length

export const containsForbidden = (text: string, forbidden: ReadonlyArray<string>): boolean =>
  forbidden.some((f) => looseIncludes(text, f))

const DECLINE = /\b(non (lo )?so|non saprei|non (ho|abbiamo|dispongo di|possiedo) (accesso|informazioni|notizie|dati|questa informazione|quell|i dettagli|dettagli)|non dispongo|non (e|ci sono|abbiamo opere|risulta|sono in grado|posso (dirti|dirle|confermare))|purtroppo non|non conosco|non mi risulta|non ho (sotto mano|a disposizione))/

/** True if the reply admits not knowing, instead of inventing an answer. */
export const isDecline = (text: string): boolean => DECLINE.test(normalize(text))

const IT = new Set(["il", "lo", "la", "gli", "le", "di", "del", "della", "dei", "delle", "da", "con", "per", "tra", "fra",
  "che", "non", "un", "una", "uno", "al", "alla", "nel", "nella", "sono", "ho", "ha", "mi", "ti", "ci", "ma", "anche",
  "piu", "come", "quando", "dove", "qui", "molto", "posso", "puoi", "puo", "siamo", "questo", "questa", "info", "nel", "se", "si", "e"])
const EN = new Set(["the", "and", "is", "are", "of", "to", "you", "your", "for", "with", "this", "that", "it", "on",
  "i", "can", "will", "have", "has", "be", "was", "were", "from", "not", "but", "or", "an", "as", "at", "by"])

/** Heuristic: Italian function words clearly outnumber English ones. */
export const isItalian = (text: string): boolean => {
  const words = normalize(text).split(/[^\p{L}]+/u).filter(Boolean)
  const it = words.filter((w) => IT.has(w)).length
  const en = words.filter((w) => EN.has(w)).length
  return words.length === 0 ? false : it >= 1 && it > en * 2 || (en === 0 && it >= 0 && words.length <= 3)
}

/** Speech-safe: no markdown, lists, emoji or URLs that a TTS engine would read aloud. */
export const isSpeechSafe = (text: string): boolean =>
  !/[*#_`~|<>{}\[\]]/.test(text) &&
  !/\p{Extended_Pictographic}/u.test(text) &&
  !/^\s*([-•]|\d+[.)])\s/m.test(text) &&
  !/https?:|www\./i.test(text)

export const countSentences = (text: string): number =>
  text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter((s) => s.length > 0).length

export const percentile = (values: ReadonlyArray<number>, p: number): number => {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((x, y) => x - y)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]!
}

export const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? NaN : values.reduce((s, v) => s + v, 0) / values.length

export const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>): number => {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]! }
  return dot / Math.sqrt(na * nb)
}

/** 1-based rank of the first gold passage in `ranked`, or undefined if absent. */
export const goldRank = (ranked: ReadonlyArray<string>, gold: ReadonlyArray<string>): number | undefined => {
  const i = ranked.findIndex((id) => gold.includes(id))
  return i < 0 ? undefined : i + 1
}

/**
 * A grounding threshold separating answerable best-scores from unanswerable ones.
 * Returns the midpoint of the gap, or undefined when the distributions overlap.
 */
export const suggestThreshold = (
  answerable: ReadonlyArray<number>,
  unanswerable: ReadonlyArray<number>
): { readonly threshold: number; readonly separated: boolean } => {
  const lowAnswerable = Math.min(...answerable)
  const highOther = Math.max(...unanswerable)
  const separated = lowAnswerable > highOther
  return { threshold: (lowAnswerable + highOther) / 2, separated }
}
