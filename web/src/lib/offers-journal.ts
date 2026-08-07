import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { etatCourant, parseJournal } from "@/lib/offers-store.mjs";

/**
 * L'accès disque au journal des offres n8n. `offers-store.mjs` reste pur et
 * testable sans disque ; tout ce qui touche au système de fichiers est ici.
 *
 * Trois appelants avaient déjà recopié le même `path.join(...)` : la route GET,
 * la route de décision, et maintenant la page (qui a besoin du compte pour que
 * le badge de l'onglet « À trier » ne mente pas). Trois copies d'un chemin, et
 * la première qui bouge casse les deux autres en silence.
 */

export function cheminJournalOffres(): string {
  return path.join(careerOpsRoot(), "data", "offres-n8n.jsonl");
}

/** Le journal brut, ligne par ligne. Fichier absent = aucune tournée faite. */
export function litJournalOffres(): Record<string, unknown>[] {
  try {
    return parseJournal(fs.readFileSync(cheminJournalOffres(), "utf8"));
  } catch {
    return [];
  }
}

/** Les offres encore à décider : ni écartées, ni générées, ni postulées. */
export function litOffresADecider(): Record<string, unknown>[] {
  return etatCourant(litJournalOffres());
}
