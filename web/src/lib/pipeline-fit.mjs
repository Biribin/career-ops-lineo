/**
 * pipeline-fit.mjs — évaluer UNE offre découverte, en lisant vraiment l'annonce.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Le classement du scan (`scan-rank.mjs`) ne regarde que trois choses :
 * l'intitulé, le lieu et la date de publication. Il ne lit **jamais** le corps
 * de l'annonce, et il traite « junior », « senior », « confirmé », « débutant »
 * comme des mots vides. C'est voulu — c'est un pré-classement gratuit et
 * déterministe — mais ça produit un piège concret, constaté le 2026-08-07 :
 * une offre notée 83/100 exigeait « 3 à 5 ans d'expérience » dans son corps,
 * donc inaccessible, et rien dans le score ne pouvait le dire.
 *
 * Aucun réglage de mots-clés ne rattrape ça : l'exigence est dans le texte, pas
 * dans le titre. Il faut lire l'annonce. C'est ce que fait ce module.
 *
 * CE QU'IL NE FAIT PAS
 * --------------------
 * Il ne décide pas à la place de Linéo, et il ne remplace pas l'évaluation
 * complète du mode `oferta` (rapport A-G, note sur 5, ligne de tracker). C'est
 * un filtre d'entrée : « est-ce que ça vaut le coup d'aller plus loin ». Il
 * répond vite, sur une seule offre, et son seul travail vraiment critique est
 * de repérer les BLOQUANTS — les exigences qu'aucune lettre ne contournera.
 *
 * La règle qui gouverne le prompt : un bloquant doit être **cité** depuis
 * l'annonce. Un modèle qui « estime » que le poste est trop senior sans pouvoir
 * montrer la phrase invente, et une offre écartée à tort coûte plus cher qu'une
 * offre évaluée pour rien.
 */

/** Au-delà, ce n'est plus un extrait d'annonce, c'est une page entière de bruit. */
export const MAX_ANNONCE = 12000;

/** Notes possibles. Volontairement peu nombreuses : une échelle fine invite à */
/** discuter le 6 contre le 7 au lieu de trancher. */
export const VERDICTS = ["a_postuler", "a_regarder", "hors_cible"];

/**
 * Le prompt. Deux exigences non négociables y sont écrites en toutes lettres :
 * citer les bloquants, et ne jamais deviner une ancienneté que le CV ne porte
 * pas (même garde-fou que `followup-draft.mjs` et `cv-adapt.mjs`).
 */
export function promptFit({ offre = {}, texteAnnonce = "", profilCv = "" }) {
  return [
    "Tu evalues UNE offre d'emploi pour un candidat. Tu reponds en francais.",
    "",
    "OFFRE",
    "- Intitule : " + (offre.role || offre.poste || "non precise"),
    "- Entreprise : " + (offre.company || offre.entreprise || "non precisee"),
    "- Lieu : " + (offre.location || offre.lieu || "non precise"),
    "- URL : " + (offre.url || "inconnue"),
    "",
    "TEXTE DE L'ANNONCE (source de verite, n'invente RIEN au-dela)",
    String(texteAnnonce || "").slice(0, MAX_ANNONCE) || "(annonce vide ou illisible)",
    "",
    profilCv ? "PROFIL DU CANDIDAT (source de verite)\n" + String(profilCv).slice(0, 4000) : "",
    "",
    "REGLES ABSOLUES",
    "- Un BLOQUANT doit etre CITE depuis l'annonce, mot pour mot, dans le champ",
    "  citation. Si tu ne peux pas citer la phrase, ce n'est pas un bloquant :",
    "  ne l'inventé pas. Une offre ecartee a tort coute plus cher qu'une offre",
    "  evaluee pour rien.",
    "- Est bloquant ce qu'aucune lettre de motivation ne contourne : une",
    "  anciennete minimale chiffree superieure a celle du candidat, un diplome",
    "  impose, une habilitation, une langue non maitrisee, une obligation de",
    "  presence sur un lieu inaccessible, une nationalite ou un permis de",
    "  travail que le candidat n'a pas.",
    "- N'est PAS bloquant : une techno que le candidat n'a jamais utilisee, un",
    "  secteur nouveau, une preference (\"idealement\", \"un plus\", \"apprecie\").",
    "- N'invente AUCUNE anciennete pour le candidat. Ce que dit le profil fait foi.",
    "- INTERDIT : le tiret cadratin, le markdown, les balises HTML.",
    "",
    "VERDICT",
    "- hors_cible : au moins un bloquant.",
    "- a_regarder : aucun bloquant, mais l'ecart est reel et demande un effort.",
    "- a_postuler : aucun bloquant et le profil couvre l'essentiel.",
    "",
    "Reponds UNIQUEMENT par un objet JSON :",
    '{"verdict":"a_postuler|a_regarder|hors_cible",',
    ' "resume":"une phrase, 30 mots maximum",',
    ' "bloquants":[{"quoi":"...","citation":"phrase exacte de l annonce"}],',
    ' "atouts":["..."],',
    ' "ecarts":["..."]}',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/** Coupe ce que le modèle n'a pas le droit de produire, comme partout ailleurs. */
export function nettoieTexteFit(s) {
  return String(s ?? "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\s+[—–]\s+/g, ", ")
    .replace(/[—–]/g, ", ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalise une phrase pour vérifier qu'elle vient bien de l'annonce. */
function pliage(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Parse la réponse, et surtout VÉRIFIE les bloquants.
 *
 * Un bloquant dont la citation ne se retrouve pas dans l'annonce est rétrogradé
 * en écart, jamais gardé : c'est la seule protection déterministe contre un
 * modèle qui écarte une offre sur une exigence qu'il a imaginée. La vérification
 * est faite ici, pas dans le prompt, parce qu'une consigne se contourne et pas
 * une comparaison de chaînes.
 *
 * @param {string} brut - Sortie du modèle.
 * @param {string} texteAnnonce - L'annonce, pour vérifier les citations.
 */
export function parseFit(brut, texteAnnonce = "") {
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

  const annonce = pliage(texteAnnonce);
  const listeTexte = (v) =>
    (Array.isArray(v) ? v : []).map((x) => nettoieTexteFit(x)).filter(Boolean).slice(0, 6);

  const bloquants = [];
  const nonVerifies = [];
  for (const b of Array.isArray(obj.bloquants) ? obj.bloquants : []) {
    const quoi = nettoieTexteFit(b?.quoi);
    const citation = nettoieTexteFit(b?.citation);
    if (!quoi) continue;
    // Une citation vide, ou absente de l'annonce, ne prouve rien.
    const prouve = citation.length >= 12 && annonce.includes(pliage(citation));
    if (prouve) bloquants.push({ quoi, citation });
    else nonVerifies.push(quoi);
  }

  let verdict = String(obj.verdict ?? "").trim();
  if (!VERDICTS.includes(verdict)) verdict = bloquants.length ? "hors_cible" : "a_regarder";
  // Un verdict hors_cible sans bloquant prouvé n'est pas tenable : on le
  // redescend plutôt que d'écarter une offre sur une intuition.
  if (verdict === "hors_cible" && bloquants.length === 0) verdict = "a_regarder";

  return {
    verdict,
    resume: nettoieTexteFit(obj.resume).slice(0, 240),
    bloquants,
    // Remontés à part : Linéo voit ce que le modèle a avancé sans pouvoir le
    // citer, au lieu que ça disparaisse en silence.
    bloquantsNonVerifies: nonVerifies.slice(0, 6),
    atouts: listeTexte(obj.atouts),
    ecarts: listeTexte(obj.ecarts),
  };
}
