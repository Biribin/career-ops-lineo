// L'identité d'un POSTE, indépendamment de l'identifiant que France Travail lui
// a donné. Partie pure, sans disque ni réseau.
//
// LE PROBLÈME QUE ÇA RÈGLE
// ------------------------
// Toute la déduplication du pont n8n reposait sur `jobId`, et France Travail
// publie le MÊME poste sous plusieurs identifiants. Mesuré sur la tournée du
// 2026-08-14 (1 650 réponses brutes) :
//
//   1 150 identifiants uniques pour 783 postes identifiables
//   27 postes portaient 2 identifiants ou plus dans la MÊME tournée (35 en trop)
//   7 postes de la veille sont revenus le lendemain sous un identifiant NEUF
//
// Conséquence visible pour Linéo : il écartait « Analyste décisionnel » chez
// DCARTE (212GLHJ) et son jumeau (212GLHM) restait dans la file — puis revenait.
// « Écarter » collait à l'identifiant, pas au poste.
//
// CE QUI COMPOSE LA CLÉ, ET POURQUOI
// ----------------------------------
//  - l'EMPLOYEUR est OBLIGATOIRE. 332 des 1 150 offres de cette tournée n'ont
//    aucun nom d'entreprise ; les regrouper sur le seul intitulé collerait
//    ensemble trois « Chef de projet IA (H/F)» de trois employeurs différents,
//    et un refus en ferait disparaître deux que Linéo n'a jamais vues. Sans
//    employeur, pas de clé : on retombe alors sur le comportement par
//    identifiant, qui n'a jamais rien masqué à tort.
//  - l'INTITULÉ est comparé comme un ENSEMBLE de mots, pas comme une chaîne :
//    « Développeur IA - Metz (H/F) » et « Développeur IA (H/F) - Metz » sont la
//    même annonce republiée, et un simple `===` les rate.
//  - la VILLE en fait partie, à contrecœur. Sans elle on capture 66 postes au
//    lieu de 27 — mais une agence d'intérim publie le même intitulé dans dix
//    villes, et fusionner ces dix annonces ferait disparaître Paris parce que
//    Lyon a été écartée. Un doublon de trop coûte un clic ; une offre masquée à
//    tort ne se voit jamais.

/** Minuscules, sans accents, sans ponctuation. */
export function normalise(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Les mots qui ne disent rien du poste : marqueurs de genre (h/f, f/h, m/w/d) et
 * mots-outils. Les garder ferait dépendre la clé d'un détail de mise en forme —
 * exactement ce qui a laissé passer les jumeaux Metz.
 */
const VIDES = new Set([
  "h", "f", "hf", "fh", "m", "w", "d", "x", "hfd", "mfd",
  "le", "la", "les", "un", "une", "de", "du", "des", "en", "et", "a", "au", "aux", "pour", "sur",
]);

/**
 * L'intitulé réduit à son ensemble de mots utiles, dédoublonné et TRIÉ : deux
 * intitulés qui ne diffèrent que par l'ordre ou la ponctuation donnent la même
 * valeur.
 *
 * @param {string} titre
 * @returns {string}
 */
export function jetonsTitre(titre) {
  return [...new Set(normalise(titre).split(" ").filter((t) => t && !VIDES.has(t)))].sort().join(" ");
}

/**
 * La ville, débarrassée du numéro de département que France Travail préfixe
 * (`57 - METZ`, `75 - PARIS`). Sans ce nettoyage, « 59 - LILLE » et « Lille »
 * seraient deux lieux différents.
 *
 * @param {unknown} lieu
 * @returns {string}
 */
export function normaliseVille(lieu) {
  return normalise(lieu).replace(/\d+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * L'identité d'un poste : `employeur | mots de l'intitulé | ville`.
 *
 * Renvoie `null` — et c'est un cas NORMAL, pas une erreur — dès qu'il manque
 * l'employeur ou l'intitulé. Une clé partielle serait pire que pas de clé :
 * elle regrouperait des annonces qu'on n'a aucun moyen de reconnaître comme
 * identiques. L'appelant retombe alors sur la déduplication par identifiant.
 *
 * @param {{company?: unknown, title?: unknown, location?: unknown}} offre
 * @returns {string|null}
 */
export function cleJob(offre) {
  const o = offre ?? {};
  const employeur = normalise(o.company);
  const intitule = jetonsTitre(o.title);
  if (!employeur || !intitule) return null;
  return `${employeur} | ${intitule} | ${normaliseVille(o.location)}`;
}
