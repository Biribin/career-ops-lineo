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
 * L'adresse de contact publiée avec l'annonce (champ `contact.courriel` de
 * l'API France Travail).
 *
 * Elle vaut la peine d'être portée jusqu'au bout : sans elle, la candidature
 * part à une adresse devinée ou générique, alors que l'employeur a indiqué où
 * écrire. C'est la différence entre atterrir chez le recruteur et dans un
 * formulaire anonyme.
 *
 * Validée sévèrement parce qu'elle vient d'une machine distante et finira comme
 * DESTINATAIRE d'un vrai mail : une valeur douteuse doit devenir une absence de
 * destinataire (l'humain tranchera), jamais un envoi au mauvais endroit. Une
 * seule adresse, pas de liste, pas de nom affiché — « Jean <a@b.fr>, c@d.fr »
 * est rejeté plutôt que découpé au jugé.
 */
const COURRIEL = /^[^\s@,;<>"]+@[^\s@,;<>".]+\.[a-z]{2,}$/i;

export function courrielContact(v) {
  const brut = txt(v).toLowerCase();
  if (!brut || brut.length > 254) return "";
  return COURRIEL.test(brut) ? brut : "";
}

/**
 * Valide et normalise UNE offre reçue de n8n.
 * Renvoie null si elle est inexploitable — mieux vaut l'écarter que stocker une
 * ligne sans identifiant, qu'on ne pourrait plus ni dédupliquer ni valider.
 */
export function normaliseOffreRecue(brut) {
  const o = brut ?? {};
  const jobId = txt(o.jobId);
  if (!jobId) return null;

  // `Number(null)` vaut 0, pas NaN : sans cette garde, un `score: null` explicite
  // devenait un score de 0 et l'offre s'affichait « notée 0/100 » au lieu de « pas
  // encore évaluée ». Constaté le 2026-08-10 sur une offre ajoutée à la main.
  const score = o.score === null || o.score === undefined || o.score === "" ? NaN : Number(o.score);
  return {
    jobId,
    title: txt(o.title),
    company: txt(o.company),
    url: txt(o.url),
    location: txt(o.location),
    whyMatch: txt(o.whyMatch),
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    description: String(o.description ?? "").slice(0, 2000),
    // Plusieurs noms possibles selon le nœud n8n qui a construit le lot : on
    // accepte les trois plutôt que d'imposer un renommage en amont, mais une
    // seule sortie normalisée.
    contactEmail: courrielContact(o.contactEmail ?? o.contact_email ?? o.courriel),
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
 * Les statuts qui SORTENT une offre de la file, définitivement.
 *
 * Les trois premiers sont des décisions de Linéo. `NON_RETENUE` est une décision
 * de la MACHINE, et elle est là pour une raison précise : sans elle, les offres
 * soumises au tri mais non gardées n'étaient inscrites nulle part. Elles
 * revenaient donc à CHAQUE tournée, remangeaient des places du lot et se
 * refaisaient juger à l'identique — 90 offres sur 150 dans la tournée du
 * 2026-08-10. Les inscrire les écarte de `dejaVus` au tour suivant, et
 * `etatCourant` les masque de l'app.
 *
 * Statut distinct de `ECARTEE` exprès : « le modèle n'en a pas voulu » et « Linéo
 * n'en veut pas » ne se valent pas, et il faut pouvoir revenir sur le premier
 * sans perdre le second.
 */
export const STATUTS_CLASSANTS = ["ECARTEE", "GENEREE", "POSTULEE", "NON_RETENUE"];

/**
 * Les lignes de journal pour les offres soumises au tri et NON gardées.
 *
 * Volontairement minces : jobId, titre (pour qu'un humain qui relit le journal
 * sache de quoi il s'agit) et le score s'il y en a un. Une offre sous le plancher
 * a été notée par le modèle ; une offre que le modèle n'a pas citée du tout n'a
 * pas de score, et `null` dit exactement ça.
 *
 * @param {Array<{jobId?: string, title?: string, score?: number|null, raison?: string}>} offres
 * @param {string} quand  horodatage ISO, INJECTÉ (tests déterministes)
 * @param {{source?: string, executionId?: string}} [ctx]
 */
export function lignesNonRetenues(offres, quand, ctx = {}) {
  const out = [];
  const vus = new Set();
  for (const brut of Array.isArray(offres) ? offres : []) {
    const jobId = txt(brut?.jobId);
    if (!jobId || vus.has(jobId)) continue;
    vus.add(jobId);
    const score = Number(brut?.score);
    out.push({
      jobId,
      title: txt(brut?.title),
      score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
      statut: "NON_RETENUE",
      raison: txt(brut?.raison) || "non gardee au tri",
      vu_le: quand,
      source: txt(ctx.source) || "n8n",
      execution_id: txt(ctx.executionId),
    });
  }
  return out;
}

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
