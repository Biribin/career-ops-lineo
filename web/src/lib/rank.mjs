// Tri des offres France Travail par le LLM local. Partie pure et testable.
//
// POURQUOI CÔTÉ CAREER-OPS ET PAS DANS n8n
// ----------------------------------------
// Vérifié le 2026-08-06 :
//   - un agent LangChain n8n exige un sous-nœud sur le port ai_languageModel,
//     qu'un CLI ne peut pas fournir (c'est un nœud main) ;
//   - le sous-nœud « OpenAI Chat Model » ignore `options.baseURL` sur cette
//     instance (prouvé en pointant un port fermé : erreur identique, aucune
//     erreur réseau) — donc impossible de le détourner vers un shim local ;
//   - `claude-run` DANS le conteneur n8n est plafonné (429, limite hebdo),
//     alors que le CLI du conteneur career-ops répond normalement : les deux
//     chemins n'ont pas le même compte.
// Conclusion : n8n orchestre, career-ops porte le LLM, et le contrat entre les
// deux est du HTTP JSON.
//
// LE PIÈGE PRINCIPAL ICI, C'EST LA TAILLE DU PROMPT
// -------------------------------------------------
// France Travail renvoie jusqu'à 150 offres par requête, et une description fait
// couramment 3 000 à 6 000 caractères. Douze requêtes brutes, c'est un prompt de
// plusieurs mégaoctets : le CLI refuse, ou tronque au milieu d'une offre et
// « oublie » silencieusement la moitié du lot. On borne donc explicitement, et on
// DIT ce qu'on a écarté.

/**
 * Le nombre d'offres soumises au modèle en un seul appel.
 *
 * Porté de 60 à 150 le 2026-08-10, sur mesure de la tournée réelle : 941 offres
 * brutes, 659 uniques et neuves, dont 60 seulement atteignaient le tri. Les 599
 * autres étaient écartées par ce plafond, sans qu'aucun critère de pertinence
 * n'intervienne — Linéo recevait donc les premières arrivées, pas les meilleures.
 *
 * Mesuré, pas estimé : 150 offres à MAX_DESCRIPTION près font un prompt de
 * ~148 000 caractères (~37 k tokens), contre ~63 000 à 60 offres. Le CLI est
 * coupé à 280 s, le nœud n8n à 290 s et la route à 300 s : si un appel à 150
 * dépasse ce budget, c'est ce plafond qu'il faut redescendre, pas le timeout.
 *
 * Ce que ce plafond NE règle pas : il tronque dans l'ordre d'arrivée, donc dans
 * l'ordre des requêtes. Ce sont les premiers mots-clés de `france_travail` qui
 * remplissent les 150 places — d'où l'importance de les ranger du plus ciblé au
 * plus large. Le reste n'est pas perdu pour autant : le filtre `dejaVus` écarte
 * à la tournée suivante ce qui a déjà été vu, et la tranche suivante remonte.
 */
export const MAX_OFFRES = 150;
/** Assez pour juger la pertinence, sans recopier l'annonce entière. */
export const MAX_DESCRIPTION = 700;

/**
 * En dessous, une offre n'arrive pas dans la file de Linéo.
 *
 * Décision du 2026-08-10 : « s'il n'y a pas de bonne offre, pas obligé d'aller
 * jusqu'à 60 ». Le plafond de retenues est un PLAFOND, pas un quota à remplir.
 *
 * 40 est mesuré, pas choisi au hasard. Sur les 110 offres en file ce jour-là :
 *
 *   plancher 30 -> 78 gardées : laisse passer « Formateur IA », « Ingénieur
 *                  support IA », « Expert IA » — hors profil
 *   plancher 40 -> 45 gardées : le premier niveau où ce qui reste est du métier
 *   plancher 50 -> 22 gardées : jette tous les « Chef de projet IA », trop dur
 *
 * Réglable par la requête (`scoreMin` dans le corps POST, donc par le nœud
 * « ⚙️ Config » de n8n) : ajuster le seuil ne doit pas demander un déploiement.
 */
export const SCORE_MINIMUM = 40;

const txt = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/**
 * Minuscules sans accents, pour comparer un mot-clé à un intitulé.
 * « Ingénieur IA » et « ingenieur ia » doivent se reconnaître : France Travail
 * publie les deux orthographes, et portals.yml aussi.
 */
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** France Travail renvoie parfois le lieu comme objet ; on veut une chaîne lisible. */
export function lieuLisible(brut) {
  if (typeof brut === "string") return brut.trim();
  if (brut && typeof brut === "object") {
    const o = brut;
    return (
      txt(o.libelle) ||
      txt(o.nom) ||
      txt(o.ville) ||
      txt(o.label) ||
      Object.values(o)
        .filter((v) => typeof v === "string" && v.trim())
        .join(", ")
    );
  }
  return "";
}

/**
 * Normalise une offre France Travail brute en la forme minimale utile au tri.
 * Tout champ absent devient une chaîne vide plutôt qu'un undefined : le prompt
 * ne doit jamais contenir le mot « undefined », que le modèle interpréterait
 * comme une information.
 */
export function normaliseOffre(o) {
  const src = o ?? {};
  return {
    jobId: txt(src.id || src.jobId),
    title: txt(src.intitule || src.title),
    company: txt(src.entreprise?.nom || src.entreprise?.description || src.company),
    location: lieuLisible(src.lieuTravail || src.location),
    contract: txt(src.typeContratLibelle || src.typeContrat || src.contract),
    url: txt(src.origineOffre?.urlOrigine || src.url),
    date: txt(src.dateCreation || src.date),
    description: txt(src.description).slice(0, MAX_DESCRIPTION),
    // L'adresse publiee avec l'annonce (`contact.courriel` chez France Travail).
    // Elle sert de destinataire a la candidature : sans elle, le mail part a une
    // adresse devinee alors que l'employeur a dit ou ecrire.
    //
    // Volontairement ABSENTE du prompt (voir construitPrompt, qui enumere ses
    // champs un par un) : le modele n'a aucune raison de lire une adresse
    // personnelle pour juger de la pertinence d'une offre.
    contactEmail: txt(src.contact?.courriel || src.contactEmail),
  };
}

/** Une offre d'alternance, de stage ou d'apprentissage. */
export function estAlternance(brut, titre = "") {
  if (brut && typeof brut === "object" && brut.alternance === true) return true;
  return /\b(alternance|alternant|apprentissage|apprenti|stage|stagiaire)\b/i.test(norm(titre));
}

/**
 * À quel point une offre ressemble à ce que Linéo CHERCHE.
 *
 * Ce n'est PAS le score d'adéquation — celui-là mesure le profil contre l'offre
 * et reste le travail du modèle. Ici on ne fait que décider, parmi des milliers
 * d'offres, lesquelles méritent d'occuper une des places du lot.
 *
 * Le titre pèse quatre fois la description, et c'est mesuré : sur la tournée du
 * 2026-08-10 (1 161 offres distinctes), 547 avaient un mot-clé dans le titre, et
 * ce sont elles qui sont réellement du métier. Une offre qui ne mentionne un
 * mot-clé qu'au fil de sa description est le plus souvent hors sujet — un
 * « Conducteur de ligne » dont l'annonce cite l'automatisation de l'atelier.
 *
 * @param {{title?: string, description?: string}} offre
 * @param {string[]} motsCles  mots-clés normalisés (voir clesNormalisees)
 */
export function scorePertinence(offre, motsCles = []) {
  if (motsCles.length === 0) return 0;
  const titre = norm(offre?.title);
  const desc = norm(offre?.description);
  let score = 0;
  if (motsCles.some((c) => titre.includes(c))) score += 4;
  if (motsCles.some((c) => desc.includes(c))) score += 1;
  return score;
}

/** Normalise et dédoublonne une liste de mots-clés pour la comparaison. */
export function clesNormalisees(...listes) {
  const vus = new Set();
  for (const liste of listes) {
    for (const mot of Array.isArray(liste) ? liste : []) {
      const cle = norm(mot);
      if (cle) vus.add(cle);
    }
  }
  return [...vus];
}

/**
 * Déduplique, CLASSE, puis borne le lot d'offres.
 *
 * La déduplication est faite AVANT le plafond : sinon 60 places pourraient être
 * mangées par la même offre remontée par plusieurs requêtes de mots-clés
 * différents, ce qui est le cas courant (« n8n » et « automatisation » ramènent
 * largement les mêmes annonces).
 *
 * LE CLASSEMENT EST CE QUI REND LE PLAFOND ACCEPTABLE
 * ---------------------------------------------------
 * Jusqu'ici la troncature se faisait dans l'ORDRE D'ARRIVÉE, donc dans l'ordre
 * des requêtes. Mesuré sur la tournée du 2026-08-10, en France entière :
 *
 *   1 769 offres brutes -> 1 161 distinctes -> 150 au modèle
 *   et ces 150 venaient d'UN SEUL mot-clé sur 33 (« automatisation »).
 *
 * `data engineer`, `python`, `ingénieur intégration`, `architecte solutions` —
 * 400 offres à eux quatre — n'atteignaient jamais le tri. Le plafond ne gardait
 * pas les meilleures offres, il gardait les premières arrivées.
 *
 * On classe donc par pertinence avant de couper. Le tri est STABLE : à score
 * égal l'ordre d'arrivée est conservé, ce qui préserve la priorité des mots-clés
 * que Linéo a écrits à la main en tête de `france_travail.mots_cles`.
 *
 * `dejaVus` porte les jobId que Linéo a DÉJÀ dans son journal, quel que soit
 * leur statut : en attente de décision, partie en rédaction, ou écartée. Ces
 * offres étaient jusqu'ici retéléchargées, renotées et restockées à chaque
 * tournée. `etatCourant` les masquait ensuite à l'affichage, si bien que le
 * symptôme visible n'était pas « une offre revient » mais « la tournée ne
 * rapporte rien » : les places du lot et l'appel LLM partaient sur des annonces
 * déjà tranchées. Les écarter ICI, avant le plafond ET avant le modèle, est ce
 * qui rend chaque tournée réellement neuve.
 *
 * @param {unknown[]} offresBrutes
 * @param {{ maxOffres?: number, dejaVus?: Set<string> | string[], motsCles?: string[] }} [opts]
 */
export function prepareLot(offresBrutes, { maxOffres = MAX_OFFRES, dejaVus, motsCles = [] } = {}) {
  const connus = dejaVus instanceof Set ? dejaVus : new Set(Array.isArray(dejaVus) ? dejaVus.map(txt) : []);
  const cles = clesNormalisees(motsCles);
  const vues = new Set();
  /** @type {Array<ReturnType<typeof normaliseOffre> & {_pertinence: number}>} */
  const offres = [];
  let sansId = 0;
  let dejaVues = 0;
  let alternances = 0;

  for (const brut of Array.isArray(offresBrutes) ? offresBrutes : []) {
    const o = normaliseOffre(brut);
    if (!o.jobId) {
      sansId += 1;
      continue;
    }
    if (vues.has(o.jobId)) continue;
    vues.add(o.jobId);
    if (connus.has(o.jobId)) {
      dejaVues += 1;
      continue;
    }
    // ÉCARTÉE ICI, pas laissée au modèle : « jamais d'alternance, de stage ou
    // d'apprentissage » est une règle ABSOLUE du prompt, pas un jugement de
    // pertinence. La faire appliquer par le modèle coûtait une place de lot et
    // des tokens de sortie pour une offre dont la réponse était connue d'avance.
    // Il y en avait 88 sur les 1 161 de la tournée du 2026-08-10.
    if (estAlternance(brut, o.title)) {
      alternances += 1;
      continue;
    }
    offres.push({ ...o, _pertinence: scorePertinence(o, cles) });
  }

  // Tri STABLE (garanti par la spec depuis ES2019) : à score égal, l'ordre
  // d'arrivée est conservé, donc la priorité des mots-clés du YAML survit.
  if (cles.length > 0) offres.sort((a, b) => b._pertinence - a._pertinence);

  const gardees = offres.slice(0, maxOffres).map(({ _pertinence, ...o }) => o);
  return {
    offres: gardees,
    // `doublons` reste ce qu'il a toujours mesuré — la même annonce ramenée par
    // plusieurs requêtes de la MÊME tournée. Les offres connues d'une tournée
    // précédente sont comptées à part : mélanger les deux rendrait impossible de
    // savoir si une tournée maigre vient de requêtes redondantes ou d'un
    // gisement épuisé.
    doublons:
      (Array.isArray(offresBrutes) ? offresBrutes.length : 0) - offres.length - sansId - dejaVues - alternances,
    sansId,
    dejaVues,
    alternances,
    tronquees: offres.length - gardees.length,
    // Combien des offres retenues portent un mot-clé dans leur intitulé. C'est la
    // mesure qui dit si le classement sert à quelque chose : avant lui, ce chiffre
    // dépendait du hasard de l'ordre des requêtes.
    cibleesGardees: gardees.filter((o) => scorePertinence(o, cles) >= 4).length,
  };
}

/**
 * Sépare ce qui entre dans la file de ce qui n'y entre pas, et dit POURQUOI.
 *
 * Deux populations sortent, et elles n'ont pas la même cause :
 *
 *  1. les offres que le modèle a gardées mais notées SOUS le plancher. Elles
 *     existent parce qu'un plafond de 60 pousse à remplir : le modèle racle le
 *     fond pour atteindre le quota. Le plancher est ce qui rend le plafond
 *     inoffensif.
 *  2. les offres soumises que le modèle n'a PAS citées. Jusqu'ici elles
 *     n'étaient inscrites nulle part et revenaient à chaque tournée — 90 sur 150
 *     le 2026-08-10 — pour se refaire juger à l'identique.
 *
 * Les deux sont rendues dans `nonRetenues` pour être inscrites au journal. Ce
 * n'est PAS un effet de bord silencieux : sans cette inscription, « déjà jugée
 * comme du bruit » n'existe pas et chaque tournée repaye le même tri.
 *
 * @param {Object} o
 * @param {Array<{jobId: string, title?: string}>} o.soumises  le lot envoyé au modèle
 * @param {Array<{jobId: string, title?: string, score?: number|null}>} o.jobs  ce que le modèle a gardé
 * @param {number} [o.scoreMin]
 */
export function trieParPlancher({ soumises = [], jobs = [], scoreMin = SCORE_MINIMUM }) {
  const gardes = [];
  const nonRetenues = [];
  const cites = new Set();

  for (const j of jobs) {
    const id = txt(j?.jobId);
    if (!id) continue;
    cites.add(id);
    // ATTENTION : `Number(null)` vaut 0, pas NaN. Tester `Number(j.score)`
    // directement classerait un score ABSENT comme un score de 0, donc sous
    // n'importe quel plancher. C'est le même piège qui a affiché un badge « 0 »
    // sur une offre ajoutée à la main le 2026-08-10, et il apparaît une troisième
    // fois dans ce code : on écarte donc null/undefined/"" AVANT de convertir.
    const nul = j?.score === null || j?.score === undefined || j?.score === "";
    const s = nul ? NaN : Number(j.score);
    // Un score ABSENT n'est pas un score bas. Sans note on ne peut pas juger, et
    // jeter par défaut ferait disparaître l'offre en silence — exactement le
    // genre de perte qu'on ne voit qu'en relisant le journal six semaines après.
    if (!Number.isFinite(s) || s >= scoreMin) {
      gardes.push(j);
    } else {
      nonRetenues.push({ jobId: id, title: txt(j?.title), score: s, raison: `score ${s} sous le plancher ${scoreMin}` });
    }
  }

  for (const o of soumises) {
    const id = txt(o?.jobId);
    if (!id || cites.has(id)) continue;
    nonRetenues.push({ jobId: id, title: txt(o?.title), score: null, raison: "non citee par le tri" });
  }

  return { gardes, nonRetenues };
}

/**
 * Construit le prompt de tri.
 *
 * Les critères ne sont PAS écrits ici : ils viennent de portals.yml (les 42
 * mots-clés, le filtre de lieu) et du profil. Un prompt qui redéfinirait ses
 * propres critères deviendrait une deuxième source de vérité, exactement le
 * problème qu'on vient de supprimer côté recherche.
 */
export function promptRank({ offres, filtres = {}, profil = "", maxRetenues = 5, scoreMin = SCORE_MINIMUM }) {
  const positive = (filtres.positive ?? []).join(", ");
  const lieuOk = [...(filtres.alwaysAllow ?? []), ...(filtres.allow ?? [])].join(", ");
  const lieuNon = (filtres.block ?? []).join(", ");

  const lignes = offres.map(
    (o, i) =>
      `--- OFFRE ${i + 1}\n` +
      `jobId: ${o.jobId}\n` +
      `intitule: ${o.title}\n` +
      `entreprise: ${o.company || "non precisee"}\n` +
      `lieu: ${o.location || "non precise"}\n` +
      `contrat: ${o.contract || "non precise"}\n` +
      `url: ${o.url}\n` +
      `description: ${o.description}`,
  );

  return [
    "Tu tries des offres d'emploi pour un candidat. Tu ne rediges rien, tu selectionnes.",
    "",
    profil
      ? "PROFIL REEL DU CANDIDAT (source de verite : ce qu'il sait faire)\n" + profil
      : "PROFIL DU CANDIDAT : non fourni. Note alors la seule correspondance aux mots-cles, et dis-le dans whyMatch.",
    "",
    "MOTS-CLES VISES (ce qu'il CHERCHE, pas ce qu'il SAIT faire) :",
    positive || "aucun critere fourni",
    "",
    "LIEUX ACCEPTES : " + (lieuOk || "tous"),
    lieuNon ? "LIEUX REFUSES : " + lieuNon : "",
    "",
    "CE QUE MESURE LE SCORE",
    "- Le score est l'ADEQUATION entre le PROFIL REEL et l'offre. Ce n'est PAS la",
    "  presence de mots-cles dans l'annonce.",
    "- Une offre bourree de mots-cles vises mais qui exige un outil ABSENT du profil",
    "  merite un score BAS : le candidat serait ecarte au premier tri. Exemple concret :",
    "  une offre centree sur un outil precis (RPA UiPath, Blue Prism, Power Automate,",
    "  un ERP, un langage) alors que le profil ne le mentionne nulle part.",
    "- A l'inverse, une offre qui ne reprend aucun mot-cle mais decrit exactement ce que",
    "  le candidat fait merite un score HAUT.",
    "- Ce que le profil ne dit pas, le candidat ne le sait pas. Ne comble aucun trou.",
    "",
    "REGLES",
    "- " + maxRetenues + " est un PLAFOND, pas un quota. Ne le remplis pas.",
    "  S'il n'y a que 12 offres qui valent la peine, rends-en 12. Rendre une offre",
    "  faible pour atteindre le nombre est le pire resultat possible : le candidat",
    "  perd son temps a la lire, et elle repousse une bonne offre hors de la liste.",
    "- N'inclus AUCUNE offre que tu noterais en dessous de " + scoreMin + ". Elle sera",
    "  jetee de toute facon, et l'avoir redigee n'aura servi qu'a allonger le tri.",
    "- Entre ces deux bornes, ne presélectionne pas serre : c'est le candidat qui",
    "  tranche, offre par offre. Une offre plausible mais moyenne se garde avec son",
    "  score honnete ; un doute sur une offre PLAUSIBLE se resout en la gardant.",
    "- Ce qui justifie d'ECARTER, et rien d'autre :",
    "  1. hors sujet : le poste n'a aucun rapport avec ce que le candidat cherche ;",
    "  2. lieu refuse ;",
    "  3. alternance, stage ou apprentissage : JAMAIS, sans exception ;",
    "  4. anciennete hors d'atteinte : l'annonce exige une seniorite ou un nombre",
    "     d'annees d'experience que le profil ne peut pas presenter. Un intitule",
    "     « Senior », « Lead », « Principal », « Staff », ou une exigence chiffree",
    "     nettement au-dessus de l'experience du profil, se rejette meme si le",
    "     sujet colle parfaitement : la candidature serait ecartee au premier tri.",
    "- whyMatch : une phrase factuelle qui relie un element de l'offre a un fait du",
    "  PROFIL. S'il manque une competence exigee, DIS-LE dans la meme phrase.",
    "  N'invente aucune competence du candidat, ne promets rien.",
    "- score : entier de 0 a 100.",
    "- INTERDIT dans tes textes : le tiret cadratin et le tiret demi-cadratin, le markdown.",
    "",
    "SORTIE : uniquement un objet JSON, sans texte autour, de la forme",
    '{"jobs":[{"jobId":"","title":"","company":"","url":"","location":"","whyMatch":"","score":0}]}',
    "Si aucune offre ne convient, renvoie {\"jobs\":[]}.",
    "",
    "OFFRES A TRIER",
    ...lignes,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * Lit la réponse du modèle.
 *
 * Tolérant à un préambule ou un bloc de code : on extrait le premier objet JSON
 * qui contient une clé `jobs`. Mais on ne « répare » RIEN au-delà : une réponse
 * illisible doit lever, pas produire une liste vide qui ferait croire qu'aucune
 * offre ne correspondait.
 *
 * @param {unknown} brut
 * @param {{ offresConnues?: Array<ReturnType<typeof normaliseOffre>> }} [opts]
 */
export function parseRank(brut, { offresConnues = [] } = {}) {
  const texte = String(brut ?? "").trim();
  if (!texte) throw new Error("reponse vide du modele");

  let obj = null;
  const debut = texte.indexOf("{");
  const fin = texte.lastIndexOf("}");
  if (debut !== -1 && fin > debut) {
    try {
      obj = JSON.parse(texte.slice(debut, fin + 1));
    } catch {
      obj = null;
    }
  }
  if (!obj || !Array.isArray(obj.jobs)) {
    throw new Error("reponse hors format (pas d'objet avec une cle jobs) : " + texte.slice(0, 200));
  }

  // Un jobId inventé serait pire qu'une offre manquante : on ne garde que ceux
  // qu'on a réellement envoyés au modèle.
  const permis = new Set(offresConnues.map((o) => String(o.jobId)));
  /** @type {Array<{jobId: string, title: string, company: string, url: string, location: string, description: string, whyMatch: string, score: number|null}>} */
  const jobs = [];
  /** @type {string[]} */
  const inventes = [];

  for (const j of obj.jobs) {
    if (!j || typeof j !== "object") continue;
    const jobId = txt(j.jobId);
    if (!jobId) continue;
    if (permis.size && !permis.has(jobId)) {
      inventes.push(jobId);
      continue;
    }
    const source = offresConnues.find((o) => String(o.jobId) === jobId);
    const note = Number(j.score);
    jobs.push({
      jobId,
      // On refait confiance à l'offre d'origine pour les faits, et au modèle
      // seulement pour le jugement (whyMatch, score).
      title: txt(j.title) || source?.title || "",
      company: txt(j.company) || source?.company || "",
      url: txt(j.url) || source?.url || "",
      location: txt(j.location) || source?.location || "",
      description: source?.description ?? "",
      // JAMAIS `j.contactEmail` : l'adresse vient de l'offre d'origine, point.
      // Un modele qui inventerait un destinataire ferait partir une vraie
      // candidature chez un inconnu — c'est le seul champ ou il n'a aucun mot a
      // dire, meme en secours.
      contactEmail: source?.contactEmail ?? "",
      whyMatch: txt(j.whyMatch)
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\s+[—–]\s+/g, ", ")
        .replace(/[—–]/g, ", "),
      score: Number.isFinite(note) ? Math.max(0, Math.min(100, Math.round(note))) : null,
    });
  }

  return { jobs, inventes };
}
