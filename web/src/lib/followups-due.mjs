// Le contrat « relances dues » : la forme FIGÉE que n8n consomme sur
// GET /api/followups. Logique pure (pas de fs, pas de process) pour être
// testable sans le tracker de Linéo.
//
// La cadence n'est JAMAIS recalculée ici. C'est followup-cadence.mjs qui rend le
// verdict (le même moteur que le CLI) ; on ne fait que le projeter dans les
// cinq champs du contrat. Renommer un champ ici casse la session n8n.

/**
 * Une entrée telle que followup-cadence.mjs la sort (champs utilisés seulement).
 * @typedef {Object} EntreeCadence
 * @property {number|string} [num]
 * @property {string} [company]
 * @property {string} [role]
 * @property {string} [urgency]
 * @property {string} [status]
 * @property {number} [daysSinceApplication]
 * @property {{email?: string|null, name?: string|null}[]} [contacts]
 */

/**
 * Une relance due, dans la forme du contrat n8n.
 * @typedef {Object} Relance
 * @property {string} id
 * @property {string} entreprise
 * @property {string} poste
 * @property {string|null} courriel_contact
 * @property {number} jours_depuis_envoi
 */

/**
 * Le prédicat de `followup-cadence.mjs --overdue-only` : urgence `overdue` ou
 * `urgent`. On regarde AUSSI `status`, comme le faisait la route avant ce
 * contrat — un moteur plus ancien peut y porter l'urgence, et une relance ratée
 * coûte plus cher qu'une ligne affichée en trop.
 *
 * @param {EntreeCadence} e
 * @returns {boolean}
 */
export function estDue(e) {
  return /\b(overdue|urgent)\b/i.test(`${e?.urgency ?? ""} ${e?.status ?? ""}`);
}

/**
 * Le courriel du premier contact qui en a un, sinon null. `extractContacts` du
 * cœur renvoie aussi des contacts nommés sans adresse (« relancé Marie par
 * LinkedIn ») : ceux-là ne sont pas relançables par mail, donc on les saute au
 * lieu de rendre une chaîne vide que n8n prendrait pour un destinataire.
 *
 * @param {EntreeCadence} e
 * @returns {string|null}
 */
export function courrielContact(e) {
  for (const c of e?.contacts ?? []) {
    const adresse = String(c?.email ?? "").trim();
    if (adresse) return adresse;
  }
  return null;
}

/**
 * Projette une entrée de cadence dans le contrat.
 *
 * `id` est une CHAÎNE : c'est le numéro de ligne du tracker, et c'est le
 * sélecteur que `set-status.mjs <sélecteur>` et POST /api/followups/log
 * (`appNum`) attendent. En chaîne, n8n peut le réinjecter tel quel.
 *
 * @param {EntreeCadence} e
 * @returns {Relance}
 */
export function versRelance(e) {
  const jours = Number(e?.daysSinceApplication);
  return {
    id: String(e?.num ?? ""),
    entreprise: String(e?.company ?? "").trim(),
    poste: String(e?.role ?? "").trim(),
    courriel_contact: courrielContact(e),
    jours_depuis_envoi: Number.isFinite(jours) ? jours : 0,
  };
}

/**
 * La liste `due` du contrat. Une entrée sans `num` est écartée : sans sélecteur,
 * n8n ne pourrait ni journaliser la relance ni mettre le tracker à jour, et une
 * ligne inactionnable dans la file de relances est un piège.
 *
 * @param {EntreeCadence[]} entries
 * @returns {Relance[]}
 */
export function relancesDues(entries) {
  return (Array.isArray(entries) ? entries : []).filter(estDue).map(versRelance).filter((r) => r.id !== "");
}
