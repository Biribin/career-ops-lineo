import fs from "node:fs";
import path from "node:path";
import { cheminJournalOffres } from "@/lib/offers-journal";
import { etatCourant, lignesAAjouter, lignesNonRetenues, parseJournal } from "@/lib/offers-store.mjs";
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

  const maintenant = new Date().toISOString();
  const { lignes, ecartees } = lignesAAjouter(corps, maintenant);

  // Les offres jugées mais NON retenues : sous le plancher de score, ou jamais
  // citées par le tri. Elles sont inscrites au journal avec le statut
  // `NON_RETENUE` — donc masquées de l'app ET écartées du prochain lot.
  //
  // Sans cette inscription, elles revenaient à CHAQUE tournée : 90 offres sur 150
  // le 2026-08-10, resoumises au modèle pour un verdict identique, en occupant des
  // places que des offres neuves n'avaient plus.
  //
  // Écrites HORS du dédoublonnage par URL, qui existe pour empêcher de candidater
  // deux fois : une offre non retenue n'a pas de candidature, la question ne se
  // pose pas.
  const nonRetenues = lignesNonRetenues(
    Array.isArray((corps as { nonRetenues?: unknown[] }).nonRetenues)
      ? ((corps as { nonRetenues?: unknown[] }).nonRetenues as [])
      : [],
    maintenant,
    { source: corps.source, executionId: corps.executionId },
  );

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
  const dedup = lignes.length > 0 ? await dedoublonneOffres(lignes) : { deja: [], erreur: null };
  const dejaVues = new Set(dedup.deja);
  const aEcrire = dedup.erreur ? lignes : lignes.filter((l) => !dejaVues.has(String(l.url ?? "")));

  // UNE SEULE écriture, retenues ET non retenues.
  //
  // Le piège évité ici : les deux sorties anticipées d'avant (« aucune ligne » et
  // « tout était déjà connu ») rendaient AVANT d'inscrire les non retenues. Or une
  // tournée qui ne retient rien est précisément celle où il faut se souvenir de ce
  // qui a été jugé — sinon le mécanisme ne sert jamais quand il est le plus utile,
  // et le lendemain le tri repaye les mêmes 150 offres.
  const toutes = [...aEcrire, ...nonRetenues];
  const p = journalPath();
  if (toutes.length > 0) {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, toutes.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
    } catch (e) {
      return Response.json(
        { error: e instanceof Error ? e.message : "ecriture du journal impossible" },
        { status: 500 },
      );
    }
  }

  return Response.json({
    ajoutees: aEcrire.length,
    nonRetenues: nonRetenues.length,
    ecartees,
    dejaVues: dedup.deja.length,
    dedupErreur: dedup.erreur,
    // Zéro offre retenue n'est PAS une erreur : une tournée peut ne rien ramener
    // qui vaille la peine. On le dit explicitement pour que n8n distingue « rien
    // trouvé » de « appel raté ».
    vide: aEcrire.length === 0,
    message:
      aEcrire.length === 0 && dedup.deja.length > 0
        ? "toutes les offres du lot étaient déjà connues d'une autre source"
        : undefined,
    journal: p,
  });
}
