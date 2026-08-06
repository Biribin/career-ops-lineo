import { erreurOpenAi, executeLlm } from "@/lib/llm-runner";
import { lireFiltresPortals } from "@/lib/core/portals";
import { MAX_OFFRES, parseRank, prepareLot, promptRank } from "@/lib/rank.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Tri des offres France Travail. Appelé par le workflow n8n « Découverte ».
//
//   POST { offres: [ <offre France Travail brute> ], max?: number, profil?: string }
//   →    { jobs: [ {jobId,title,company,url,location,whyMatch,score} ],
//          lot: {envoyees, doublons, sansId, tronquees}, inventes: [] }
//
// Les critères viennent de portals.yml (title_filter.positive + location_filter),
// pas d'un prompt écrit ici : sinon on recréerait la deuxième source de vérité
// qu'on vient de supprimer côté recherche.
//
// n8n appelle en direct sur le réseau Docker (http://career-ops:3000/api/rank) :
// le site public est derrière basic_auth côté Caddy.

export async function POST(req: Request) {
  let body: { offres?: unknown[]; max?: number; profil?: string };
  try {
    body = await req.json();
  } catch {
    return erreurOpenAi("json invalide", 400, "invalid_request_error");
  }

  const brutes = Array.isArray(body.offres) ? body.offres : [];
  if (brutes.length === 0) {
    // Zéro offre n'est pas une erreur : France Travail peut ne rien renvoyer ce
    // jour-là. On répond une liste vide EXPLICITE plutôt qu'un 400, pour que le
    // workflow distingue « rien trouvé » de « appel raté ».
    return Response.json({
      jobs: [],
      lot: { envoyees: 0, doublons: 0, sansId: 0, tronquees: 0 },
      inventes: [],
      vide: true,
    });
  }

  const lot = prepareLot(brutes, { maxOffres: MAX_OFFRES });
  if (lot.offres.length === 0) {
    return Response.json({
      jobs: [],
      lot: { envoyees: 0, doublons: lot.doublons, sansId: lot.sansId, tronquees: lot.tronquees },
      inventes: [],
      vide: true,
    });
  }

  const filtres = lireFiltresPortals();
  const maxRetenues = Number.isFinite(Number(body.max)) ? Math.max(1, Math.min(20, Number(body.max))) : 5;

  const prompt = promptRank({
    offres: lot.offres,
    filtres,
    profil: String(body.profil ?? "").slice(0, 4000),
    maxRetenues,
  });

  const r = await executeLlm(prompt);
  if (!r.ok) return erreurOpenAi(r.message, r.status);

  let resultat;
  try {
    resultat = parseRank(r.texte, { offresConnues: lot.offres });
  } catch (e) {
    // On remonte une ERREUR, jamais une liste vide : un tri illisible ne doit pas
    // ressembler à « aucune offre ne correspondait ».
    return erreurOpenAi(e instanceof Error ? e.message : "reponse du modele illisible", 502);
  }

  return Response.json({
    jobs: resultat.jobs,
    lot: {
      envoyees: lot.offres.length,
      doublons: lot.doublons,
      sansId: lot.sansId,
      tronquees: lot.tronquees,
    },
    // Un jobId que le modèle aurait inventé : écarté, mais signalé.
    inventes: resultat.inventes,
    filtresSource: "portals.yml",
    motsCles: filtres.positive.length,
  });
}
