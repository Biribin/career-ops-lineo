import { canonicalizeStatus } from "@/lib/core/states";
import { fichesADeposerDepuis } from "@/lib/a-deposer.mjs";
import { readApplications } from "@/lib/career-ops";
import { journalPath } from "@/lib/n8n-decisions";
import { lireJournalDetaille } from "@/lib/n8n-decisions.mjs";
import { lireInbox } from "@/lib/cv-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Le COMPTE de la file « À déposer », pour le badge de la barre latérale. Même
// dérivation que /api/a-deposer (une seule, fichesADeposerDepuis), contrat de
// fraîcheur différent — d'où une route séparée plutôt qu'un paramètre.
//
// POURQUOI UN CACHE ICI, ET NULLE PART AILLEURS. Le badge est demandé à chaque
// chargement de page ET à chaque retour de focus sur l'onglet. Or lire les fiches
// coûte, en mode GitHub, un listage + UNE requête par fiche (cf. cv-inbox.mjs,
// jusqu'à 50) : sans cache, un aller-retour vers l'ATS et retour dans l'onglet
// déclencherait cette rafale pour afficher un nombre qui n'a pas bougé.
//
// La TTL est un compromis volontaire, et elle tombe bien : revenir d'un dépôt
// sur un ATS prend plus d'une minute, donc le compte est frais quand il compte,
// et un alt-tab rapide ne coûte rien. La PAGE, elle, n'est jamais cachée — le
// badge est un rappel, pas une source de vérité.
const TTL_MS = 60_000;

// Mémoire du processus (un seul conteneur). Se vide au redéploiement, ce qui est
// exactement le comportement voulu.
let cache: { at: number; count: number } | null = null;

export async function GET(req: Request) {
  // `?frais=1` : appelé juste après une écriture (dépôt enregistré, abandon,
  // validation d'une candidature sans courriel), là où le badge doit bouger tout
  // de suite sous peine de contredire la page qui l'a déclenché.
  const frais = new URL(req.url).searchParams.get("frais") === "1";

  if (!frais && cache && Date.now() - cache.at < TTL_MS) {
    return Response.json({ count: cache.count, cache: true });
  }

  const source = await lireInbox();
  const journal = lireJournalDetaille(journalPath());

  // Une lecture en panne rendrait 0, et 0 mis en cache se figerait en « rien à
  // faire » pendant une minute — le mensonge que /a-deposer refuse de dire. On
  // ne cache donc QUE des comptes établis, et on rend le dernier compte connu
  // (ou rien) plutôt qu'un zéro inventé. C'est la page qui explique la panne.
  if (source.erreur || journal.erreur) {
    return Response.json({
      count: cache?.count ?? null,
      cache: cache !== null,
      erreur: source.erreur ?? journal.erreur,
    });
  }

  const count = fichesADeposerDepuis(
    source.fiches,
    journal.journal,
    readApplications(),
    canonicalizeStatus,
  ).length;

  cache = { at: Date.now(), count };
  return Response.json({ count, cache: false });
}
