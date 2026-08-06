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

/** Au-delà, le prompt devient ingérable pour un seul appel. */
export const MAX_OFFRES = 60;
/** Assez pour juger la pertinence, sans recopier l'annonce entière. */
export const MAX_DESCRIPTION = 700;

const txt = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

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
  };
}

/**
 * Déduplique et borne le lot d'offres.
 *
 * La déduplication est faite AVANT le plafond : sinon 60 places pourraient être
 * mangées par la même offre remontée par plusieurs requêtes de mots-clés
 * différents, ce qui est le cas courant (« n8n » et « automatisation » ramènent
 * largement les mêmes annonces).
 */
export function prepareLot(offresBrutes, { maxOffres = MAX_OFFRES } = {}) {
  const vues = new Set();
  /** @type {Array<ReturnType<typeof normaliseOffre>>} */
  const offres = [];
  let sansId = 0;

  for (const brut of Array.isArray(offresBrutes) ? offresBrutes : []) {
    const o = normaliseOffre(brut);
    if (!o.jobId) {
      sansId += 1;
      continue;
    }
    if (vues.has(o.jobId)) continue;
    vues.add(o.jobId);
    offres.push(o);
  }

  const gardees = offres.slice(0, maxOffres);
  return {
    offres: gardees,
    doublons: (Array.isArray(offresBrutes) ? offresBrutes.length : 0) - offres.length - sansId,
    sansId,
    tronquees: offres.length - gardees.length,
  };
}

/**
 * Construit le prompt de tri.
 *
 * Les critères ne sont PAS écrits ici : ils viennent de portals.yml (les 42
 * mots-clés, le filtre de lieu) et du profil. Un prompt qui redéfinirait ses
 * propres critères deviendrait une deuxième source de vérité, exactement le
 * problème qu'on vient de supprimer côté recherche.
 */
export function promptRank({ offres, filtres = {}, profil = "", maxRetenues = 5 }) {
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
    "CRITERES DE PERTINENCE (mots-cles vises par le candidat) :",
    positive || "aucun critere fourni",
    "",
    "LIEUX ACCEPTES : " + (lieuOk || "tous"),
    lieuNon ? "LIEUX REFUSES : " + lieuNon : "",
    "",
    profil ? "PROFIL DU CANDIDAT :\n" + profil : "",
    "",
    "REGLES",
    "- Garde au maximum " + maxRetenues + " offres, les plus pertinentes. Moins si peu correspondent.",
    "- Une offre hors sujet ou dans un lieu refuse est ECARTEE, meme s'il ne reste rien.",
    "- Ne garde JAMAIS une offre d'alternance, de stage ou d'apprentissage.",
    "- whyMatch : une phrase factuelle qui cite ce qui, dans l'offre, correspond aux criteres.",
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
      whyMatch: txt(j.whyMatch)
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\s+[—–]\s+/g, ", ")
        .replace(/[—–]/g, ", "),
      score: Number.isFinite(note) ? Math.max(0, Math.min(100, Math.round(note))) : null,
    });
  }

  return { jobs, inventes };
}
