import { Context, Effect, Layer } from "effect"

/** What a guardrail can refuse. `leak` is output-only: the reply repeats the system prompt. */
export type HarmCategory = "hate" | "violence" | "sexual" | "self-harm" | "illegal" | "injection" | "leak"

export type Verdict = { readonly safe: true } | { readonly safe: false; readonly category: HarmCategory }

const SAFE: Verdict = { safe: true }
const blocked = (category: HarmCategory): Verdict => ({ safe: false, category })

/**
 * Decides whether text may reach the model (input) or the speaker (output).
 * The rule implementation below is instant and runs on every Turn; a model-based
 * classifier can replace it behind the same interface (see ADR 0004).
 */
export class Guardrail extends Context.Service<Guardrail, {
  /** A user's words, before retrieval and the LLM. */
  checkInput(text: string): Effect.Effect<Verdict>
  /** One generated Sentence, before it is synthesized. */
  checkOutput(sentence: string): Effect.Effect<Verdict>
}>()("@avatar/pipeline/Guardrail") {}

// ---- rules ----------------------------------------------------------------
// Matched on text that is lowercased and accent-free. Patterns are deliberately narrow:
// a museum guide must still discuss wars, deaths and persecution in art ("false refusals" are measured by the eval).

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ")
/** Undoes common letter-for-digit substitutions ("h4ck3r"). Only used as a second pass. */
const deleet = (s: string): string => s.replace(/[@4]/g, "a").replace(/3/g, "e").replace(/1/g, "i").replace(/0/g, "o").replace(/\$/g, "s")

const GROUPS = "ebrei|ebreo|neri|musulmani|islamici|gay|omosessuali|immigrati|stranieri|rom|africani|cinesi|donne|disabili"

type Rule = readonly [HarmCategory, RegExp]

const SHARED: ReadonlyArray<Rule> = [
  ["hate", /\b(frocio|froci|ricchione|ricchioni|negro|negri|terrone|terroni|zingaracci|sporc[oai] (ebre[oi]|neri|negri|musulmani|zingar[oi]))\b/],
  ["hate", new RegExp(`\\b(odio|odiamo|disprezzo)\\b.{0,20}\\b(${GROUPS})\\b`)],
  ["hate", new RegExp(`\\b(${GROUPS})\\b.{0,30}\\b(devono morire|meritano di morire|vanno (uccis|eliminat|cacciat|deportat)\\w*|sono (inferiori|animali|parassiti|subumani|sporchi|sporche))`)],
  ["violence", /\b(costruire|fabbricare|preparare|assemblare)\b.{0,25}\b(bomba|bombe|esplosivo|ordigno|molotov|veleno)\b/],
  ["violence", /\b(uccidere|ammazzare|avvelenare|accoltellare)\b.{0,15}\b(qualcuno|una persona|il mio|la mia|un bambino)\b/],
  ["sexual", /\b(porno\w*|sesso esplicito)\b/],
  ["sexual", /\b(scena|racconto|storia|descrizione|descrivimi|immagini)\b.{0,20}\b(erotic\w*|sessual\w* esplicit\w*)\b/],
  ["illegal", /\b(hackerare|hackare|craccare|bucare|violare)\b.{0,30}\b(wifi|rete|sistema|server|sito|account|password|telecamere|allarme)\b/],
  ["illegal", /\b(exploit|malware|ransomware|keylogger|phishing|sql injection|ddos)\b/]
]

const INPUT_ONLY: ReadonlyArray<Rule> = [
  ["injection", /\b(ignora|ignorare|dimentica|scorda|annulla|disattiva)\b.{0,30}\b(istruzioni|regole|direttive|prompt|filtri)\b/],
  ["injection", /\b(prompt|istruzioni) (di sistema|iniziali|nascost\w*|segret\w*)\b|\bsystem prompt\b/],
  ["injection", /\b(rivela|mostra|ripeti|leggi|dimmi|svela|stampa)\b.{0,25}\b(il tuo|le tue)\b.{0,15}\b(prompt|istruzioni|regole)\b/],
  ["injection", /\b(jailbreak|modalita (sviluppatore|dio)|developer mode|sei (ora |adesso )?dan|senza (regole|limiti|filtri|restrizioni))\b/],
  ["injection", /\bfingi di (essere|non avere)\b.{0,40}\b(sviluppator|programmator|amministrator|senza)/],
  ["self-harm", /\b(farla finita|uccidermi|togliermi la vita|farmi del male|ammazzarmi|voglio morire|non voglio piu vivere)\b/],
  ["illegal", /\b(come|voglio|vorrei|aiutami a|piano per)\b.{0,15}\b(rubare|trafugare|rapinare)\b/],
  ["illegal", /\b(disattivare|spegnere|aggirare)\b.{0,15}\b(allarme|telecamere|sorveglianza)\b/]
]

/** Fragments of our own system prompt (see `buildMessages` and `sofia`): a reply containing one is leaking it. */
const LEAK_MARKERS = [
  "usa solo queste informazioni", "non inventare fatti", "non hai trovato informazioni pertinenti",
  "sei sofia, la guida virtuale del museo civico", "niente elenchi, niente markdown", "prompt di sistema", "system prompt"
]

const OUTPUT_ONLY: ReadonlyArray<Rule> = [
  ["leak", new RegExp(LEAK_MARKERS.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"))]
]

const firstMatch = (rules: ReadonlyArray<Rule>, text: string): Verdict => {
  const folded = fold(text)
  const variants = [folded, deleet(folded)]
  for (const [category, pattern] of rules) if (variants.some((v) => pattern.test(v))) return blocked(category)
  return SAFE
}

const INPUT_RULES = [...INPUT_ONLY, ...SHARED]
const OUTPUT_RULES = [...OUTPUT_ONLY, ...SHARED]
const MAX_INPUT_CHARS = 1000

/** Pure: usable from the eval harness and tests without a Layer. */
export const checkInputRules = (text: string): Verdict =>
  text.length > MAX_INPUT_CHARS ? blocked("injection") : firstMatch(INPUT_RULES, text)

export const checkOutputRules = (sentence: string): Verdict => firstMatch(OUTPUT_RULES, sentence)

export const RuleGuardrail: Layer.Layer<Guardrail> = Layer.succeed(Guardrail, Guardrail.of({
  checkInput: (text) => Effect.succeed(checkInputRules(text)),
  checkOutput: (sentence) => Effect.succeed(checkOutputRules(sentence))
}))

/** Allows everything. For tests that are about something else. */
export const NoGuardrail: Layer.Layer<Guardrail> = Layer.succeed(Guardrail, Guardrail.of({
  checkInput: () => Effect.succeed(SAFE),
  checkOutput: () => Effect.succeed(SAFE)
}))

// ---- what the avatar says instead ------------------------------------------
const REFUSAL = "Mi dispiace, di questo non posso parlare. Posso invece aiutarti con la visita al museo."
const REFUSALS: Partial<Record<HarmCategory, string>> = {
  injection: "Preferisco restare nel mio ruolo di guida del museo. Posso aiutarti con orari, biglietti o opere?",
  leak: "Preferisco restare nel mio ruolo di guida del museo. Posso aiutarti con orari, biglietti o opere?",
  "self-harm": "Mi dispiace che tu ti senta così. Non sono la persona giusta per aiutarti, ma parlane con qualcuno di fiducia, e se sei in pericolo chiama il 112."
}

/** The spoken Italian line for a blocked Turn. */
export const refusalFor = (category: HarmCategory): string => REFUSALS[category] ?? REFUSAL
