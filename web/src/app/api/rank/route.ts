import { erreurOpenAi, executeLlm } from "@/lib/llm-runner";
import { lireFiltresPortals, motsClesFranceTravail } from "@/lib/core/portals";
import { litJournalOffres } from "@/lib/offers-journal";
import { clesDuJournal } from "@/lib/offers-store.mjs";
import { MAX_OFFRES, SCORE_MINIMUM, parseRank, prepareLot, promptRank, trieParPlancher } from "@/lib/rank.mjs";
import { profilCv } from "@/lib/profil-cv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 2e des TROIS budgets qui se tiennent — voir TIMEOUT_CLI_MS dans llm-runner.ts
// pour la mesure. Doit rester AU-DESSUS du plafond du CLI (900 s), sinon la
// route coupe avant lui et on perd le message d'erreur qui dit quoi corriger.
export const maxDuration = 950;

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
  let body: { offres?: unknown[]; max?: number; profil?: string; scoreMin?: number };
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

  // Tout jobId déjà au journal est écarté, quel que soit son statut : en attente
  // de décision, partie en rédaction, ou écartée. Une offre sur laquelle Linéo
  // s'est déjà prononcé n'a rien à faire dans un lot de découverte.
  //
  // Le journal est lu ICI et pas reçu de n8n : c'est career-ops qui l'écrit, lui
  // seul en connaît l'état au moment du tri. Le faire porter par le workflow
  // recréerait la deuxième source de vérité qu'on a supprimée côté recherche.
  //
  // Deux niveaux, parce qu'un seul ne suffit pas : France Travail republie la
  // même annonce sous plusieurs jobId, si bien qu'une offre écartée revenait
  // malgré ce filtre. `clesConnues` porte donc l'identité du POSTE
  // (employeur + intitulé + ville, cf. cle-job.mjs) en plus de l'identifiant.
  const journal = litJournalOffres();
  const dejaVus = new Set(
    journal.map((l) => String(l.jobId ?? "").trim()).filter(Boolean),
  );
  const clesConnues = clesDuJournal(journal);

  const filtres = lireFiltresPortals();

  // Les mots-clés servent à CLASSER le lot avant de le tronquer, pas à filtrer.
  // Même source que la recherche — portals.yml — pour qu'on ne puisse pas
  // chercher sur un jeu de termes et classer sur un autre.
  const lot = prepareLot(brutes, {
    maxOffres: MAX_OFFRES,
    dejaVus,
    clesConnues,
    motsCles: [...filtres.positive, ...motsClesFranceTravail()],
  });
  if (lot.offres.length === 0) {
    return Response.json({
      jobs: [],
      lot: {
        envoyees: 0,
        doublons: lot.doublons,
        sansId: lot.sansId,
        dejaVues: lot.dejaVues,
        jumeaux: lot.jumeaux,
        alternances: lot.alternances,
        tronquees: lot.tronquees,
      },
      inventes: [],
      vide: true,
    });
  }

  // Plafonné par la taille du lot, pas par une constante arbitraire : on ne peut
  // pas retenir plus d'offres qu'on n'en a envoyées au modèle. L'ancien plafond
  // dur à 20 empêchait Linéo de demander la tournée qu'il veut — voir 60
  // annonces neuves par jour et trancher lui-même (garder / écarter / plus tard)
  // — en bridant silencieusement sa demande à un tiers.
  const maxRetenues = Number.isFinite(Number(body.max))
    ? Math.max(1, Math.min(lot.offres.length, Number(body.max)))
    : 5;

  // Le profil est lu COTE SERVEUR, pas recu de n8n. Sans lui, le score mesurait
  // « cette offre contient mes mots-cles » et non « je corresponds a cette
  // offre » : c'est ce qui a fait remonter trois postes UiPath a 80+ alors que le
  // CV n'en contient pas une ligne.
  // Le plancher de score, réglable par la requête sans redéploiement (nœud
  // « ⚙️ Config » de n8n). Il est dit AU MODÈLE en plus d'être applique ici : sans
  // ça il rédige jusqu'à 60 whyMatch dont une partie part à la poubelle, ce qui
  // n'ajoute que de la latence — la durée du tri est commandée par la sortie.
  const scoreMin = Number.isFinite(Number(body.scoreMin))
    ? Math.max(0, Math.min(100, Number(body.scoreMin)))
    : SCORE_MINIMUM;

  // Le profil est lu COTE SERVEUR, pas recu de n8n. Sans lui, le score mesurait
  // « cette offre contient mes mots-cles » et non « je corresponds a cette
  // offre » : c'est ce qui a fait remonter trois postes UiPath a 80+ alors que le
  // CV n'en contient pas une ligne.
  const profil = profilCv();
  const prompt = promptRank({
    offres: lot.offres,
    filtres,
    profil,
    maxRetenues,
    scoreMin,
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

  // Le plancher, puis la trace de TOUT ce qui a été jugé sans être retenu.
  // `nonRetenues` doit être inscrit au journal par /api/offers, sinon ces offres
  // reviennent à chaque tournée se faire rejuger à l'identique.
  const { gardes, nonRetenues } = trieParPlancher({
    soumises: lot.offres,
    jobs: resultat.jobs,
    scoreMin,
  });

  return Response.json({
    jobs: gardes,
    nonRetenues,
    scoreMin,
    lot: {
      envoyees: lot.offres.length,
      doublons: lot.doublons,
      sansId: lot.sansId,
      dejaVues: lot.dejaVues,
      // La même annonce sous un autre identifiant, écartée avant le modèle.
      jumeaux: lot.jumeaux,
      alternances: lot.alternances,
      tronquees: lot.tronquees,
      // Sur les offres envoyées au modèle, combien portent un mot-clé dans leur
      // intitulé. C'est le seul chiffre qui dit si la troncature garde les bonnes
      // offres : avant le classement il dépendait de l'ordre des requêtes.
      cibleesGardees: lot.cibleesGardees,
      // Ce que le modèle a rendu, avant le plancher — pour distinguer « il n'y
      // avait rien de bon » de « le plancher est trop haut ».
      renduesParLeModele: resultat.jobs.length,
      sousLePlancher: resultat.jobs.length - gardes.length,
      nonCitees: nonRetenues.length - (resultat.jobs.length - gardes.length),
    },
    // Un jobId que le modèle aurait inventé : écarté, mais signalé.
    inventes: resultat.inventes,
    filtresSource: "portals.yml",
    motsCles: filtres.positive.length,
    profilLu: profil.length > 0,
  });
}
