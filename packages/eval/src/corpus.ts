/** Fictional knowledge base: no real-world facts a model could know from training. */
export interface CorpusPassage { readonly id: string; readonly text: string }

export const CORPUS: ReadonlyArray<CorpusPassage> = [
  { id: "orari", text: "Il Museo Civico di Villa Aurelia è aperto dal martedì alla domenica, dalle 9:00 alle 18:00. Il lunedì è chiuso." },
  { id: "biglietti", text: "Il biglietto intero costa 8 euro, il ridotto 5 euro. L'ingresso è gratuito per i minori di 14 anni e la prima domenica del mese." },
  { id: "storia", text: "Villa Aurelia fu costruita nel 1782 dall'architetto Giacomo Ferrante per la famiglia Aurelio. Dal 1954 è sede del museo civico." },
  { id: "collezione", text: "La collezione permanente comprende circa 1200 opere, tra cui dipinti del Seicento veneto e una sala dedicata alle ceramiche di Faenza." },
  { id: "opera", text: "Il pezzo più famoso è il dipinto «La Dama con il Liuto» di Elena Bassano, del 1634, esposto nella Sala Azzurra al primo piano." },
  { id: "accessibilita", text: "Il museo è accessibile ai visitatori con disabilità motoria: c'è un ascensore e un ingresso senza gradini sul lato est. Le sedie a rotelle si prestano gratuitamente alla biglietteria." },
  { id: "visite", text: "Le visite guidate in italiano partono alle 11:00 e alle 15:30 e durano circa 60 minuti. Costano 4 euro a persona e vanno prenotate al numero 0123 456789." },
  { id: "caffetteria", text: "Nel giardino c'è la caffetteria «Il Limone», aperta dalle 9:30 alle 17:30. Si possono portare cani di piccola taglia solo nel giardino." },
  { id: "foto", text: "È consentito fotografare le opere senza flash. Treppiedi e selfie stick non sono ammessi." },
  { id: "indirizzo", text: "Il museo si trova in via dei Cedri 12, a Villa Aurelia. Dalla stazione ferroviaria si raggiunge in dieci minuti con l'autobus numero 5." },
  { id: "bookshop", text: "Il bookshop vende cataloghi, stampe e le ceramiche prodotte dai laboratori del museo. Accetta pagamenti con carta e contanti." },
  { id: "scuole", text: "Le scuole possono prenotare laboratori didattici da 90 minuti per gruppi fino a 25 studenti; il costo è 3 euro a studente." }
]
