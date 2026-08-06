// Projection du contrat de stats.mjs vers les quatre chiffres de la page /stats :
// envoyées, en attente, refus, taux de réponse. Logique pure (pas de fs, pas de
// process) pour être testable sans tracker.
//
// AUCUN CHIFFRE N'EST RECALCULÉ ICI. stats.mjs est l'agrégateur canonique du cœur
// (il le dit lui-même : « This is the canonical funnel definition for career-ops
// going forward ; dashboard/web consuming this JSON instead of keeping
// independent copies »). On ne fait que choisir quoi montrer et le nommer en
// français. Réimplémenter le calcul, c'est garantir qu'un jour la page et le CLI
// se contrediront.
//
// Deux pièges que cette projection existe pour éviter :
//
//   1. `null` n'est pas `0`. Un tracker absent (le cas de Linéo tant qu'aucune
//      candidature n'est partie) et un tracker plein de zéros s'affichent
//      autrement : « — » et une explication, pas quatre beaux zéros qui
//      laisseraient croire que le système tourne à vide.
//   2. « envoyées » ≠ `byStatus.Applied`. Ce dernier compte les candidatures
//      ACTUELLEMENT au statut Applied ; une candidature refusée en est sortie.
//      Le chiffre honnête d'« envoyées » est `funnel.everApplied` (a atteint le
//      stade « envoyée » un jour), sinon le total baisserait à chaque refus.

/**
 * Le contrat rendu par `node stats.mjs` (les sections utilisées seulement).
 * @typedef {Object} ContratStats
 * @property {{generatedAt?: string, sources?: Record<string, boolean>}} [metadata]
 * @property {{total?: number, byStatus?: Record<string, number>, activeApps?: number,
 *   activeAppsLive?: number, activeAppsCold?: number, avgScore?: number|null,
 *   avgScoreApplied?: number|null, topScore?: number|null}|null} [tracker]
 * @property {{everApplied?: number, everResponded?: number, everInterview?: number,
 *   everOffer?: number, responseRate?: number, interviewRate?: number,
 *   offerRate?: number, smallSample?: boolean}|null} [funnel]
 * @property {{totalRecorded?: number, distinctCompanies?: number, added?: number,
 *   firstSeen?: string|null}|null} [scan]
 * @property {{totalFollowups?: number, appliedWithoutFollowup?: number}|null} [followups]
 */

/** Un entier sûr, ou null si la valeur n'en est pas un. `null` se propage — il
 *  veut dire « pas de donnée », et l'écraser en 0 serait inventer un chiffre. */
function entier(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Les quatre chiffres de tête, plus ce qu'il faut pour les lire honnêtement.
 *
 * `tauxReponse` reste null quand rien n'a été envoyé : 0 % de réponses sur 0
 * envoi n'est pas un mauvais score, c'est une absence de données — et affiché
 * comme « 0 % » il se lirait comme un échec.
 *
 * @param {ContratStats|null} stats
 * `aDesDonnees` (le tracker EXISTE) et `total` (il a des lignes) sont deux
 * questions différentes, et il a fallu les séparer : depuis que le tracker est
 * amorcé vide, le cas courant est « fichier présent, zéro ligne ». Sans `total`,
 * cet état s'affiche en quatre zéros nus — indiscernable d'un système qui tourne
 * sans rien produire, alors qu'il veut juste dire « rien n'est encore parti ».
 *
 * @returns {{
 *   aDesDonnees: boolean,
 *   total: number|null,
 *   envoyees: number|null,
 *   enAttente: number|null,
 *   enAttenteFroides: number|null,
 *   refus: number|null,
 *   tauxReponse: number|null,
 *   reponses: number|null,
 *   echantillonFaible: boolean,
 *   genereLe: string|null,
 * }}
 */
export function chiffresCles(stats) {
  const tracker = stats?.tracker ?? null;
  const funnel = stats?.funnel ?? null;
  const parStatut = tracker?.byStatus ?? {};

  const envoyees = funnel ? entier(funnel.everApplied) : null;
  const reponses = funnel ? entier(funnel.everResponded) : null;
  // `activeAppsLive` retire les candidatures que la cadence classe « froides »
  // (envoyées, relancées le maximum de fois, toujours aucune réponse). C'est le
  // chiffre le plus honnête de « on peut encore en attendre quelque chose » ; il
  // n'existe que si stats.mjs a pu croiser les relances, d'où le repli.
  const enAttente = tracker ? (entier(tracker.activeAppsLive) ?? entier(tracker.activeApps)) : null;

  return {
    aDesDonnees: Boolean(tracker),
    total: tracker ? (entier(tracker.total) ?? 0) : null,
    envoyees,
    enAttente,
    enAttenteFroides: tracker ? entier(tracker.activeAppsCold) : null,
    refus: tracker ? (entier(parStatut.Rejected) ?? 0) : null,
    tauxReponse: envoyees && envoyees > 0 ? entier(funnel?.responseRate) : null,
    reponses,
    // Sous 10 envois, un pourcentage ne veut pas dire grand-chose. stats.mjs le
    // signale déjà (`smallSample`) et son affichage CLI le répète — on ne va pas
    // être moins prudent que le moteur.
    echantillonFaible: Boolean(funnel?.smallSample),
    genereLe: typeof stats?.metadata?.generatedAt === "string" ? stats.metadata.generatedAt : null,
  };
}

// Les étapes de l'entonnoir, dans l'ordre. `cle` = champ du contrat (jamais
// traduit), `libelle` = affichage.
const ETAPES = [
  { cle: "everApplied", libelle: "Envoyées" },
  { cle: "everResponded", libelle: "Réponse reçue" },
  { cle: "everInterview", libelle: "Entretien" },
  { cle: "everOffer", libelle: "Proposition" },
];

/**
 * L'entonnoir cumulé, prêt à barrer. `part` est relatif aux envoyées — comme les
 * taux de stats.mjs — pour que la barre et le pourcentage racontent la même
 * histoire.
 *
 * Limite connue et assumée (stats.mjs la documente) : les statuts sont des
 * instantanés, donc une candidature refusée après un entretien est
 * indiscernable d'une refusée sans réponse. Les étapes du milieu sont des
 * minorants, pas des vérités.
 *
 * @param {ContratStats|null} stats
 * @returns {{cle: string, libelle: string, valeur: number, part: number}[]}
 */
export function entonnoir(stats) {
  const funnel = stats?.funnel;
  if (!funnel) return [];
  const base = entier(funnel.everApplied) ?? 0;
  return ETAPES.map(({ cle, libelle }) => {
    const valeur = entier(funnel[cle]) ?? 0;
    return { cle, libelle, valeur, part: base > 0 ? Math.round((valeur / base) * 100) : 0 };
  });
}

// Les statuts terminaux ou hors-vol : ils ne sont pas « en attente ». Ordre
// d'affichage volontaire — d'abord ce qui vit, puis ce qui est clos.
const STATUTS = [
  { cle: "Evaluated", libelle: "Évaluées, pas encore envoyées" },
  { cle: "Applied", libelle: "Envoyées, sans réponse" },
  { cle: "Responded", libelle: "Réponse reçue" },
  { cle: "Interview", libelle: "Entretien" },
  { cle: "Offer", libelle: "Proposition" },
  { cle: "Hired", libelle: "Embauché" },
  { cle: "Rejected", libelle: "Refusées" },
  { cle: "Discarded", libelle: "Écartées" },
  { cle: "SKIP", libelle: "Ignorées" },
  { cle: "Unknown", libelle: "Statut non reconnu" },
];

/**
 * La répartition par statut, les cases vides ôtées. `Unknown` est gardé quand il
 * n'est pas nul : stats.mjs y range les statuts qu'il n'a pas su lire, et le
 * cacher masquerait une faute de frappe dans le tracker.
 *
 * @param {ContratStats|null} stats
 * @returns {{cle: string, libelle: string, valeur: number}[]}
 */
export function repartitionStatuts(stats) {
  const parStatut = stats?.tracker?.byStatus;
  if (!parStatut) return [];
  return STATUTS.map(({ cle, libelle }) => ({ cle, libelle, valeur: entier(parStatut[cle]) ?? 0 })).filter(
    (s) => s.valeur > 0,
  );
}

/**
 * Ce qui manque pour que la page soit complète, en français, à partir de
 * `metadata.sources`. Sert à expliquer une section vide au lieu de la laisser
 * muette — « aucune donnée » sans dire quel fichier manque n'aide personne.
 *
 * @param {ContratStats|null} stats
 * @returns {string[]}
 */
export function sourcesManquantes(stats) {
  const sources = stats?.metadata?.sources;
  if (!sources || typeof sources !== "object") return [];
  const libelles = {
    tracker: "data/applications.md (le tracker des candidatures)",
    scanHistory: "data/scan-history.tsv (l'historique du scanner)",
    followups: "data/follow-ups.md (le journal des relances)",
    portals: "portals.yml (les filtres de recherche)",
    scanRuns: "data/scan-runs.tsv (les compteurs par scan)",
    portalHealth: "data/portal-health.tsv (la santé des portails)",
  };
  return Object.entries(libelles)
    .filter(([cle]) => sources[cle] === false)
    .map(([, libelle]) => libelle);
}
