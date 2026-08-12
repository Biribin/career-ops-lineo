/**
 * candidature-n8n.mjs — la charge envoyée au workflow n8n « 2. Generation
 * lettre + CV », pour une offre venue du SCANNER LOCAL (data/pipeline.md).
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Le déclenchement existait déjà, mais uniquement pour les offres France Travail :
 * /api/offers/decision lit l'offre dans le journal n8n par son `jobId`, appelle le
 * webhook, puis écrit une ligne `GENEREE` dans ce même journal. Une offre trouvée
 * par le scanner local n'est pas dans ce journal — la route répondait donc « offre
 * introuvable », et il n'y avait aucun bouton « générer » sur ces lignes.
 *
 * L'y injecter pour réutiliser la route serait pire : la page Candidatures est une
 * FUSION D'AFFICHAGE de deux stockages volontairement séparés (data/pipeline.md et
 * data/offres-n8n.jsonl), et l'offre apparaîtrait deux fois.
 *
 * D'où ce module : construire la même charge, depuis l'autre source.
 */

// Import RELATIF : l'alias `@/` n'est résolu que par le bundler, or ce module
// est chargé tel quel par `node --test`.
import { MAX_ANNONCE } from "./pipeline-fit.mjs";

export const CHEMIN_WF2 = "/webhook/candidature-generer";
const N8N_DEFAUT = "https://n8n.balzac-info.online";

/**
 * L'URL du webhook du workflow 2.
 *
 * @param {string|undefined} base - `N8N_BASE_URL`, si défini.
 * @returns {string}
 */
export function urlWebhookWf2(base) {
  return `${(base?.trim() || N8N_DEFAUT).replace(/\/+$/, "")}${CHEMIN_WF2}`;
}

/**
 * La charge attendue par le nœud « 🧩 Contexte candidature » du workflow 2.
 *
 * Ce qu'il exige : `title` OU `description` non vide, sinon il jette « offre
 * inexploitable ». Une ligne de pipeline.md n'a que l'intitulé, l'entreprise, le
 * lieu et l'URL — pas le texte de l'annonce. C'est pour ça que l'appelant lit
 * l'annonce avant : la lettre est rédigée à partir de `description`, donc sans
 * elle on obtiendrait une lettre creuse, ce qui est pire que pas de lettre.
 *
 * Ce qu'on ne remplit PAS, et pourquoi :
 *   - `jobId` : vide exprès. Le workflow retombe alors sur
 *     `slug(entreprise + '-' + titre)` pour nommer la fiche, ce qui donne un
 *     `data-inbox/<entreprise>-<poste>.json` lisible, là où un identifiant
 *     inventé ici donnerait un nom opaque. Contrepartie assumée : deux offres de
 *     même intitulé dans la même entreprise partageraient la fiche.
 *   - `score` : `null`. Le pré-filtre d'annonce ne produit pas de note sur 5 ;
 *     en inventer une afficherait une évaluation qui n'a pas eu lieu.
 *   - `contactEmail` : vide. Le workflow retombe sur son comportement habituel —
 *     mieux vaut pas d'adresse qu'une mauvaise.
 *
 * @param {{offre: {url?: string, company?: string, role?: string, location?: string}, texteAnnonce: string, quand: string}} p
 * @returns {{mode: string, declenche_par: string, at: string, job: Record<string, unknown>}}
 */
export function chargeWf2({ offre, texteAnnonce, quand }) {
  return {
    mode: "nouvelle",
    declenche_par: "career-ops-web",
    at: quand,
    job: {
      jobId: "",
      title: String(offre?.role ?? "").trim(),
      company: String(offre?.company ?? "").trim(),
      // Borné à la même longueur que l'annonce envoyée au pré-filtre : au-delà,
      // on paie des jetons pour du pied de page. Une charge non bornée traverse
      // ici un webhook PUIS un modèle, donc le coût comme le délai doublent.
      description: String(texteAnnonce ?? "").slice(0, MAX_ANNONCE),
      url: String(offre?.url ?? "").trim(),
      location: String(offre?.location ?? "").trim(),
      whyMatch: "",
      score: null,
      contactEmail: "",
    },
  };
}

/**
 * Ce qu'on dit à l'écran quand n8n refuse la charge.
 *
 * Le 404 mérite son propre message : un nœud Webhook ne répond QUE sur un
 * workflow actif, donc « ça ne fait rien » veut presque toujours dire « le
 * workflow est désactivé ». Sans ça, on cherche longtemps du mauvais côté.
 *
 * @param {number} status
 * @returns {string}
 */
export function explicationEchecWf2(status) {
  if (status === 404) {
    return "n8n a répondu 404 : le workflow « 2. Generation lettre + CV » est-il ACTIVÉ ? Un nœud Webhook ne répond pas sur un workflow désactivé.";
  }
  return `n8n a répondu ${status}`;
}
