/**
 * followup-draft.mjs — rédaction d'une relance de candidature. Partie pure.
 *
 * Quatrième et dernier prompt rapatrié depuis le workflow n8n K3i1VbzSLuJYJLBM
 * (nœud « ✍️ Agent: Brouillon de relance »). Même motif que letter.mjs : le
 * texte part chez un recruteur, donc les règles vivent ici, testées, et pas dans
 * un nœud d'agent que personne ne peut rejouer.
 *
 * CE QUI DIFFÈRE D'UNE LETTRE DE MOTIVATION
 * -----------------------------------------
 * Une relance est courte (90 mots), elle ne re-argumente pas, et elle ne doit
 * surtout pas inventer d'historique : « comme convenu lors de notre échange »
 * dans une relance automatique, alors qu'aucun échange n'a eu lieu, est la pire
 * sortie possible. C'est le garde-fou spécifique de ce fichier.
 *
 * La CADENCE (délai, nombre maxi) ne se décide PAS ici : elle vient de
 * `followup-cadence.mjs` via `/api/followups?full=1`. Ce module rédige, il ne
 * décide jamais s'il faut relancer.
 */

/** Une relance qui dépasse ça n'est plus une relance, c'est une deuxième lettre. */
export const MAX_MOTS = 90;
/** Un objet plus long est tronqué par les clients de messagerie. */
export const MAX_OBJET = 60;

// Faits que le modèle n'a pas le droit d'inventer parce qu'ils n'existent pas.
// Pas de `\b` final : une alternative qui se termine par une lettre accentuée
// (« parlé », « téléphone ») n'a pas de frontière de mot au sens de JS, et la
// détection sautait précisément sur les formes accentuées.
const ECHANGES_INVENTES =
  /\b(?:comme convenu|suite (?:a|à) (?:notre|nos) (?:echange|échange|entretien|conversation|appel)|lors de (?:notre|nos) (?:echange|échange|entretien)|nous nous sommes (?:parle|parlé|rencontres|rencontrés)|(?:notre|nos) (?:entretien|entretiens) (?:du|de)|au telephone|au téléphone)/i;

/** Nettoyage déterministe, aligné sur letter.mjs : mêmes interdits, même motif. */
export function nettoieRelance(s) {
  return String(s ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, ", ")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Une durée chiffrée en années est toujours une invention : poste depuis mars 2026. */
export function dureeInventee(s) {
  return /\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|\d+)\s+ans?\b/i.test(String(s ?? ""));
}

/** Un échange qui n'a jamais eu lieu. */
export function echangeInvente(s) {
  return ECHANGES_INVENTES.test(String(s ?? ""));
}

/**
 * Le prompt. Porté du nœud n8n, avec deux règles ajoutées après relecture :
 * l'interdiction explicite d'inventer un échange, et le rappel que le pied de
 * message (téléphone, courriel) est ajouté par le workflow, pas par le modèle.
 */
export function promptRelance({ relance = {}, profilCv = "", consigne = "" }) {
  const jours = Number(relance.joursDepuisEnvoi);
  return [
    "Tu rediges une relance de candidature restee sans reponse, en francais, a la premiere personne, au nom du candidat.",
    "",
    "CONTEXTE",
    "- Entreprise : " + (relance.entreprise || "non precisee"),
    "- Poste : " + (relance.poste || "non precise"),
    "- Candidature envoyee il y a : " + (Number.isFinite(jours) ? jours + " jours" : "duree inconnue"),
    "- Date de la candidature : " + (relance.envoyeeLe || "inconnue"),
    "- Offre : " + (relance.urlOffre || "inconnue"),
    "- Nom du candidat : " + (relance.candidat || "le candidat"),
    "- Numero de cette relance : " + (relance.rang || 1) + " sur " + (relance.relanceMax || 2) + " au maximum",
    "",
    profilCv ? "PROFIL DU CANDIDAT (source de verite, n'invente RIEN au-dela)\n" + String(profilCv).slice(0, 4000) : "",
    "",
    "REGLES ABSOLUES",
    "- INTERDIT : le tiret cadratin et le tiret demi-cadratin. Mets une virgule ou deux-points.",
    "- INTERDIT : le markdown et les balises HTML.",
    "- N'invente AUCUNE anciennete et AUCUN chiffre. Le poste actuel du candidat a commence en mars 2026.",
    "- N'invente AUCUN echange passe : ni entretien, ni appel telephonique, ni reponse recue, ni nom de recruteur.",
    "  Personne n'a repondu, c'est la raison meme de cette relance.",
    "- " + MAX_MOTS + " mots maximum pour le corps, trois paragraphes courts au plus.",
    "- Ton courtois et direct, sans insistance et sans reproche : c'est une relance, pas une reclamation.",
    "- Rappelle le poste et l'entreprise, situe la candidature dans le temps avec ce que donne le contexte,",
    "  et redis en une phrase l'interet pour le poste.",
    "- Termine par une formule de politesse simple suivie du SEUL nom du candidat. N'ajoute ni telephone",
    "  ni adresse de courriel : le pied de message est ajoute automatiquement apres toi.",
    consigne ? "\nCONSIGNE DE RETOUCHE (prioritaire sur le reste)\n" + consigne : "",
    "",
    "SORTIE : uniquement un objet JSON, sans texte autour, de la forme",
    '{"objet":"","corps":""}',
    "objet : " + MAX_OBJET + " caracteres maximum, mentionne le poste, sans prefixe Re: ni Relance:.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Lit et assainit la réponse du modèle. Lève plutôt que de rendre une relance
 * douteuse : une relance qui invente un entretien fait plus de dégâts que pas
 * de relance du tout.
 */
export function parseRelance(brut) {
  const texte = String(brut ?? "").trim();
  if (!texte) throw new Error("reponse vide du modele");

  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  let obj = null;
  if (debut !== -1 && fin > debut) {
    try {
      obj = JSON.parse(texte.slice(debut, fin + 1));
    } catch {
      obj = null;
    }
  }
  if (!obj || typeof obj !== "object") {
    throw new Error("reponse hors format (pas d'objet JSON) : " + texte.slice(0, 200));
  }

  const corps = nettoieRelance(obj.corps);
  if (!corps) throw new Error("corps vide apres nettoyage");

  const mots = corps.split(/\s+/).filter(Boolean).length;
  if (mots > MAX_MOTS + 40) {
    throw new Error(`relance trop longue (${mots} mots) : une relance doit rester courte`);
  }
  if (dureeInventee(corps)) {
    throw new Error("une duree chiffree a survecu au nettoyage : " + corps.slice(0, 160));
  }
  if (echangeInvente(corps)) {
    throw new Error("la relance evoque un echange qui n'a jamais eu lieu : " + corps.slice(0, 160));
  }

  const objet = nettoieRelance(obj.objet).replace(/^\s*(?:re|relance)\s*:\s*/i, "").slice(0, MAX_OBJET);
  if (!objet) throw new Error("objet vide apres nettoyage");

  return { objet, corps, mots };
}
