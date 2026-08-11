// Logique pure du tailoring « données » : ce que POST /api/tailor renvoie à n8n
// pour qu'il l'injecte dans le CV Typst. Aucun HTML, aucune prose générée — des
// mots-clés et un intitulé, rien d'autre.
//
// L'INVARIANT ANTI-INVENTION, en une phrase : un mot-clé rendu ici est un mot-clé
// écrit noir sur blanc dans la section « Skills » de cv.md, et que l'offre
// mentionne aussi. Rien n'est déduit, rien n'est reformulé, rien n'est ajouté.
// Même invariant pour l'intitulé : il sort de config/profile.yml → target_roles.
//
// Deux sources se rejoignent sur cet invariant :
//   A. jd-skill-gap.mjs (le classifieur du cœur) → bucket `existing` seulement,
//      c'est-à-dire les jetons de l'offre retrouvés dans la section Skills. Il
//      apporte la canonicalisation d'alias (offre « k8s » ↔ CV « Kubernetes »).
//      Les buckets `supportedByResume` (trace en prose seulement) et `gap` sont
//      JETÉS : la prose ne prouve pas une compétence nommée, et un `gap` est
//      exactement ce qu'il ne faut jamais écrire sur un CV.
//   B. le vocabulaire de la section Skills ∩ le texte de l'offre. Indispensable :
//      l'extracteur du cœur ne reconnaît que des en-têtes anglais et des jetons
//      à initiale majuscule, donc sur une offre française il rend souvent zéro,
//      et il ne verrait jamais « n8n », « paie » ou « DSN ».

/** Une offre écrit « integration » aussi souvent qu'« intégration » : on compare
 *  des textes, pas des orthographes. */
function sansAccents(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Forme de comparaison neutre : sans accents ni casse. */
function normaliser(s) {
  return sansAccents(s).toLowerCase();
}

/**
 * Nettoie une valeur destinée aux documents candidat : ni markdown, ni tiret
 * cadratin. Ces sorties finissent dans le CV Typst, où un `**` ou un « — »
 * s'imprime tel quel.
 *
 * @param {string} s
 * @returns {string}
 */
export function nettoyer(s) {
  return String(s ?? "")
    .replace(/[*_`#\[\]]/g, "")
    .replace(/[—–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TITRE_SKILLS = /^#{1,4}\s*(?:skills|comp[ée]tences)\s*$/i;
const TITRE_QUELCONQUE = /^#{1,4}\s/;

/** La section « Skills » de cv.md, brute. Chaîne vide si le CV n'en a pas. */
function sectionSkills(cvText) {
  const lignes = String(cvText ?? "").split(/\r?\n/);
  const debut = lignes.findIndex((l) => TITRE_SKILLS.test(l.trim()));
  if (debut === -1) return "";
  const out = [];
  for (let i = debut + 1; i < lignes.length; i++) {
    if (TITRE_QUELCONQUE.test(lignes[i])) break;
    out.push(lignes[i]);
  }
  return out.join("\n");
}

/** Découpe sur `,` et `;` mais seulement HORS parenthèses : « MCP (Model Context
 *  Protocol), scraping » ne doit pas se casser à l'intérieur de la parenthèse. */
function decouperHorsParentheses(t) {
  const out = [];
  let tampon = "";
  let profondeur = 0;
  for (const c of t) {
    if (c === "(") profondeur++;
    else if (c === ")") profondeur = Math.max(0, profondeur - 1);
    if ((c === "," || c === ";") && profondeur === 0) {
      out.push(tampon);
      tampon = "";
      continue;
    }
    tampon += c;
  }
  out.push(tampon);
  return out;
}

// « JavaScript / TypeScript », « RAG et bases vectorielles », « Docker & Compose » :
// un seul segment porte plusieurs compétences, dont chacune peut être LE mot-clé
// que l'offre emploie.
const SEPARATEURS = /\s(?:\/|&|et|and|ou|or)\s/i;

/** Une compétence porteuse en soi : sigle (DSN, API, MCP) ou nom technique
 *  contenant un chiffre (n8n, OAuth2). Ces jetons méritent d'être extraits d'une
 *  phrase plus longue — « n8n auto-hébergé » doit pouvoir matcher une offre qui
 *  ne dit que « n8n ». Les mots ordinaires, eux, ne sont jamais isolés : « gestion
 *  de cache » ne doit pas produire « gestion ». Un chiffre seul non plus : « ISO
 *  9001 » ne doit pas produire le mot-clé « 9001 ». */
function estJetonPorteur(mot) {
  const nu = mot.replace(/[^\p{L}\p{N}+.#-]/gu, "");
  if (nu.length < 2 || nu.length > 20) return false;
  if (!/\p{L}/u.test(nu)) return false;
  if (/\d/.test(nu)) return true;
  return nu === nu.toUpperCase() && /\p{Lu}/u.test(nu);
}

/**
 * Le vocabulaire de compétences de cv.md : chaque phrase de la section Skills,
 * plus ses sous-parties utilisables comme mot-clé. C'est l'ensemble des choses
 * VRAIES et nommées — la borne haute de tout ce que cette route peut rendre.
 *
 * @param {string} cvText
 * @returns {string[]}
 */
export function vocabulaireCv(cvText) {
  const vus = new Set();
  const out = [];
  const ajouter = (brut) => {
    // La ponctuation de liste survit aux découpages (« QA, découpage… » vient
    // d'une virgule interne à une parenthèse) et n'a rien à faire dans un mot-clé.
    const p = nettoyer(brut).replace(/^[\s,;:.]+|[\s,;:.]+$/g, "");
    if (!p || p.length < 2) return;
    // Au-delà de 6 mots ce n'est plus un mot-clé, c'est une phrase : aucune offre
    // ne la contiendra à l'identique et un ATS n'en fait rien.
    if (p.split(/\s+/).length > 6) return;
    const cle = normaliser(p);
    if (vus.has(cle)) return;
    vus.add(cle);
    out.push(p);
  };

  for (const ligne of sectionSkills(cvText).split(/\r?\n/)) {
    const puce = /^\s*[-*•]\s*(.+)$/.exec(ligne);
    if (!puce) continue;
    // « **Automatisation & intégration :** n8n, API REST… » : l'intitulé de
    // catégorie est un titre de rubrique, pas une compétence.
    const corps = puce[1].replace(/^\*\*[^*]*\*\*\s*:?\s*/, "").replace(/^[^:*]{1,40}\s*:\s+/, "");

    for (const segment of decouperHorsParentheses(corps)) {
      const t = segment.trim();
      if (!t) continue;
      // « MCP (Model Context Protocol) » vaut « MCP » ET « Model Context Protocol ».
      const parenthese = /^(.*?)\s*\(([^)]+)\)\s*(.*)$/.exec(t);
      const morceaux = parenthese ? [`${parenthese[1]} ${parenthese[3]}`, parenthese[2]] : [t];
      // Le contenu d'une parenthèse peut lui-même être une liste (« badges,
      // habilitations ») : la découpe hors-parenthèses ne l'a pas vu passer.
      for (const morceau of morceaux.flatMap((m) => m.split(","))) {
        ajouter(morceau);
        for (const part of morceau.split(SEPARATEURS)) ajouter(part);
        for (const mot of morceau.split(/\s+/)) if (estJetonPorteur(mot)) ajouter(mot);
      }
    }
  }
  return out;
}

// Un sigle court est ambigu hors casse : « PAS » (prélèvement à la source) est
// aussi la négation française, « SAP » un verbe anglais. Ces jetons-là ne comptent
// que si l'offre les écrit VRAIMENT en capitales — ce qu'elle fait toujours quand
// elle parle de la compétence. Au-delà de 4 caractères, la collision n'existe plus.
const SIGLE_AMBIGU = /^[\p{Lu}\p{N}+.#&/-]{2,4}$/u;

/**
 * Une phrase est-elle présente dans un texte ? Insensible aux accents ; insensible
 * à la casse sauf pour les sigles courts (voir SIGLE_AMBIGU). Bornée aux frontières
 * de mot pour que « Java » ne matche pas « JavaScript » : `(?<!\w)…(?!\w)` plutôt
 * que `\b`, qui échoue aux bords symboliques (C++, .NET) — même technique que
 * skillMentionedInText() dans jd-skill-gap.mjs.
 *
 * @param {string} phrase
 * @param {string} texte
 * @returns {boolean}
 */
export function phrasePresente(phrase, texte) {
  const brut = String(phrase ?? "").trim();
  if (!brut) return false;
  const motif = sansAccents(brut)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\s+/g, "\\s+");
  try {
    const re = new RegExp(`(?<!\\w)${motif}(?!\\w)`, SIGLE_AMBIGU.test(brut) ? "" : "i");
    return re.test(sansAccents(texte));
  } catch {
    return false;
  }
}

/**
 * Source B : les compétences du CV que l'offre mentionne, dans l'ordre où elles
 * apparaissent dans l'offre (les plus mises en avant d'abord).
 *
 * @param {string} cvText
 * @param {string} jdText
 * @returns {string[]}
 */
export function motsClesDepuisCv(cvText, jdText) {
  const cible = normaliser(jdText);
  const trouves = [];
  for (const phrase of vocabulaireCv(cvText)) {
    if (!phrasePresente(phrase, jdText)) continue;
    trouves.push({ phrase, position: cible.indexOf(normaliser(phrase)) });
  }
  trouves.sort((a, b) => a.position - b.position);
  return trouves.map((t) => t.phrase);
}

/**
 * Source A, filtrée : seul le bucket `existing` de jd-skill-gap survit, et
 * seulement s'il correspond bien à une compétence NOMMÉE du CV.
 *
 * Ce second filtre n'est pas redondant. On présente l'offre entière comme un bloc
 * d'exigences (voir jdEnBlocRequis) pour contourner un extracteur anglophone, donc
 * le classifieur ratisse large : sur une offre française il remonte « La »,
 * « Vous », « Notions » — de simples mots capitalisés en début de ligne. Une
 * simple recherche dans la section Skills les laisserait passer (« à la
 * production » contient « la »).
 *
 * Un jeton est donc gardé s'il est SOIT une entrée du vocabulaire (une compétence
 * nommée, ce qui écarte « La » et écarte aussi « Microsoft » seul quand le CV dit
 * « Microsoft Graph »), SOIT un sigle que la section Skills écrit vraiment en
 * capitales (« IA », qui vit dans un intitulé de rubrique et n'est donc pas dans
 * le vocabulaire, mais reste un mot-clé ATS légitime).
 *
 * @param {{existing?: string[]}|null|undefined} classification
 * @param {string} cvText
 * @returns {string[]}
 */
export function motsClesDuClassifieur(classification, cvText) {
  const skills = sectionSkills(cvText);
  if (!skills.trim()) return [];
  const vocabulaire = new Set(vocabulaireCv(cvText).map((p) => normaliser(p)));
  return (classification?.existing ?? [])
    .map((s) => nettoyer(s))
    .filter(
      (s) =>
        s.length >= 2 &&
        (vocabulaire.has(normaliser(s)) || (SIGLE_AMBIGU.test(s) && phrasePresente(s, skills))),
    );
}

/**
 * L'offre, remise en forme pour l'extracteur de jd-skill-gap.mjs : il ne scanne
 * QUE les puces situées sous un en-tête d'exigences anglophone (« Requirements »,
 * « Who you are »…). Une offre française n'en a aucun, donc il rendrait zéro
 * compétence — indiscernable d'« aucun mot-clé pertinent ».
 *
 * Passer toute l'offre en puces sous un en-tête reconnu sur-extrait volontairement.
 * C'est sans danger ici et seulement ici : l'intersection avec la section Skills
 * de cv.md se fait en aval, donc le pire cas est un mot-clé vrai mais peu
 * pertinent, jamais une invention. (Le mode `--summary` du cœur, lui, sert à
 * signaler des `gap` : sur-extraire y serait nuisible, on ne touche pas à ça.)
 *
 * @param {string} jdText
 * @returns {string}
 */
export function jdEnBlocRequis(jdText) {
  const out = ["## Requirements", ""];
  for (const ligne of String(jdText ?? "").split(/\r?\n/)) {
    const t = ligne.replace(/^[\s>#*•-]+/, "").trim();
    if (t) out.push(`- ${t}`);
  }
  return out.join("\n");
}

/** Le plafond de la liste rendue. Un CV ATS avec 40 mots-clés ne cible plus rien ;
 *  au-delà d'une vingtaine, le signal se dilue. */
const PLAFOND_MOTS_CLES = 18;

/**
 * Termes que Lineo refuse de voir sur SES CV, meme quand l'annonce les emploie et
 * meme quand ils sont techniquement vrais.
 *
 * « no-code » : consigne du 2026-08-11, « moi je fais du low code et du vibe code ».
 * Le terme est arrive dans le CV Nutripure par cette voie, depuis l'annonce, et il
 * s'est retrouve dans les mots-cles ATS ET dans le resume.
 *
 * ⚠️ Le meme terme reste VOLONTAIREMENT dans `modes/_profile.md`, qui sert a
 * CHERCHER des offres : c'est ainsi qu'il les trouve. Ne pas confondre les deux
 * usages, et ne pas « harmoniser » les deux fichiers.
 */
export const TERMES_BANNIS = ["no-code", "nocode", "no code"];

/**
 * Vrai si le terme est banni des CV, quelle que soit la casse ou la ponctuation.
 *
 * @param {string} mot
 * @returns {boolean}
 */
export function termeBanni(mot) {
  const n = normaliser(String(mot ?? "")).replace(/[^a-z0-9]+/g, " ").trim();
  return TERMES_BANNIS.some((banni) => {
    const b = normaliser(banni).replace(/[^a-z0-9]+/g, " ").trim();
    return n === b || n.split(" ").join("") === b.split(" ").join("");
  });
}

/**
 * Les mots-clés du contrat : union des deux sources, dédoublonnée sans tenir
 * compte de la casse ni des accents, plafonnée.
 *
 * Ordre : le classifieur du cœur d'abord (il rend l'orthographe de l'offre, celle
 * que l'ATS cherche), puis les compétences du CV dans l'ordre de l'offre.
 *
 * ⚠️ Ce bloc JSDoc porte le TYPE de la fonction : `web/` est typecheck en
 * `checkJs`, donc rien ne doit s'intercaler entre lui et la signature. Le
 * 2026-08-11, TERMES_BANNIS insere ici a fait perdre son type a `classification`,
 * qui a ete infere `null | undefined` depuis sa valeur par defaut, et le build de
 * production a casse sur l'appel de `src/app/api/tailor/route.ts`.
 *
 * @param {{cvText: string, jdText: string, classification?: {existing?: string[]}|null}} arg
 * @returns {string[]}
 */
export function motsClesVrais({ cvText, jdText, classification = null }) {
  const vus = new Set();
  const out = [];
  for (const brut of [...motsClesDuClassifieur(classification, cvText), ...motsClesDepuisCv(cvText, jdText)]) {
    const mot = nettoyer(brut);
    if (!mot) continue;
    if (termeBanni(mot)) continue;
    const cle = normaliser(mot);
    if (vus.has(cle)) continue;
    vus.add(cle);

    // On ne garde que la formulation la PLUS LONGUE d'un même mot-clé : sinon
    // « API », « REST » et « API REST » mangeraient trois places sur dix-huit.
    // Le test va dans les deux sens parce que les deux sources n'arrivent pas
    // dans le même ordre — le classifieur rend les jetons un par un, le
    // vocabulaire du CV rend les expressions entières.
    if (out.some((deja) => phrasePresente(mot, deja))) continue;
    const couverts = out.map((deja, i) => (phrasePresente(deja, mot) ? i : -1)).filter((i) => i >= 0);
    if (couverts.length) {
      out[couverts[0]] = mot;
      for (const i of couverts.slice(1).reverse()) out.splice(i, 1);
      continue;
    }

    out.push(mot);
    if (out.length >= PLAFOND_MOTS_CLES) break;
  }
  return out;
}

// --- Intitulé -------------------------------------------------------------

// Mots qui ne discriminent rien dans un intitulé de poste : articles,
// prépositions, et l'habillage d'annonce (H/F, CDI, alternance…).
const MOTS_VIDES = new Set([
  "en", "de", "du", "des", "la", "le", "les", "et", "ou", "au", "aux", "sur", "dans", "chez", "pour",
  "and", "or", "of", "the", "a", "an", "for", "with", "in",
  "hf", "fh", "mf", "cdi", "cdd", "vie", "stage", "alternance", "alternant", "apprentissage",
  "freelance", "interim", "temps", "plein", "partiel", "remote", "teletravail", "hybride",
  "junior", "senior", "confirme", "expert", "debutant", "lead", "poste", "offre", "emploi", "job",
]);

function jetonsIntitule(s) {
  return normaliser(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !MOTS_VIDES.has(t));
}

const RANG_FIT = { primary: 0, secondary: 1, adjacent: 2 };

/**
 * Les intitulés que config/profile.yml déclare comme vrais pour ce candidat :
 * `target_roles.primary` puis les archétypes, rangés par `fit`. C'est la seule
 * source autorisée pour `titre` — recopier l'intitulé de l'annonce reviendrait à
 * affirmer un poste que Linéo n'a pas occupé.
 *
 * @param {unknown} profil  config/profile.yml désérialisé
 * @returns {{nom: string, rang: number}[]}
 */
export function titresCibles(profil) {
  const cibles =
    profil && typeof profil === "object" ? /** @type {Record<string, any>} */ (profil).target_roles : null;
  if (!cibles || typeof cibles !== "object") return [];
  const out = [];
  const vus = new Set();
  const ajouter = (nom, rang) => {
    const propre = nettoyer(nom);
    if (!propre) return;
    const cle = normaliser(propre);
    if (vus.has(cle)) return;
    vus.add(cle);
    out.push({ nom: propre, rang });
  };
  for (const nom of Array.isArray(cibles.primary) ? cibles.primary : []) ajouter(nom, 0);
  for (const a of Array.isArray(cibles.archetypes) ? cibles.archetypes : []) {
    if (a && typeof a === "object") ajouter(a.name, RANG_FIT[String(a.fit ?? "")] ?? 3);
  }
  return out.sort((a, b) => a.rang - b.rang);
}

/**
 * L'intitulé déclaré le plus proche de celui de l'annonce, ou `undefined` si
 * aucun ne colle. `undefined` est un résultat normal, pas une panne : le CV garde
 * alors son intitulé par défaut. On exige deux jetons communs (un seul suffit
 * pour un intitulé mono-mot) — « Engineer » partagé ne fait pas une
 * correspondance.
 *
 * @param {string} jobTitle
 * @param {{nom: string, rang: number}[]} cibles
 * @returns {string|undefined}
 */
export function titreVrai(jobTitle, cibles) {
  const attendus = new Set(jetonsIntitule(jobTitle));
  if (!attendus.size) return undefined;

  const candidats = [];
  for (const { nom, rang } of cibles ?? []) {
    const jetons = jetonsIntitule(nom);
    if (!jetons.length) continue;
    const communs = jetons.filter((t) => attendus.has(t)).length;
    if (communs < (jetons.length === 1 ? 1 : 2)) continue;
    candidats.push({ nom, rang, communs, couverture: communs / jetons.length });
  }
  if (!candidats.length) return undefined;

  // Couverture décroissante, puis fit déclaré, puis nombre de jetons communs :
  // à égalité de couverture, l'intitulé « primary » gagne.
  candidats.sort((a, b) => b.couverture - a.couverture || a.rang - b.rang || b.communs - a.communs);
  return candidats[0].nom;
}
