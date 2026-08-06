// Détection d'un refus pour plafond de quota, et rotation des comptes.
//
// POURQUOI CE FICHIER EST CRITIQUE
// --------------------------------
// Quand l'abonnement est épuisé, le CLI ne plante pas : il RÉPOND, en texte, un
// truc comme « You've hit your weekly limit · resets Aug 9, 8am (UTC) », et sort
// souvent avec un code 0. Sans la détection ci-dessous, ce texte devient la
// réponse du modèle. Concrètement, dans ce projet, ça donnerait :
//
//   - une lettre de motivation dont le corps est « You've hit your weekly
//     limit », commitée dans le repo cv, rendue en PDF, affichée en aperçu,
//     puis envoyée à un recruteur ;
//   - ou un tri d'offres vide interprété comme « aucune offre ne correspond ».
//
// C'est le pire mode de panne du système : silencieux, et visible seulement par
// le destinataire. D'où une détection explicite, testée, et un basculement vers
// le second compte AVANT de rendre quoi que ce soit.
//
// Constaté le 2026-08-06 : `claude-run` dans le conteneur n8n renvoyait 429
// (limite hebdo) pendant que le CLI du conteneur career-ops répondait
// normalement. Les comptes sont distincts, donc la bascule a un vrai sens.

/**
 * Motifs de refus pour plafond, en anglais (le CLI répond en anglais même avec
 * un prompt français). Volontairement large : mieux vaut basculer inutilement
 * sur le second compte que renvoyer un message d'erreur en guise de lettre.
 */
const MOTIFS = [
  /you'?ve hit your (weekly|daily|monthly|usage) limit/i,
  /you'?ve reached your (weekly|daily|monthly|usage) limit/i,
  /usage limit reached/i,
  /rate.?limit(ed|ing)?/i,
  /quota (exceeded|exhausted|reached)/i,
  /too many requests/i,
  /resets? (at|on|in) /i,
  /\b429\b/,
  /insufficient (credit|quota|balance)/i,
  /credit balance is too low/i,
];

/** Un refus de plafond est court : le vrai message observé fait 53 caractères. */
const LONGUEUR_REFUS_MAX = 200;
/** Et il commence par le motif : il arrive seul, sans préambule. */
const PREFIXE = 60;

/**
 * Vrai si cette sortie est un refus pour plafond plutôt qu'une réponse.
 *
 * LE DISCRIMINANT N'EST PAS LE MOTIF SEUL, C'EST « COURT ET ISOLÉ ».
 * Un premier essai cherchait le motif dans les 400 premiers caractères. Un test
 * l'a mis par terre : Linéo travaille sur des API, une lettre de motivation peut
 * légitimement écrire « j'ai mis en place de la gestion de rate limiting ». Elle
 * était alors jetée comme un refus de quota, et la candidature silencieusement
 * sautée — exactement le genre de panne muette qu'on essaie d'éliminer.
 *
 * Deux signaux fiables, donc :
 *   - stderr : une vraie réponse n'y passe jamais ;
 *   - stdout COURT (≤ 200 c.) ou commençant par le motif (≤ 60 c.) : dans ce
 *     système, une réponse valide est toujours substantielle (une lettre, un
 *     YAML, une liste JSON). Une sortie de 53 caractères n'est jamais une
 *     réponse.
 *
 * @param {unknown} sortie  stdout du CLI
 * @param {unknown} [erreur] stderr du CLI
 */
export function estPlafond(sortie, erreur) {
  const texte = String(sortie ?? "").trim();
  const err = String(erreur ?? "").trim().slice(0, 400);
  const court = texte.length > 0 && texte.length <= LONGUEUR_REFUS_MAX;
  const debut = texte.slice(0, PREFIXE);

  return MOTIFS.some((m) => m.test(err) || (court && m.test(texte)) || m.test(debut));
}

/**
 * L'ordre des comptes à essayer, sans jamais lire la valeur d'un jeton.
 *
 * On ne renvoie que des NOMS de variables d'environnement : l'appelant fera
 * `process.env[nom]`. Aucun secret ne transite par ce module, donc rien ne peut
 * fuir dans un log ou un message d'erreur.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {Array<{id: string, varJeton: string|null}>}
 */
export function comptesDisponibles(env) {
  const e = env ?? {};
  const comptes = [];

  // Compte 1 : l'environnement tel quel (CLAUDE_CODE_OAUTH_TOKEN déjà posé).
  // varJeton null = « ne surcharge rien », c'est la config par défaut.
  comptes.push({ id: "compte-1", varJeton: null });

  // Comptes suivants : _2, _3, … tant qu'ils sont définis. Le suffixe numéroté
  // est la convention déjà retenue par /api/forum-judge, on s'y aligne au lieu
  // d'en inventer une seconde.
  for (let n = 2; n <= 5; n += 1) {
    const nom = `CLAUDE_CODE_OAUTH_TOKEN_${n}`;
    if (String(e[nom] ?? "").trim()) comptes.push({ id: `compte-${n}`, varJeton: nom });
  }

  return comptes;
}
