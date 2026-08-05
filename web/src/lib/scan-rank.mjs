// Le classement « meilleures offres » de GET /api/scan. Logique pure (pas de fs,
// pas de process) pour être testable sans lancer un scan réseau de plusieurs
// minutes.
//
// CE SCORE N'EST PAS LE SCORE D'ÉVALUATION. Le tracker et les rapports portent
// une note de fit sur 5 produite par un LLM qui a lu l'offre ENTIÈRE. Ici on n'a
// qu'une ligne de pipeline.md — URL, entreprise, intitulé, lieu, date — et zéro
// token dépensé. D'où un nom différent (`pertinence`, sur 100) et des `raisons`
// explicites : c'est un ordre de lecture, pas un verdict. Confondre les deux
// ferait passer un tri de titres pour une évaluation de fond.
//
// Les signaux viennent TOUS de ce que Linéo a lui-même déclaré :
//   - config/profile.yml → target_roles  (l'intitulé qu'il vise)
//   - portals.yml → title_filter.positive / negative  (ses 42 mots-clés)
//   - portals.yml → location_filter.always_allow / allow / block
//   - la date de publication que le scanner a estampillée
// Rien n'est deviné sur le contenu de l'offre : personne ne l'a lue.

import { phrasePresente } from "./tailor.mjs";

/**
 * Une offre en attente, telle que readInbox() la sort de pipeline.md.
 * @typedef {Object} OffrePipeline
 * @property {string} url
 * @property {string} company
 * @property {string} role
 * @property {string} [location]
 * @property {string} [compensation]
 * @property {string} [postedAt]
 * @property {boolean} [done]
 */

/**
 * Le contexte de classement, lu dans les fichiers de config de l'utilisateur.
 * @typedef {Object} ContexteClassement
 * @property {string[]} positifs   portals.yml title_filter.positive
 * @property {string[]} negatifs   portals.yml title_filter.negative
 * @property {string[]} lieuxOk    location_filter.always_allow + allow
 * @property {string[]} lieuxBloques location_filter.block
 * @property {string[]} cibles     config/profile.yml target_roles (intitulés)
 * @property {string} aujourdhui   date du jour en YYYY-MM-DD (injectée, jamais Date.now())
 */

// Barème. La somme des quatre plafonds fait 100 — un score lisible sans échelle
// cachée. L'intitulé pèse le plus lourd parce que c'est le seul signal qui dise
// « c'est le métier que je veux » plutôt que « ça parle d'un sujet proche » :
// une offre « Platform Engineer » coche un mot-clé, une offre « Integration
// Engineer » coche un intitulé cible, et la seconde vaut mieux que la première.
const POIDS_CIBLE = 40;
const POIDS_MOTS_CLES = 30;
const POIDS_LIEU = 15;
const POIDS_FRAICHEUR = 15;

/** Au-delà de 21 jours, une offre ATS est souvent déjà pourvue : la fraîcheur ne
 *  rapporte plus rien. En dessous, le score décroît linéairement. */
const FENETRE_FRAICHEUR_JOURS = 21;

function normaliser(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

const MOTS_VIDES_INTITULE = new Set([
  "en", "de", "du", "des", "la", "le", "les", "et", "ou", "au", "aux", "sur", "dans", "chez", "pour",
  "and", "or", "of", "the", "a", "an", "for", "with", "in",
  "hf", "fh", "mf", "cdi", "cdd", "stage", "alternance", "alternant", "apprentissage",
  "freelance", "interim", "temps", "plein", "partiel", "remote", "teletravail", "hybride",
  "junior", "senior", "confirme", "expert", "debutant", "poste", "offre", "emploi", "job",
]);

/** Les jetons porteurs de sens d'un intitulé (sans articles ni habillage d'annonce). */
export function jetonsIntitule(s) {
  return normaliser(s)
    .replace(/[^a-z0-9+#.]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !MOTS_VIDES_INTITULE.has(t));
}

/**
 * Les mots-clés de portails que l'intitulé mentionne VRAIMENT.
 *
 * Divergence assumée avec le scanner : `buildTitleFilter` du cœur filtre par
 * SOUS-CHAÎNE, si bien que « AI » matche « Nail » (le cœur le documente lui-même
 * sur `matchedKeyword`). Ce bruit est acceptable pour décider d'INCLURE une offre
 * — mieux vaut un faux positif qu'une offre manquée — mais il corromprait un
 * CLASSEMENT. On réutilise donc `phrasePresente` (frontières de mot, insensible
 * aux accents, et sensible à la casse pour les sigles courts) : « AI » ne matche
 * plus « travail » ni « Nail », « n8n » matche « n8n ».
 *
 * @param {string} intitule
 * @param {string[]} motsCles
 * @returns {string[]}
 */
export function motsClesTitre(intitule, motsCles) {
  const vus = new Set();
  const out = [];
  for (const mot of motsCles ?? []) {
    const propre = String(mot ?? "").trim();
    if (!propre || !phrasePresente(propre, intitule)) continue;
    const cle = normaliser(propre);
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push(propre);
  }
  return out;
}

/**
 * L'intitulé cible le plus proche, et sa couverture (part des jetons de la cible
 * présents dans l'offre). On exige DEUX jetons communs pour une cible
 * multi-mots : « Engineer » partagé ne fait pas une correspondance, sinon toute
 * offre d'ingénieur matcherait « Data Engineer ».
 *
 * @param {string} intitule
 * @param {string[]} cibles
 * @returns {{cible: string, couverture: number}|null}
 */
export function cibleLaPlusProche(intitule, cibles) {
  const presents = new Set(jetonsIntitule(intitule));
  if (!presents.size) return null;
  let meilleur = null;
  for (const brut of cibles ?? []) {
    const jetons = jetonsIntitule(brut);
    if (!jetons.length) continue;
    const communs = jetons.filter((t) => presents.has(t)).length;
    if (communs < (jetons.length === 1 ? 1 : 2)) continue;
    const couverture = communs / jetons.length;
    if (!meilleur || couverture > meilleur.couverture) meilleur = { cible: String(brut).trim(), couverture };
  }
  return meilleur;
}

/** Nombre de jours entre deux dates YYYY-MM-DD, ou null si l'une est illisible. */
export function joursEcoules(depuis, jusqua) {
  const a = Date.parse(`${depuis}T00:00:00Z`);
  const b = Date.parse(`${jusqua}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** Un lieu qui matche une entrée de la liste (sous-chaîne, sans accents/casse —
 *  ici la sous-chaîne est la bonne sémantique : « Paris » doit matcher
 *  « Paris, France » et « Île-de-France » matcher « Nogent, Ile-de-France »).
 *
 *  Quand plusieurs entrées matchent, on rend celle qui apparaît le PLUS TÔT dans
 *  le lieu de l'offre. Un lieu s'écrit du précis vers le général — « Paris,
 *  Île-de-France, France » — donc la première correspondance est la plus
 *  informative. (Prendre la plus longue serait un piège : « France » est plus
 *  long que « Paris » tout en étant moins précis.) À position égale, la plus
 *  longue tranche. Ne change aucun score — seulement la raison affichée. */
function lieuMatche(lieu, liste) {
  const cible = normaliser(lieu);
  if (!cible) return null;
  let meilleur = null;
  for (const entree of liste ?? []) {
    const e = normaliser(entree);
    if (!e) continue;
    const position = cible.indexOf(e);
    if (position === -1) continue;
    if (!meilleur || position < meilleur.position || (position === meilleur.position && e.length > meilleur.longueur)) {
      meilleur = { nom: String(entree).trim(), position, longueur: e.length };
    }
  }
  return meilleur ? meilleur.nom : null;
}

/**
 * La pertinence d'une offre, sur 100, avec ses raisons en français.
 *
 * `exclue` sépare « mal classée » de « à ne pas montrer » : un mot-clé négatif ou
 * un lieu bloqué sont des refus explicites de Linéo, pas un score faible. Le
 * scanner filtre déjà là-dessus en amont, mais pipeline.md accumule aussi des
 * offres ajoutées à la main et des scans plus anciens faits avec d'autres
 * filtres — donc on revérifie ici plutôt que de supposer.
 *
 * @param {OffrePipeline} offre
 * @param {ContexteClassement} ctx
 * @returns {{pertinence: number, raisons: string[], exclue: string|null, motsCles: string[]}}
 */
export function scorerOffre(offre, ctx) {
  const intitule = String(offre?.role ?? "");
  const lieu = String(offre?.location ?? "");
  const raisons = [];
  let score = 0;

  const negatif = motsClesTitre(intitule, ctx?.negatifs ?? [])[0] ?? null;
  const bloque = lieuMatche(lieu, ctx?.lieuxBloques ?? []);
  const exclue = negatif
    ? `mot-clé écarté : ${negatif}`
    : bloque
      ? `lieu écarté : ${bloque}`
      : null;

  // Intitulé cible
  const cible = cibleLaPlusProche(intitule, ctx?.cibles ?? []);
  if (cible) {
    score += Math.round(POIDS_CIBLE * cible.couverture);
    raisons.push(
      cible.couverture >= 1
        ? `intitulé visé : ${cible.cible}`
        : `intitulé proche de ${cible.cible}`,
    );
  }

  // Mots-clés de portails. Une expression de plusieurs mots (« AI Automation »,
  // « Integration Engineer ») vaut double : elle est intrinsèquement plus
  // spécifique qu'un mot générique isolé (« AI », « Agent »), et c'est le seul
  // moyen honnête de hiérarchiser 42 mots-clés sans inventer de pondération à la
  // main mot par mot. Trois expressions saturent le poste.
  const motsCles = motsClesTitre(intitule, ctx?.positifs ?? []);
  if (motsCles.length) {
    const poids = motsCles.reduce((n, m) => n + (/\s/.test(m.trim()) ? 2 : 1), 0);
    score += Math.round(POIDS_MOTS_CLES * Math.min(1, poids / 6));
    raisons.push(`mots-clés : ${motsCles.slice(0, 4).join(", ")}`);
  }

  // Lieu
  const ok = lieuMatche(lieu, ctx?.lieuxOk ?? []);
  if (ok) {
    score += POIDS_LIEU;
    raisons.push(`lieu : ${ok}`);
  } else if (!lieu) {
    // Pas de lieu au dossier : ni bonus ni malus. L'absence d'information n'est
    // pas une information — la moitié des lignes de pipeline.md n'ont pas de
    // colonne lieu, et les pénaliser ferait remonter le bruit daté au-dessus.
    raisons.push("lieu inconnu");
  }

  // Fraîcheur
  const jours = offre?.postedAt ? joursEcoules(offre.postedAt, ctx?.aujourdhui) : null;
  if (jours !== null && jours >= 0) {
    const reste = Math.max(0, FENETRE_FRAICHEUR_JOURS - jours) / FENETRE_FRAICHEUR_JOURS;
    score += Math.round(POIDS_FRAICHEUR * reste);
    raisons.push(jours === 0 ? "publiée aujourd'hui" : `publiée il y a ${jours} j`);
  }

  return { pertinence: Math.max(0, Math.min(100, score)), raisons, exclue, motsCles };
}

/**
 * Les offres en attente, les meilleures d'abord.
 *
 * On ne garde que les lignes NON traitées (`done: false`) : une offre cochée dans
 * pipeline.md a déjà été évaluée, la remonter dans « à regarder » serait du
 * travail refait. Les exclues sortent de la liste mais sont comptées à part, pour
 * qu'une liste courte ne passe pas pour un scan vide.
 *
 * Tri : pertinence, puis la plus récente, puis l'entreprise (pour que l'ordre
 * soit stable d'un appel à l'autre — sans ça, deux offres à égalité pourraient
 * s'échanger de place entre deux requêtes et l'interface clignoterait).
 *
 * @param {OffrePipeline[]} offres
 * @param {ContexteClassement} ctx
 * @returns {{classees: (OffrePipeline & {pertinence: number, raisons: string[], motsCles: string[]})[], exclues: number, dejaTraitees: number}}
 */
export function classerOffres(offres, ctx) {
  const liste = Array.isArray(offres) ? offres : [];
  const dejaTraitees = liste.filter((o) => o?.done).length;
  const classees = [];
  let exclues = 0;

  for (const offre of liste) {
    if (offre?.done) continue;
    // Sans URL, l'offre n'est pas actionnable : on ne peut ni l'ouvrir, ni
    // l'évaluer, ni la retrouver dans pipeline.md. readInbox() n'en produit
    // jamais (il exige déjà une URL), mais une ligne tordue ou un appelant futur
    // ne doit pas pouvoir glisser un élément vide en tête de classement.
    if (!offre || typeof offre !== "object" || !String(offre.url ?? "").trim()) continue;
    const { pertinence, raisons, exclue, motsCles } = scorerOffre(offre, ctx);
    if (exclue) {
      exclues++;
      continue;
    }
    classees.push({ ...offre, pertinence, raisons, motsCles });
  }

  classees.sort(
    (a, b) =>
      b.pertinence - a.pertinence ||
      String(b.postedAt ?? "").localeCompare(String(a.postedAt ?? "")) ||
      String(a.company ?? "").localeCompare(String(b.company ?? "")),
  );
  return { classees, exclues, dejaTraitees };
}
