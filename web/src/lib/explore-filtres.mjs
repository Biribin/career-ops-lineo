// Validation des critères de recherche d'Explorer conservés d'une visite à
// l'autre. Partie pure et testable : aucun accès à localStorage ici, le stockage
// est au provider (même découpage que offers-store.mjs / offers-journal.ts).
//
// LE BUG D'ORIGINE : ajouter « sales » aux exclusions puis recharger la page le
// perdait en silence. Les critères ne survivaient que si on lançait une
// découverte, qui les écrit dans l'URL.

/** Une liste de textes, ou le repli si le contenu n'en est pas une. */
const listeDeTextes = (v, repli) =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? v : repli;

/**
 * Valide un objet de critères relu du stockage et le complète avec la graine.
 *
 * Rend `null` si le contenu est inexploitable — on retombe alors entièrement sur
 * la graine `portals.yml`, jamais sur un objet à moitié valide qui casserait le
 * formulaire sans qu'on comprenne pourquoi.
 *
 * Les champs absents ou mal typés sont comblés par la graine : un réglage
 * enregistré avant l'ajout d'un critère ne doit pas le rendre `undefined`.
 *
 * @param {unknown} brut     ce qui sort du stockage, déjà parsé
 * @param {object} graine    les critères issus de portals.yml
 */
export function normaliseFiltresSauves(brut, graine) {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return null;
  return {
    ...graine,
    positive: listeDeTextes(brut.positive, graine.positive),
    negative: listeDeTextes(brut.negative, graine.negative),
    allow: listeDeTextes(brut.allow, graine.allow),
    block: listeDeTextes(brut.block, graine.block),
    alwaysAllow: listeDeTextes(brut.alwaysAllow, graine.alwaysAllow),
    sinceDays:
      typeof brut.sinceDays === "number" && brut.sinceDays > 0 ? brut.sinceDays : graine.sinceDays,
    // Zéro source cochée ne se conserve pas : on ne scannerait rien, et l'écran
    // paraîtrait cassé sans dire pourquoi.
    ats: Array.isArray(brut.ats) && brut.ats.length > 0 ? brut.ats : graine.ats,
    limitPerAts:
      typeof brut.limitPerAts === "number" && brut.limitPerAts > 0
        ? brut.limitPerAts
        : graine.limitPerAts,
  };
}
