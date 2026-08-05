import { lireStats } from "@/lib/stats-server";
import { chiffresCles, entonnoir, repartitionStatuts, sourcesManquantes } from "@/lib/stats-view.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/stats — les statistiques du pipeline, telles que stats.mjs les calcule.
//
//   { cles: {envoyees, enAttente, refus, tauxReponse, ...}, entonnoir: [...],
//     statuts: [...], manquant: [...], stats: <contrat brut>, error }
//
// `stats` porte le contrat brut de stats.mjs pour qui veut tout (le CLI en rend
// bien plus : scanner, portails, relances, runs) ; les autres champs sont la
// projection déjà mise en forme que la page consomme.
//
// Zéro token. Ce n'est pas un contrat figé pour n8n — seuls GET /api/followups et
// POST /api/tailor le sont.
export async function GET() {
  const { stats, error } = await lireStats();
  return Response.json({
    cles: chiffresCles(stats),
    entonnoir: entonnoir(stats),
    statuts: repartitionStatuts(stats),
    manquant: sourcesManquantes(stats),
    stats,
    error,
  });
}
