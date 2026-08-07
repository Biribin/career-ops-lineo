import fs from "node:fs";
import path from "node:path";
import { cheminJournalOffres } from "@/lib/offers-journal";
import { etatCourant, lignesAAjouter, parseJournal } from "@/lib/offers-store.mjs";
import { dedoublonneOffres } from "@/lib/offres-dedup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Les offres retenues par le workflow « 1. Decouverte des offres ».
//
//   POST { jobs: [...], source, executionId, lot }  ← appelé par n8n
//   GET                                             ← lu par la page
//
// Journal append-only : on ne réécrit jamais une ligne. L'historique des
// tournées reste vérifiable, et deux écritures concurrentes ne peuvent pas se
// perdre l'une l'autre. `data/` est gitignoré mais sauvegardé (sync-data.sh
// fonctionne par liste d'exclusion, et n'écarte que cache/ et applications.db).

const journalPath = cheminJournalOffres;

export async function GET() {
  const p = journalPath();
  let brut = "";
  try {
    brut = fs.readFileSync(p, "utf8");
  } catch {
    // Fichier absent = aucune tournée encore faite. État normal, pas une panne.
    return Response.json({ offres: [], journal: p, vide: true });
  }
  const offres = etatCourant(parseJournal(brut));
  return Response.json({ offres, journal: p, vide: offres.length === 0 });
}

export async function POST(req: Request) {
  let corps: { jobs?: unknown[]; source?: string; executionId?: string; lot?: unknown };
  try {
    corps = await req.json();
  } catch {
    return Response.json({ error: "json invalide" }, { status: 400 });
  }

  const { lignes, ecartees } = lignesAAjouter(corps, new Date().toISOString());

  // Zéro offre n'est PAS une erreur : une tournée peut ne rien ramener. On le
  // dit explicitement pour que n8n distingue « rien trouvé » de « appel raté ».
  if (lignes.length === 0) {
    return Response.json({ ajoutees: 0, ecartees, vide: true });
  }

  // Fusion des deux files de triage. Avant, n8n et le scanner local
  // s'ignoraient : la même annonce pouvait s'afficher des deux côtés, et chacun
  // continuait de la resservir. On confronte donc le lot à l'univers connu
  // (scan-history.tsv + pipeline.md + applications.md) AVANT d'écrire.
  //
  // Une offre déjà vue ailleurs — y compris une chez qui Linéo a déjà postulé —
  // est écartée ici : c'est ce qui empêche de candidater deux fois.
  //
  // NON bloquant. Si le registre est injoignable on écrit quand même le lot :
  // perdre une tournée entière serait pire qu'un doublon, et l'erreur est
  // remontée dans la réponse plutôt qu'avalée.
  const dedup = await dedoublonneOffres(lignes);
  const dejaVues = new Set(dedup.deja);
  const aEcrire = dedup.erreur ? lignes : lignes.filter((l) => !dejaVues.has(String(l.url ?? "")));

  if (aEcrire.length === 0) {
    return Response.json({
      ajoutees: 0,
      ecartees,
      dejaVues: dedup.deja.length,
      vide: true,
      message: "toutes les offres du lot étaient déjà connues d'une autre source",
    });
  }

  const p = journalPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, aEcrire.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "ecriture du journal impossible" },
      { status: 500 },
    );
  }

  return Response.json({
    ajoutees: aEcrire.length,
    ecartees,
    dejaVues: dedup.deja.length,
    dedupErreur: dedup.erreur,
    journal: p,
  });
}
