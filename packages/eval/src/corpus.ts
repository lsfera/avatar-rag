import { readFileSync } from "node:fs"

/** Fictional knowledge base: no real-world facts a model could know from training. */
export interface CorpusPassage { readonly id: string; readonly text: string }

export const CORPUS: ReadonlyArray<CorpusPassage> = JSON.parse(
  readFileSync(new URL("../../../knowledge/villa-aurelia.json", import.meta.url), "utf8")
)
