// Rédaction de la lettre de motivation. Partie pure et testable.
//
// C'EST LA PIÈCE LA PLUS EXPOSÉE DU SYSTÈME : c'est le seul texte que lit un
// recruteur. D'où trois garde-fous DÉTERMINISTES appliqués après le modèle, en
// plus des consignes du prompt — parce qu'un prompt se contourne, un nettoyage
// non.
//
// Les trois viennent de défauts réellement constatés le 2026-08-05/06 :
//   1. « depuis deux ans » dans la lettre de référence, alors que le poste actuel
//      a commencé en mars 2026. Le prompt de l'ancien agent n'avait AUCUNE règle
//      d'ancienneté ;
//   2. tirets cadratin et markdown, interdits dans les documents candidat, et
//      absents eux aussi de l'ancien prompt ;
//   3. un plafond de quota rendu comme corps de lettre (traité en amont par
//      llm-quota.mjs, mais on revérifie ici que le corps est plausible).

/** La lettre doit tenir sur une page : tools/build_letter.py casse au-delà de ~470 mots. */
export const MAX_MOTS = 380;

/**
 * Nettoyage déterministe du texte rendu par le modèle.
 *
 * Le critère de l'ancienneté n'est pas de supprimer la phrase mais de la ramener
 * à la seule formulation vraie — c'est ce que demande la checklist de validation
 * de Linéo : « dit mars 2026 ».
 */
export function nettoieLettre(s) {
  return String(s ?? "")
    // markdown : gras, italique, liens
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$|[.,;:!?])/g, "$1$2")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // tirets cadratin et demi-cadratin : jamais dans un document candidat
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, ", ")
    // anti-invention d'ancienneté
    .replace(/depuis\s+(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|\d+)\s+ans?(?:\s+et\s+demi)?/gi, "depuis mars 2026")
    .replace(/(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|\d+)\s+ans?(?:\s+et\s+demi)?\s+d[’']exp[ée]rience/gi, "une expérience acquise depuis mars 2026")
    // balises HTML éventuelles
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Une durée chiffrée résiduelle doit arrêter la chaîne, pas partir chez un recruteur. */
export function dureeInventee(s) {
  return /\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|\d+)\s+ans?\b/i.test(String(s ?? ""));
}

/** Construit le prompt. Les faits viennent du CV et de l'offre, jamais du modèle. */
export function promptLettre({ offre = {}, profilCv = "", candidat = {}, consigne = "" }) {
  return [
    "Tu rediges UNE lettre de motivation en francais, a la premiere personne, au nom du candidat.",
    "",
    "OFFRE",
    "- Poste : " + (offre.title || "non precise"),
    "- Entreprise : " + (offre.company || "non precisee"),
    "- Lieu : " + (offre.location || "non precise"),
    "- Annonce : " + String(offre.description || "").slice(0, 2500),
    "",
    "PROFIL DU CANDIDAT (source de verite, n'invente RIEN au-dela)",
    String(profilCv).slice(0, 6000),
    "",
    "REGLES ABSOLUES",
    "- N'invente AUCUNE anciennete et AUCUN chiffre. Le poste actuel a commence en mars 2026.",
    "  Ne dis jamais deux ans, ni un an et demi, ni aucune duree absente du profil.",
    "- N'invente ni diplome, ni technologie, ni client, ni resultat qui ne soit pas dans le profil.",
    "- INTERDIT : le tiret cadratin et le tiret demi-cadratin. Mets une virgule.",
    "- INTERDIT : le markdown et les balises HTML.",
    "- " + MAX_MOTS + " mots maximum pour le corps : la lettre doit tenir sur UNE page.",
    "- Trois a quatre paragraphes. Pas de liste a puces.",
    "- Cite deux ou trois elements concrets de l'annonce et relie-les a des faits du profil.",
    consigne ? "\nCONSIGNE DE RETOUCHE DE LINEO (prioritaire sur le reste)\n" + consigne : "",
    "",
    "SORTIE : uniquement un objet JSON, sans texte autour, de la forme",
    '{"email_subject":"","salutation":"","letter_body":"","key_selling_points":["",""]}',
    "email_subject : objet du courriel, sans prefixe Re:.",
    "salutation : formule d'appel, par defaut Madame, Monsieur,",
    "letter_body : le corps, paragraphes separes par une ligne vide, SANS la formule de politesse finale.",
    "key_selling_points : deux a quatre arguments courts, pour l'apercu seulement.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Lit et assainit la réponse du modèle.
 *
 * Lève plutôt que de rendre une lettre douteuse : une lettre vide, tronquée, ou
 * contenant une durée inventée ne doit jamais atteindre l'étape d'envoi.
 */
export function parseLettre(brut) {
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

  const corps = nettoieLettre(obj.letter_body);
  if (!corps) throw new Error("letter_body vide apres nettoyage");

  const mots = corps.split(/\s+/).filter(Boolean).length;
  if (mots > MAX_MOTS + 120) {
    // Marge tolérée, mais pas illimitée : au-delà, build_letter.py casse le rendu
    // une page, et on préfère le savoir ici que dans l'Action GitHub.
    throw new Error(`lettre trop longue (${mots} mots) : le rendu une page casserait`);
  }
  if (dureeInventee(corps)) {
    throw new Error("une duree chiffree a survecu au nettoyage : " + corps.slice(0, 160));
  }

  return {
    email_subject: nettoieLettre(obj.email_subject) || "Candidature",
    salutation: nettoieLettre(obj.salutation) || "Madame, Monsieur,",
    letter_body: corps,
    key_selling_points: (Array.isArray(obj.key_selling_points) ? obj.key_selling_points : [])
      .map((p) => nettoieLettre(p))
      .filter(Boolean)
      .slice(0, 4),
    mots,
  };
}
