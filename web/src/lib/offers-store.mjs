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

/**
 * Réduit un journal append-only à l'état courant.
 *
 * Une offre revue lors d'une tournée suivante écrase la précédente : c'est la
 * ligne la PLUS RÉCENTE qui fait foi. Sans ça, une offre rescannée apparaîtrait
 * deux fois dans l'app.
 *
 * @param {Array<Record<string, unknown>>} journal
 */
export function etatCourant(journal) {
  const parId = new Map();
  for (const ligne of Array.isArray(journal) ? journal : []) {
    if (!ligne || typeof ligne !== "object") continue;
    const jobId = txt(ligne.jobId);
    if (!jobId) continue;
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
