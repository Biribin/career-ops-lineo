// Stockage des offres retenues par le workflow « 1. Decouverte des offres ».
// Partie pure et testable : aucun accès disque ici, les chemins sont injectés.
//
// LE FLUX EN TROIS TEMPS (découpage voulu par Linéo)
//   1. Découverte  : n8n trie les offres et POSTe ici. Rien n'est rédigé.
//   2. Génération  : Linéo valide une offre dans l'app → lettre + CV.
//   3. Envoi       : Linéo valide le CV → le mail part, ou il demande une retouche.
//
// Ce module ne couvre que l'étape 1. Il est volontairement append-only : on ne
// réécrit jamais une ligne. L'historique des tournées est ainsi vérifiable, et
// deux écritures concurrentes ne peuvent pas se perdre l'une l'autre.

/** Une offre est identifiée par son jobId France Travail. */
const txt = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * Valide et normalise UNE offre reçue de n8n.
 * Renvoie null si elle est inexploitable — mieux vaut l'écarter que stocker une
 * ligne sans identifiant, qu'on ne pourrait plus ni dédupliquer ni valider.
 */
export function normaliseOffreRecue(brut) {
  const o = brut ?? {};
  const jobId = txt(o.jobId);
  if (!jobId) return null;

  const score = Number(o.score);
  return {
    jobId,
    title: txt(o.title),
    company: txt(o.company),
    url: txt(o.url),
    location: txt(o.location),
    whyMatch: txt(o.whyMatch),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    description: String(o.description ?? "").slice(0, 2000),
  };
}

/**
 * Construit les lignes à ajouter au journal.
 *
 * @param {{jobs?: unknown[], source?: string, executionId?: string, lot?: unknown}} corps
 * @param {string} vuLe  horodatage ISO, INJECTÉ (pas de Date.now() ici, pour que
 *                       les tests soient déterministes)
 */
export function lignesAAjouter(corps, vuLe) {
  const c = corps ?? {};
  const jobs = Array.isArray(c.jobs) ? c.jobs : [];
  const retenues = [];
  let ecartees = 0;

  for (const brut of jobs) {
    const o = normaliseOffreRecue(brut);
    if (!o) {
      ecartees += 1;
      continue;
    }
    retenues.push({
      ...o,
      statut: "A_DECIDER",
      vu_le: vuLe,
      source: txt(c.source) || "n8n",
      execution_id: txt(c.executionId),
    });
  }

  return { lignes: retenues, ecartees };
}

/** Les décisions qui SORTENT une offre de la file, définitivement. */
export const STATUTS_CLASSANTS = ["ECARTEE", "GENEREE", "POSTULEE"];

/** action reçue → statut inscrit au journal. */
const STATUT_PAR_ACTION = {
  ecarter: "ECARTEE",
  generer: "GENEREE",
  postuler: "POSTULEE",
};

/**
 * La ligne à ajouter au journal quand Linéo tranche sur une offre.
 *
 * `ECARTEE`  : il n'en veut pas.
 * `GENEREE`  : la candidature part en rédaction, elle vit dans « À valider ».
 * `POSTULEE` : il a postulé LUI-MÊME, ailleurs (France Travail, site de
 *              l'entreprise…). Rien à rédiger, mais la ligne doit exister dans
 *              le tracker, sinon il ne pourra jamais enregistrer la réponse —
 *              ni le refus.
 *
 * @param {string} jobId
 * @param {'ecarter'|'generer'|'postuler'} action
 * @param {string} quand  horodatage ISO, INJECTÉ (tests déterministes)
 */
export function ligneDecision(jobId, action, quand) {
  const id = txt(jobId);
  if (!id) return null;
  const statut = STATUT_PAR_ACTION[action];
  if (!statut) return null;
  return { jobId: id, statut, decide_le: quand, vu_le: quand };
}

/**
 * Réduit un journal append-only à l'état courant.
 *
 * Une offre revue lors d'une tournée suivante écrase la précédente : c'est la
 * ligne la PLUS RÉCENTE qui fait foi. Sans ça, une offre rescannée apparaîtrait
 * deux fois dans l'app.
 *
 * ⚠️ MAIS une décision de Linéo est COLLANTE, et ça ne se déduit pas de l'ordre
 * des lignes. Une offre écartée que la tournée du lendemain reposte réapparaît
 * sinon, parce que sa ligne `A_DECIDER` est plus récente que son `ECARTEE` — et
 * il faudrait l'écarter encore, tous les jours. Même chose pour une offre déjà
 * partie en rédaction : la revoir ici, c'est risquer de candidater deux fois.
 * D'où le balayage préalable : un `ECARTEE` ou un `GENEREE` n'importe où dans
 * l'historique sort l'offre pour de bon.
 *
 * @param {Array<Record<string, unknown>>} journal
 */
export function etatCourant(journal) {
  const lignes = Array.isArray(journal) ? journal : [];

  const classees = new Set();
  for (const ligne of lignes) {
    if (!ligne || typeof ligne !== "object") continue;
    const jobId = txt(ligne.jobId);
    if (jobId && STATUTS_CLASSANTS.includes(txt(ligne.statut))) classees.add(jobId);
  }

  const parId = new Map();
  for (const ligne of lignes) {
    if (!ligne || typeof ligne !== "object") continue;
    const jobId = txt(ligne.jobId);
    if (!jobId || classees.has(jobId)) continue;
    parId.set(jobId, ligne);
  }

  // Les mieux notées d'abord, puis les plus récentes : c'est l'ordre dans lequel
  // Linéo veut les voir pour décider.
  return [...parId.values()].sort((a, b) => {
    const sa = typeof a.score === "number" ? a.score : -1;
    const sb = typeof b.score === "number" ? b.score : -1;
    if (sb !== sa) return sb - sa;
    return String(b.vu_le ?? "").localeCompare(String(a.vu_le ?? ""));
  });
}

/**
 * Retrouve l'offre COMPLÈTE derrière un jobId, pour construire le payload du
 * workflow 2.
 *
 * On ne peut pas prendre bêtement la dernière ligne : une ligne de décision ne
 * porte qu'un `jobId` et un `statut`. On remonte donc à la dernière ligne qui a
 * vraiment du contenu, sinon on enverrait à n8n une offre vide et il échouerait
 * sur « ni title ni description ».
 *
 * @param {Array<Record<string, unknown>>} journal
 * @param {string} jobId
 */
export function offreComplete(journal, jobId) {
  const id = txt(jobId);
  if (!id) return null;
  let trouvee = null;
  for (const ligne of Array.isArray(journal) ? journal : []) {
    if (!ligne || typeof ligne !== "object") continue;
    if (txt(ligne.jobId) !== id) continue;
    if (!txt(ligne.title) && !txt(ligne.description)) continue;
    trouvee = ligne;
  }
  return trouvee;
}

/** Lit un JSONL en tolérant les lignes corrompues (écriture interrompue). */
export function parseJournal(brut) {
  const out = [];
  for (const ligne of String(brut ?? "").split("\n")) {
    const t = ligne.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // Une ligne tronquée ne doit pas rendre tout l'historique illisible.
      continue;
    }
  }
  return out;
}
