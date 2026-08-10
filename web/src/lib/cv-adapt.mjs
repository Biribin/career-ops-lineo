/**
 * cv-adapt.mjs — le skill « adapter le CV YAML à une offre », partie pure.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Jusqu'ici, l'adaptation du CV vivait dans un prompt d'agent LangChain écrit
 * DANS n8n (workflow K3i1VbzSLuJYJLBM, nœud « 🧠 Agent: Adapt CV YAML »). Ce
 * prompt était la seule copie de règles durcies au fil de vrais incidents, il
 * n'était couvert par aucun test, et personne ne pouvait le rejouer hors de n8n.
 *
 * La consigne de Linéo : la génération appartient à career-ops, pas à n8n. Donc
 * les règles vivent ici, testées, et l'exécution passe par `/api/run` — qui
 * lance le VRAI agent avec accès à `modes/pdf.md`, `cv.md` et
 * `config/profile.yml`. n8n ne fait plus qu'un appel HTTP.
 *
 * CE QUE CE MODULE GARANTIT (déterministe, après le modèle)
 * ---------------------------------------------------------
 * Un prompt se contourne, une vérification non. Les cinq contrôles ci-dessous
 * viennent d'incidents RÉELS, documentés dans docs/WF2-WF3-a-cabler.md :
 *   1. clé de premier niveau supprimée (`keywords` effacée → section ATS
 *      « Compétences clés » absente du PDF) ;
 *   2. dates réécrites (« depuis deux ans » alors que le poste a commencé en
 *      mars 2026) ;
 *   3. tiret cadratin / markdown, interdits dans tout document candidat ;
 *   4. CV tronqué ou gonflé, qui casse le rendu une page ;
 *   5. CV qui déborde sur une deuxième page (2026-08-10, première candidature
 *      réelle : l'agent n'avait retouché que `keywords`, le rendu faisait deux
 *      pages, l'Action GitHub 31392068671 a bloqué la candidature).
 *
 * Ce module ne parse PAS le YAML : il travaille ligne à ligne, exactement comme
 * le garde-fou déjà éprouvé côté n8n (« Build Updated YML File »). Ajouter un
 * parseur ici créerait une seconde vérité sur ce qu'est un CV valide, alors que
 * le seul juge qui compte est `tools/build_letter.py` / le rendu Typst.
 */

import path from "node:path";

/**
 * Au-delà, `tools/build_letter.py` et le rendu une page cassent.
 *
 * `RATIO_MIN` reste à 0.5 malgré le mandat de coupe ajouté le 2026-08-10 : le
 * pire cas mesuré (commentaires retirés ET budget atteint sur `locales/fr.yml`)
 * donne 0.59, donc le garde-fou anti-troncature survit sans être affaibli. Ne le
 * baisse pas « au cas où » : il vient d'un incident réel.
 */
export const RATIO_MIN = 0.5;
export const RATIO_MAX = 1.5;

/**
 * Budget de contenu rendu du CV de candidature, en caractères.
 *
 * POURQUOI CE BUDGET VIT ICI. Le CV de base (`main` du repo `cv`) est un
 * RÉSERVOIR volontairement exhaustif — décision de Linéo, 2026-08-10 — et rend
 * deux pages. L'Action du repo `cv` ne vérifie la pagination que sur les
 * branches `cv/*`. Tenir sur une page est donc la responsabilité de CE skill :
 * c'est ici qu'on choisit ce qui part chez un recruteur. Le CV de base ne doit
 * PAS être dégraissé pour arranger le rendu.
 *
 * LE CHIFFRE EST MESURÉ, PAS DEVINÉ. Sur le gabarit Typst du repo `cv`, au
 * 2026-08-10 :
 *   - `dist/pdf/cv-fr-ats.pdf` — le seul PDF que n8n télécharge et envoie
 *     (workflow 2, `Config.githubPdfPath`) — portait 5 895 caractères rendus sur
 *     sa page 1 avant de déborder ;
 *   - `carRendus` sous-estime le rendu réel d'environ 1,5 % : le gabarit ajoute
 *     ses propres intitulés de section, que le YAML ne contient pas.
 * 5 500 laisse ~7 % de marge, et cette marge compte : un retour à la ligne se
 * joue au mot près, pas au caractère près.
 */
export const BUDGET_CAR_RENDUS = 5500;

/**
 * Estime les caractères RENDUS d'un CV YAML : la somme des valeurs qui
 * s'impriment. Les noms de clés, l'indentation, les lignes de commentaire et les
 * marqueurs de bloc ne partent pas chez le recruteur, donc ils ne comptent pas.
 *
 * Comme le reste du module, sans parseur YAML, et pour la même raison : un
 * second avis sur ce qu'est un CV valide serait une seconde vérité.
 *
 * Vérifié contre pypdf sur les quatre variantes rendues du 2026-08-10 : écart
 * maximal de 1,6 %, toujours par défaut (jamais optimiste).
 *
 * @param {string} yamlText
 * @returns {number}
 */
export function carRendus(yamlText) {
  let n = 0;
  for (const ligne of String(yamlText ?? "").split(/\r?\n/)) {
    const s = ligne.trim();
    if (!s || s.startsWith("#")) continue;
    let v = s;
    const m = s.match(/^(?:-\s+)?[A-Za-z_][A-Za-z0-9_-]*\s*:\s*(.*)$/);
    if (m) v = m[1];
    else if (s.startsWith("- ")) v = s.slice(2);
    v = v.trim();
    // Marqueurs de bloc seuls sur leur ligne : ils n'impriment rien.
    if (v === "" || v === ">-" || v === ">" || v === "|" || v === "|-") continue;
    v = v.replace(/^["']|["']$/g, "");
    n += v.length + 1; // +1 : l'espace ou le saut de ligne qui suit, au rendu
  }
  return n;
}

/**
 * Nettoyage déterministe de ce que rend le modèle.
 *
 * Volontairement CONSERVATEUR : on ne touche ni à l'indentation, ni aux
 * marqueurs de bloc (`>-`, `|`), ni aux commentaires. Tout le reste du fichier
 * est la mise en page du CV, et la réécrire serait pire que le défaut corrigé.
 *
 * @param {string} brut
 * @returns {string}
 */
export function nettoieYamlAdapte(brut) {
  let t = String(brut ?? "");

  // Le modèle encadre volontiers sa réponse d'une clôture markdown.
  t = t.replace(/^\s*```(?:ya?ml)?\s*\n/i, "").replace(/\n```\s*$/i, "");

  return (
    t
      // markdown : gras et liens. Les astérisques d'un scalaire YAML plain sont
      // de toute façon interdits par la spec (indicateur d'alias), donc rien de
      // légitime n'est perdu ici.
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/\[([^\]\n]+)\]\((?:[^)\n]+)\)/g, "$1")
      // tirets cadratin et demi-cadratin : jamais dans un document candidat
      .replace(/\s+[—–]\s+/g, ", ")
      .replace(/[—–]/g, ", ")
      // fins de ligne Windows éventuelles : le repo cv est en LF (.gitattributes)
      .replace(/\r\n/g, "\n")
      .trimEnd() + "\n"
  );
}

/**
 * Les clés de premier niveau, dans l'ordre du fichier. Sans parseur : une clé de
 * premier niveau est une ligne non indentée `nom:`.
 *
 * @param {string} yamlText
 * @returns {string[]}
 */
export function clesTopNiveau(yamlText) {
  const out = [];
  for (const ligne of String(yamlText ?? "").split(/\r?\n/)) {
    const m = ligne.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:/);
    if (m && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Toutes les valeurs `period:` du fichier, dans l'ordre. C'est le champ le plus
 * dangereux du CV : une date réécrite est un mensonge sur un document candidat.
 *
 * @param {string} yamlText
 * @returns {string[]}
 */
export function periodes(yamlText) {
  const out = [];
  for (const ligne of String(yamlText ?? "").split(/\r?\n/)) {
    const m = ligne.match(/^\s*(?:-\s+)?period\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out.push(v);
  }
  return out;
}

const RE_DUREE_ANNEES = /\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|\d+)\s+ans?\b/gi;

/** Le texte cite-t-il une durée en années ? Dit seulement « il y en a », pas « c'est faux ». */
export function dureeInventee(s) {
  return dureesAnnees(s).length > 0;
}

/**
 * Toutes les durées en années citées par un texte, normalisées en minuscules.
 *
 * POURQUOI CE N'EST PAS UN SIMPLE BOOLÉEN. La règle d'origine était « une durée
 * en années est toujours une invention ». Elle est fausse, et elle a coûté une
 * candidature le 2026-08-10 : `locales/fr.yml` contient « Deux élèves de
 * terminale accompagnés pendant un an », qui est vrai et déjà dans le CV de base.
 * Tout CV adapté conservant cette puce était donc refusé, sans que l'agent puisse
 * le deviner — puis n8n retombait en silence sur le réservoir de deux pages.
 *
 * Ce qu'il faut attraper, c'est une ancienneté INTRODUITE (« depuis deux ans »
 * alors que le poste a commencé en mars 2026), pas une durée que le candidat
 * énonçait déjà. D'où la comparaison avec l'original dans `verifieCvAdapte`.
 *
 * @param {string} s
 * @returns {string[]}
 */
export function dureesAnnees(s) {
  return (String(s ?? "").match(RE_DUREE_ANNEES) ?? []).map((d) => d.toLowerCase().replace(/\s+/g, " "));
}

/** Combien de fois chaque durée apparaît. Un comptage, pas un ensemble : dupliquer « un an » ailleurs est aussi une invention. */
function comptes(liste) {
  const m = new Map();
  for (const d of liste) m.set(d, (m.get(d) ?? 0) + 1);
  return m;
}

/**
 * Vérifie et nettoie le YAML rendu par l'agent.
 *
 * Rend un verdict au lieu de jeter : l'appelant (la route `/api/run`) doit
 * pouvoir transformer un refus en message lisible dans le flux NDJSON, et n8n
 * doit pouvoir décider de retomber sur le CV d'origine plutôt que de casser la
 * chaîne. Un CV non adapté mais VRAI vaut mieux qu'un CV adapté et faux.
 *
 * @param {{original: string, adapte: string}} args
 * @returns {{ok: true, adaptedYaml: string, avertissements: string[]}
 *         | {ok: false, motif: string}}
 */
export function verifieCvAdapte({ original, adapte }) {
  const src = String(original ?? "");
  const yamlText = nettoieYamlAdapte(adapte);

  if (!yamlText.trim()) return { ok: false, motif: "le CV adapté est vide" };

  // 1 — aucune clé de premier niveau perdue.
  const attendues = clesTopNiveau(src);
  const rendues = new Set(clesTopNiveau(yamlText));
  const perdues = attendues.filter((k) => !rendues.has(k));
  if (perdues.length) {
    return {
      ok: false,
      motif: `clé(s) de premier niveau supprimée(s) : ${perdues.join(", ")} — le rendu du CV casserait`,
    };
  }

  // 2 — dates intactes, à l'identique et dans le même ordre.
  const avant = periodes(src);
  const apres = periodes(yamlText);
  if (avant.join("|") !== apres.join("|")) {
    return {
      ok: false,
      motif: `les dates ont été modifiées : ${JSON.stringify(avant)} devient ${JSON.stringify(apres)}`,
    };
  }

  // 3 — aucune ancienneté INTRODUITE n'a survécu au nettoyage. Différentiel, et
  // non booléen : une durée déjà présente dans le CV de base est vraie, la
  // conserver n'est pas un mensonge. Voir `dureesAnnees` pour l'incident.
  const dureesAvant = comptes(dureesAnnees(src));
  const introduites = [];
  for (const [d, n] of comptes(dureesAnnees(yamlText))) {
    if (n > (dureesAvant.get(d) ?? 0)) introduites.push(d);
  }
  if (introduites.length) {
    return {
      ok: false,
      motif: `une ancienneté chiffrée en années a été introduite dans le CV : ${introduites.join(", ")}`,
    };
  }

  // 4 — volume : un CV deux fois plus court est un CV tronqué, deux fois plus
  // long ne tient plus sur une page.
  const ratio = src.length > 0 ? yamlText.length / src.length : 1;
  if (ratio < RATIO_MIN || ratio > RATIO_MAX) {
    return {
      ok: false,
      motif: `volume anormal : ${yamlText.length} caractères contre ${src.length} à l'origine (ratio ${ratio.toFixed(2)})`,
    };
  }

  // 5 — tenue sur une page. Bloquant, et volontairement AVANT le commit GitHub :
  // un CV de deux pages ne peut pas aboutir de toute façon, l'Action du repo `cv`
  // le rejette. Échouer ici fait gagner le rendu (environ cinq minutes) et rend
  // un motif exploitable au lieu d'un log d'Action à déchiffrer.
  const rendus = carRendus(yamlText);
  if (rendus > BUDGET_CAR_RENDUS) {
    return {
      ok: false,
      motif:
        `le CV adapté ne tient pas sur une page : ${rendus} caractères rendus contre ` +
        `${BUDGET_CAR_RENDUS} au budget, soit ${rendus - BUDGET_CAR_RENDUS} à retirer. ` +
        `L'agent doit SÉLECTIONNER (projets redondants, puces hors sujet, formations et extras ` +
        `sans rapport avec l'offre), pas seulement reformuler`,
    };
  }

  // Non bloquant mais remonté : ce sont les signes d'un modèle qui a peu travaillé.
  const avertissements = [];
  if (yamlText.trim() === src.trim()) avertissements.push("le CV rendu est identique à l'original : aucune adaptation");
  return { ok: true, adaptedYaml: yamlText, avertissements };
}

/**
 * Chemins de travail d'un run « cv-yaml ». L'agent n'invente jamais un nom de
 * fichier : le backend les impose, comme pour le mode pdf (`resolvePdfPaths`).
 *
 * `cle` est fourni par n8n. Le garde-fou anti-traversée est le même que celui de
 * `resolvePdfPaths` et pour la même raison : la clé est concaténée dans un nom
 * de fichier, et `path.join` honorerait des segments `..`.
 *
 * @param {string} cle
 * @param {string} root - careerOpsRoot()
 * @returns {{ok: true, chemins: {dir: string, original: string, contexte: string, sortie: string}}
 *         | {ok: false, error: string}}
 */
export function cheminsCvYaml(cle, root) {
  const propre = String(cle ?? "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(propre)) {
    return { ok: false, error: `clé de run invalide : « ${propre} » (attendu : [a-zA-Z0-9._-], 80 caractères maxi)` };
  }
  const dir = path.join(root, ".career-ops-web", "cv-yaml-tmp");
  return {
    ok: true,
    chemins: {
      dir,
      original: path.join(dir, `${propre}.original.yml`),
      contexte: path.join(dir, `${propre}.contexte.json`),
      sortie: path.join(dir, `${propre}.adapte.yml`),
    },
  };
}

/**
 * Le contexte que l'agent lira. Aucun secret, aucun jeton : uniquement l'offre
 * et les mots-clés ATS déjà vérifiés par `/api/tailor`.
 *
 * @param {{offre?: Record<string, unknown>, motsCles?: unknown[], consigne?: string}} args
 */
export function contexteCvYaml({ offre = {}, motsCles = [], consigne = "" }) {
  return {
    offre: {
      titre: String(offre.title ?? offre.titre ?? ""),
      entreprise: String(offre.company ?? offre.entreprise ?? ""),
      url: String(offre.url ?? ""),
      pourquoi_ca_matche: String(offre.whyMatch ?? offre.pourquoi_ca_matche ?? ""),
      description: String(offre.description ?? "").slice(0, 8000),
    },
    // Vides = l'agent applique la règle ATS de modes/pdf.md. Non vides = ils font
    // loi : /api/tailor a déjà prouvé que chacun est VRAI pour le candidat.
    mots_cles_ats_imposes: (Array.isArray(motsCles) ? motsCles : [])
      .map((k) => String(k ?? "").trim())
      .filter(Boolean)
      .slice(0, 12),
    consigne_de_retouche: String(consigne ?? "").slice(0, 600),
  };
}

/**
 * L'instruction donnée à l'agent.
 *
 * Elle l'envoie lire `modes/pdf.md` : c'est LE mode career-ops du tailoring de
 * CV, et c'est tout l'intérêt de passer par `/api/run` plutôt que par un prompt
 * autonome. Les règles listées ensuite ne le remplacent pas, elles portent ce
 * que `modes/pdf.md` ne peut pas savoir : les contraintes du gabarit YAML du
 * repo `cv` et les défauts déjà constatés en production.
 *
 * Le bloc SELECTION a été ajouté le 2026-08-10. Avant lui, la consigne disait
 * « longueurs équivalentes, plus ou moins 15 pour cent par champ modifié » — elle
 * interdisait donc exactement ce qu'il fallait faire. À la première candidature
 * réelle, l'agent a respecté la consigne à la lettre : il a rempli `keywords` et
 * n'a rien retiré, le CV a rendu deux pages, l'Action a bloqué l'envoi. Le
 * budget est répété ici ET vérifié dans `verifieCvAdapte` : le prompt oriente,
 * la vérification tranche.
 *
 * @param {{chemins: {original: string, contexte: string, sortie: string}}} args
 * @returns {string}
 */
export function promptCvYaml({ chemins }) {
  return `Tu adaptes le CV YAML du candidat a UNE offre precise, headless, sur sa machine. Applique le tailoring REEL de career-ops : lis modes/pdf.md et suis sa doctrine (injecter le vocabulaire de l'annonce dans le titre et les premieres puces, reordonner par pertinence, ne JAMAIS inventer de competence). N'improvise pas une methode a toi.

1. Lis, dans cet ordre : modes/pdf.md, cv.md, config/profile.yml. Ils disent qui est le candidat et comment career-ops adapte un CV.
2. Lis le contexte de l'offre : ${chemins.contexte}
3. Lis le CV a adapter : ${chemins.original}
4. Ecris le CV adapte, et RIEN d'autre, a EXACTEMENT ce chemin : ${chemins.sortie}

Le fichier de sortie doit etre du YAML pur, sans cloture markdown, sans commentaire d'explication de ta part.

CONTRAINTES DE GABARIT (le rendu Typst du repo cv casse si elles sautent) :
- NE SUPPRIME AUCUNE CLE presente dans le CV d'origine, keywords comprise. Une cle manquante retire une section entiere du PDF. Attention : cela t'interdit de supprimer une CLE, pas de retirer des ELEMENTS dans une liste. Retirer des elements est justement ton travail (voir SELECTION), il faut seulement qu'il en reste au moins un par cle.
- Garde la hierarchie, l'ordre des cles et l'indentation d'origine.
- CONSERVE LE STYLE DE BLOC : une valeur ecrite avec un bloc replie (le marqueur superieur suivi d'un tiret) doit le rester. Ne remets jamais un texte long sur une seule ligne apres les deux-points.
- Si tu ecris malgre tout une valeur sur une ligne et qu'elle contient des deux-points suivis d'une espace, entoure-la de guillemets doubles. Sinon le fichier devient illisible et l'Action GitHub echoue sans produire de PDF.
- highlights : une LISTE DE CHAINES simples. Jamais un objet, jamais un dictionnaire, jamais de sous-cle. Pour un intitule, ecris tout dans la meme chaine.

SELECTION (c'est le coeur du travail, pas un reglage de finition) :
- Le CV d'origine est un RESERVOIR volontairement exhaustif : il porte tout ce qui est vrai du candidat, et il rend DEUX pages. Le CV que tu ecris part chez un recruteur : il tient sur UNE page. Tu dois donc RETIRER, pas seulement reformuler. Un CV rendu a longueur equivalente est un echec.
- BUDGET DUR : ${BUDGET_CAR_RENDUS} caracteres de contenu rendu au maximum. Compte la somme des VALEURS, celles qui s'impriment. Ne comptent pas : les noms de cles, l'indentation, les lignes de commentaire, les marqueurs de bloc. Le CV d'origine est tres au-dessus du budget : prevois de retirer de l'ordre d'un tiers.
- Ce budget est verifie automatiquement apres toi. Au-dessus, ton travail est annule et la candidature s'arrete : personne ne recoit rien.
- Ordre dans lequel couper, du plus evident au moins evident :
  1. les entrees projects qui redisent deja une puce d'experience. Garde celles qui apportent une preuve publique verifiable ou un domaine absent ailleurs ;
  2. les puces d'experience etrangeres a l'offre, et les puces voisines que tu peux fusionner en une seule sans rien perdre de vrai ;
  3. les formations et les extras sans rapport avec cette offre ;
  4. les groupes de skills que l'annonce ne demande pas.
- Ce qui est le plus proche de l'offre reste, et remonte en premier. Ce qui n'a aucun rapport part. C'est un choix editorial : assume-le au lieu de tout garder en raccourcissant chaque ligne.
- Chaque cle de premier niveau garde AU MOINS un element. Une liste videe retire une section entiere du PDF.
- Avant d'ecrire le fichier, compte ton budget. Si tu depasses, coupe encore.

CONTRAINTES DE VERACITE (verifiees automatiquement apres toi, un manquement annule ton travail) :
- NE MODIFIE JAMAIS un champ period. Aucune date, nulle part.
- N'invente aucune anciennete. N'ecris jamais une duree en annees.
- N'invente ni competence, ni technologie, ni client, ni chiffre absent du CV d'origine ou de cv.md. Tu REFORMULES du vrai avec le vocabulaire de l'annonce, tu n'ajoutes rien.
- INTERDIT partout : le tiret cadratin, le tiret demi-cadratin, le markdown, les balises HTML.
- mots_cles_ats_imposes du contexte : s'ils sont fournis, recopie EXACTEMENT cette liste dans keywords, sans en ajouter, retirer, reformuler ni traduire. career-ops a deja verifie qu'ils sont vrais. Sinon, applique la regle ATS de modes/pdf.md et ne mets jamais keywords a null : au pire, laisse la liste vide.

Ne rends aucun autre fichier, ne lance aucune commande, ne contacte personne.

Termine par EXACTEMENT une derniere ligne : VERDICT: {5 si le CV adapte a ete ecrit, sinon 1}/5 — {ce que tu as change, 12 mots maximum}`;
}
