// Plan de recherche France Travail, construit SANS LLM.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Le workflow n8n générait ses URLs France Travail avec deux agents LLM en
// cascade (« Profile Generation » → « Search Urls generation »). Deux problèmes :
//
//  1. Le crédit Anthropic est épuisé (2026-08-06) : ces deux agents tombent en
//     « Bad request », et la chaîne meurt au 8e nœud avant même de chercher.
//  2. « Quoi chercher » avait deux sources de vérité : le prompt du LLM d'un
//     côté, les 42 mots-clés de portals.yml de l'autre. Deux listes qui
//     divergent, personne ne sait laquelle fait foi.
//
// Ici la réponse est déterministe : portals.yml est la source, et ce module en
// fait une projection France Travail. Zéro token, reproductible, testable.
//
// LE PIÈGE À NE PAS REFAIRE
// -------------------------
// Les 42 mots-clés de portals.yml sont taillés pour les job boards ATS
// (Greenhouse, Ashby, Lever) atteints par WebSearch, en anglais : « Forward
// Deployed », « Customer Engineer », « Hyperautomation ». France Travail est une
// API publique française — ces termes n'y ramènent RIEN. Recopier les 42 tel
// quel donnerait donc MOINS de résultats que la requête française que le LLM
// produisait. D'où une seule source et DEUX projections, pas une fusion.

/** Base de l'API Offres d'emploi v2 de France Travail. */
export const BASE_FT = "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search";

/**
 * Traduction explicite ATS (anglais) → France Travail (français).
 * Table plutôt qu'heuristique : une heuristique « garde ce qui a l'air français »
 * se tromperait sur « Agent », « Workflow », « RPA », qui marchent dans les deux.
 */
export const TRADUCTION_FT = {
  "AI Engineer": "ingénieur intelligence artificielle",
  "AI Automation": "automatisation intelligence artificielle",
  "AI Workflow": "workflow intelligence artificielle",
  "LLM Engineer": "ingénieur LLM",
  "Automation": "automatisation",
  "Process Automation": "automatisation des processus",
  "Business Automation": "automatisation métier",
  "Workflow Automation": "automatisation de workflow",
  "Integration Engineer": "ingénieur intégration",
  "Solutions Engineer": "ingénieur solutions",
  "Solutions Architect": "architecte solutions",
  "Technical Consultant": "consultant technique",
  "Platform Engineer": "ingénieur plateforme",
  "Generative AI": "IA génératrice",
  "GenAI": "IA générative",
  "Low-Code": "low-code",
  "No-Code": "no-code",
};

/**
 * Termes qui n'ont aucun sens sur France Travail : jargon de recrutement tech
 * américain, ou trop génériques pour être une requête (« AI », « ML », « Agent »
 * seuls ramènent du bruit sur un portail généraliste).
 */
export const NON_PERTINENT_FT = new Set(
  [
    "Forward Deployed",
    "Deployed Engineer",
    "Customer Engineer",
    "Hyperautomation",
    "Agentic",
    "LangChain",
    "LangGraph",
    "CrewAI",
    "AutoGen",
    "AI",
    "ML",
    "Agent",
    "Workflow",
  ].map((s) => s.toLowerCase()),
);

const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Projette les mots-clés de portals.yml en requêtes France Travail.
 *
 * @param {string[]} positive  title_filter.positive de portals.yml (les 42)
 * @param {string[]} [enPlus]  requêtes françaises ajoutées à la main (config)
 * @returns {{ retenus: string[], traduits: Array<{de: string, vers: string}>, ecartes: string[] }}
 */
export function motsClesFranceTravail(positive = [], enPlus = []) {
  const retenus = [];
  const traduits = [];
  const ecartes = [];
  const vus = new Set();

  const ajoute = (mot) => {
    const cle = norm(mot);
    if (!cle || vus.has(cle)) return;
    vus.add(cle);
    retenus.push(mot);
  };

  for (const brut of positive) {
    const mot = String(brut ?? "").trim();
    if (!mot) continue;
    if (NON_PERTINENT_FT.has(norm(mot))) {
      ecartes.push(mot);
      continue;
    }
    const fr = TRADUCTION_FT[mot];
    if (fr) {
      traduits.push({ de: mot, vers: fr });
      ajoute(fr);
    } else {
      ajoute(mot);
    }
  }

  // Les requêtes de config passent en tête : ce sont celles que Linéo a écrites
  // explicitement, elles doivent survivre au plafond `max_urls`.
  //
  // L'ordre du YAML est PRÉSERVÉ, et ce n'est pas cosmétique : il fixe l'ordre
  // des requêtes, donc celui des offres agrégées, donc lesquelles remplissent le
  // lot que `prepareLot` tronque à MAX_OFFRES avant le tri. Un `unshift` par mot
  // inversait la liste — le DERNIER mot-clé du fichier partait en premier, et
  // les mieux ciblés se faisaient jeter par le plafond.
  const tete = [];
  for (const mot of enPlus) {
    const m = String(mot ?? "").trim();
    if (!m) continue;
    const cle = norm(m);
    if (vus.has(cle)) {
      // Déjà présent : soit il vient de `positive` (on le retire pour le
      // repositionner en tête), soit il est déjà en tête (on ne le double pas).
      const i = retenus.findIndex((r) => norm(r) === cle);
      if (i !== -1) retenus.splice(i, 1);
      if (tete.some((r) => norm(r) === cle)) continue;
    }
    vus.add(cle);
    tete.push(m);
  }
  retenus.unshift(...tete);

  return { retenus, traduits, ecartes };
}

/**
 * Le nom du paramètre de rayon chez France Travail est `distance`, PAS `rayon`.
 *
 * Vérifié contre l'API le 2026-08-10, requête « automatisation » autour de Paris :
 *   rayon=30    → 14 offres   ⎫ identiques : `rayon` est ignoré en silence, et
 *   rayon=100   → 14 offres   ⎭ c'est la distance par défaut (10 km) qui s'applique
 *   distance=10 → 14 offres
 *   distance=100→ 29 offres
 * Le `rayon: 30` de portals.yml n'a donc jamais rien élargi : pendant des
 * semaines, la tournée cherchait dans 10 km autour de Paris en croyant faire 30.
 * L'API ne rejette pas les paramètres inconnus, d'où le silence.
 */
const PARAM_DISTANCE = "distance";

/**
 * Construit les URLs France Travail. Une URL par mot-clé : c'est ce que faisait
 * l'agent, et ça garde un résultat interprétable (on sait quelle requête a
 * ramené quoi) au lieu d'un `motsCles` fourre-tout.
 *
 * ORDRE DES URLs : toutes les requêtes France d'abord, les requêtes hors France
 * ensuite. Ce n'est pas cosmétique. `prepareLot` tronque à MAX_OFFRES dans
 * l'ordre d'arrivée ; or le corpus international de France Travail est à 84 %
 * luxembourgeois (mesuré : 1 423 offres sur 1 691). Mettre l'Europe en tête
 * ferait manger les places du lot par du Luxembourg avant que la France n'arrive.
 *
 * @param {Object} o
 * @param {string[]} o.motsCles
 * @param {string[]} [o.communes]    codes INSEE ; [] = France entière (couvre le full remote)
 * @param {number} [o.distance]      km autour de chaque commune ; ignoré si communes est vide
 * @param {number} [o.rayon]         alias historique de `distance`, accepté pour ne pas
 *                                   casser un portals.yml qui n'a pas encore été renommé
 * @param {string[]} [o.continents]  codes paysContinent (991 = Europe hors France)
 * @param {number} [o.max]
 * @param {string} [o.range]
 * @returns {{ urls: string[], tronquees: number }}
 */
export function urlsFranceTravail({
  motsCles,
  communes = [],
  distance,
  rayon,
  continents = [],
  max = 12,
  range = "0-149",
}) {
  const km = Number(distance ?? rayon ?? 30);
  const urls = [];
  const cibles = communes.length ? communes : [null];

  for (const mot of motsCles) {
    for (const commune of cibles) {
      const p = new URLSearchParams();
      if (commune) {
        p.set("commune", commune);
        if (Number.isFinite(km)) p.set(PARAM_DISTANCE, String(km));
      }
      p.set("motsCles", mot);
      p.set("range", range);
      urls.push(`${BASE_FT}?${p.toString()}`);
    }
  }

  // Hors France, APRÈS la France (voir le commentaire d'en-tête sur l'ordre).
  for (const continent of continents) {
    const code = String(continent ?? "").trim();
    if (!code) continue;
    for (const mot of motsCles) {
      const p = new URLSearchParams();
      p.set("paysContinent", code);
      p.set("motsCles", mot);
      p.set("range", range);
      urls.push(`${BASE_FT}?${p.toString()}`);
    }
  }

  const gardees = urls.slice(0, max);
  return { urls: gardees, tronquees: urls.length - gardees.length };
}

/**
 * Le plan complet, tel que n8n le consomme.
 *
 * @param {Object} o
 * @param {{positive: string[], allow: string[], block: string[], alwaysAllow: string[]}} o.filtres
 * @param {{mots_cles?: string[], communes?: string[], rayon?: number, max_urls?: number}} [o.ft]
 */
export function planRecherche({ filtres, ft = {} }) {
  const { retenus, traduits, ecartes } = motsClesFranceTravail(filtres.positive ?? [], ft.mots_cles ?? []);
  const { urls, tronquees } = urlsFranceTravail({
    motsCles: retenus,
    communes: ft.communes ?? [],
    distance: ft.distance ?? ft.rayon ?? 30,
    continents: ft.continents ?? [],
    max: ft.max_urls ?? 12,
  });

  return {
    source: "portals.yml",
    motsCles: retenus,
    traduits,
    ecartes,
    urls,
    urlsTronquees: tronquees,
    // Renvoyés pour que n8n filtre les offres avec les MÊMES règles que le
    // scanner career-ops, au lieu d'un second jeu de règles dans un prompt.
    filtreTitre: { positive: filtres.positive ?? [], negative: filtres.negative ?? [] },
    filtreLieu: {
      allow: filtres.allow ?? [],
      block: filtres.block ?? [],
      alwaysAllow: filtres.alwaysAllow ?? [],
    },
  };
}
