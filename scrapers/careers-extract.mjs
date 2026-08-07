// Extraction d'offres depuis une page carrière quelconque — partie PURE.
//
// POURQUOI CE FICHIER EXISTE. Les ~68 providers couvrent les plateformes qui
// exposent une API (Greenhouse, Ashby, Workday, SmartRecruiters…). Restent les
// employeurs qui hébergent leurs offres eux-mêmes : Lindy, Factorial, Vinted en
// sont, et ils ressortaient tous en « no provider matched careers_url or api ».
// Pour eux il n'y a pas de slug à trouver — il faut lire la page.
//
// AUCUN accès réseau ni navigateur ici : ce module ne fait que transformer des
// données déjà récupérées. Le pilote Playwright vit dans careers-page.mjs. La
// séparation n'est pas cosmétique — c'est ce qui permet de tester l'extraction
// sur des payloads figés, sans dépendre d'un site tiers qui change ou tombe.
//
// TROIS SOURCES, par ordre de confiance décroissante. On ne mélange jamais :
// la première qui donne un résultat exploitable gagne, parce que descendre d'un
// cran signifie deviner davantage.

/** Un intitulé plus long que ça n'est pas un intitulé de poste, c'est du texte. */
const TITRE_MAX = 160;

/** Garde-fou : une page carrière qui rend 500 offres est plus probablement un
 *  faux positif (catalogue de liens) qu'un vrai recrutement massif. */
export const MAX_OFFRES = 200;

/** Les cartes rendues arrivent en texte multi-lignes (innerText). */
const SAUT_DE_LIGNE = /\r?\n/;

const txt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Résout une URL relative contre la page d'origine ; '' si inexploitable. */
export function urlAbsolue(brut, base) {
  const v = txt(brut);
  if (!v) return '';
  try {
    const u = new URL(v, base || undefined);
    // Un `javascript:` ou un `mailto:` n'est pas une offre, et on ne veut pas
    // les voir atterrir dans le tracker comme lien d'annonce.
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.href;
  } catch {
    return '';
  }
}

/** Aplatit les formes que prend un lieu selon les sites (string, objet, liste). */
export function lieuLisible(v) {
  if (!v) return '';
  if (Array.isArray(v)) return [...new Set(v.map(lieuLisible).filter(Boolean))].join(', ');
  if (typeof v === 'object') {
    // schema.org: { address: { addressLocality, addressRegion, addressCountry } }
    const a = v.address ?? v;
    const parts = [a.addressLocality, a.addressRegion, a.addressCountry]
      .map(txt)
      .filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(', ');
    return txt(v.name ?? v.text ?? v.label ?? v.city ?? '');
  }
  return txt(v);
}

/**
 * Normalise et dédoublonne. C'est le seul point de sortie du module : tout ce
 * qui en ressort a un titre et une URL absolue, sinon la ligne est jetée.
 *
 * Le dédoublonnage se fait sur l'URL : une même offre est presque toujours
 * listée deux fois (carte + lien « postuler »), et deux titres différents
 * pointant la même URL restent une seule offre.
 */
export function normalise(offres, { base, company } = {}) {
  const vues = new Set();
  const out = [];
  for (const o of Array.isArray(offres) ? offres : []) {
    if (!o || typeof o !== 'object') continue;
    const title = txt(o.title);
    const url = urlAbsolue(o.url, base);
    if (!title || title.length > TITRE_MAX || !url) continue;
    if (vues.has(url)) continue;
    vues.add(url);
    out.push({
      title,
      url,
      company: txt(o.company) || txt(company),
      location: lieuLisible(o.location),
    });
    if (out.length >= MAX_OFFRES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Source 1 — JSON-LD schema.org/JobPosting. La plus fiable : c'est l'employeur
// lui-même qui déclare ses offres dans un format normalisé (il le fait pour
// Google for Jobs). Quand elle existe, on ne cherche pas plus loin.
// ---------------------------------------------------------------------------

/** Déplie @graph, tableaux et ItemList pour atteindre les nœuds réels. */
function* aplatirLd(noeud, profondeur = 0) {
  if (!noeud || typeof noeud !== 'object' || profondeur > 6) return;
  if (Array.isArray(noeud)) {
    for (const n of noeud) yield* aplatirLd(n, profondeur + 1);
    return;
  }
  yield noeud;
  for (const cle of ['@graph', 'itemListElement', 'item', 'mainEntity']) {
    if (noeud[cle]) yield* aplatirLd(noeud[cle], profondeur + 1);
  }
}

function estJobPosting(n) {
  const t = n['@type'];
  const types = Array.isArray(t) ? t : [t];
  return types.some((x) => txt(x).toLowerCase() === 'jobposting');
}

/**
 * @param {unknown[]} blocs  contenu parsé des <script type="application/ld+json">
 */
export function offresDepuisJsonLd(blocs, { base, company } = {}) {
  const brut = [];
  for (const bloc of Array.isArray(blocs) ? blocs : []) {
    for (const n of aplatirLd(bloc)) {
      if (!estJobPosting(n)) continue;
      brut.push({
        title: n.title ?? n.name,
        // `url` est le champ canonique, mais beaucoup de sites ne remplissent
        // que l'identifiant de la page d'application.
        url: n.url ?? n.sameAs ?? n.applyUrl ?? n?.hiringOrganization?.sameAs,
        company: n?.hiringOrganization?.name,
        location: n.jobLocation ?? n.applicantLocationRequirements,
      });
    }
  }
  return normalise(brut, { base, company });
}

// ---------------------------------------------------------------------------
// Source 2 — la réponse JSON de l'API interne de la page. Une page carrière en
// React ne contient aucune offre dans son HTML : elle les charge en XHR. En
// écoutant les réponses on récupère la donnée structurée à la source, sans
// jamais avoir à deviner quelle balise contient quoi.
// ---------------------------------------------------------------------------

/** Clés qui portent un intitulé de poste, par fréquence observée. */
const CLES_TITRE = ['title', 'jobTitle', 'name', 'position', 'intitule', 'headline'];
/** Clés qui portent un lien ou de quoi le reconstruire. */
const CLES_URL = ['url', 'jobUrl', 'job_url', 'applyUrl', 'apply_url', 'absolute_url', 'link', 'permalink', 'hostedUrl'];
const CLES_LIEU = ['location', 'locations', 'city', 'jobLocation', 'office', 'lieu', 'workplace'];

/** Un objet ressemble à une offre s'il a un intitulé ET un lien. */
function commeUneOffre(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const cleTitre = CLES_TITRE.find((k) => typeof o[k] === 'string' && txt(o[k]));
  if (!cleTitre) return null;
  const cleUrl = CLES_URL.find((k) => typeof o[k] === 'string' && txt(o[k]));
  if (!cleUrl) return null;
  const cleLieu = CLES_LIEU.find((k) => o[k] != null);
  return {
    title: o[cleTitre],
    url: o[cleUrl],
    company: typeof o.company === 'string' ? o.company : o?.company?.name,
    location: cleLieu ? o[cleLieu] : '',
  };
}

/**
 * Cherche, n'importe où dans un payload, le plus grand tableau d'objets qui
 * ressemblent à des offres.
 *
 * « Le plus grand » et non « le premier » : les API renvoient souvent des
 * tableaux annexes (filtres, départements, offres mises en avant) avant la
 * vraie liste. Prendre le premier ramenait 3 offres vedettes au lieu des 60.
 */
export function offresDepuisApi(payload, { base, company } = {}) {
  let meilleur = [];
  const vu = new Set();

  const visiter = (n, profondeur) => {
    if (!n || typeof n !== 'object' || profondeur > 8) return;
    if (vu.has(n)) return; // garde anti-cycle
    vu.add(n);

    if (Array.isArray(n)) {
      const offres = n.map(commeUneOffre).filter(Boolean);
      // Exiger la majorité : un tableau hétérogène dont deux éléments ont par
      // hasard un `name` et un `link` n'est pas une liste d'offres.
      if (offres.length > meilleur.length && offres.length * 2 >= n.length) {
        meilleur = offres;
      }
      for (const e of n) visiter(e, profondeur + 1);
      return;
    }
    for (const v of Object.values(n)) visiter(v, profondeur + 1);
  };

  visiter(payload, 0);
  return normalise(meilleur, { base, company });
}

/**
 * Une réponse réseau mérite-t-elle d'être inspectée ?
 *
 * Filtrer sur l'URL évite de parser chaque pixel de tracking et chaque bundle.
 * On reste large sur le chemin (les API internes s'appellent /api/jobs,
 * /careers/positions, /graphql…) mais strict sur le type de contenu.
 */
export function reponseInteressante(url, contentType) {
  if (!/\bjson\b/i.test(String(contentType ?? ''))) return false;
  const u = String(url ?? '').toLowerCase();
  if (/\b(analytics|telemetry|sentry|segment|gtm|hotjar|intercom|beacon)\b/.test(u)) return false;
  return /job|career|position|vacanc|opening|offre|emploi|recruit|graphql|api/.test(u);
}

// ---------------------------------------------------------------------------
// Source 3 — les liens de la page. Dernier recours, et le plus faillible : on
// devine qu'un <a> pointe vers une offre. Volontairement sévère, parce qu'un
// faux positif ici finit en candidature envoyée dans le vide.
// ---------------------------------------------------------------------------

/**
 * Un href qui ressemble à la fiche d'UNE offre, pas à la liste.
 *
 * Les segments intermédiaires sont autorisés : Vinted publie ses offres en
 * `/jobs/j/4938529101`, où le `j` du milieu est une lettre unique. Exiger un
 * identifiant directement après `/jobs/` rejetait ses 60 offres alors qu'elles
 * étaient bien dans la page. Il faut en revanche AU MOINS un segment après le
 * mot-clé, sinon le lien de menu « /jobs » passerait pour une offre.
 */
const HREF_OFFRE = /\/(jobs?|job[_-]?post\w*|careers?|positions?|openings?|vacanc\w*|offres?|emplois?)\/(?:[^/?#]+\/)*[^/?#]{3,}/i;

/** Mots qui trahissent un lien de navigation déguisé en offre. */
const TITRE_NON = /^(voir|tous|toutes|all|view|browse|open positions?|nos offres|en savoir plus|postuler|apply|learn more|see all|rejoignez|join us)\b/i;

/** Un intitulé tient-il debout ? Mêmes règles pour toutes les provenances. */
function titreAcceptable(v) {
  const s = txt(v);
  // Un intitulé d'un seul mot est presque toujours un lien de menu.
  if (s.length < 6 || s.length > TITRE_MAX || !s.includes(' ')) return false;
  return !TITRE_NON.test(s);
}

/**
 * Le meilleur intitulé disponible pour un lien, par ordre de fiabilité.
 *
 * 1. un titre balisé dans le lien ou sa carte — l'intitulé SEUL ;
 * 2. l'aria-label, souvent propre sur les cartes cliquables ;
 * 3. le texte du lien — mais il vaut ce qu'il vaut : quand le <a> enveloppe
 *    toute la carte il concatène tout (Lindy rendait « Software Engineer
 *    InternshipSan Francisco, OnsiteLearn more »), et quand le <a> n'est qu'un
 *    bouton il ne dit que « Apply now » (Factorial) ;
 * 4. la première ligne rendue de la carte parente. C'est ce qui sauve les
 *    pages sans aucune balise de titre — Factorial affiche ses intitulés dans
 *    un <div> stylé, donc aucun h1-h6 à trouver.
 *
 * On ne prend pas « le premier non vide » mais « le premier ACCEPTABLE » :
 * sinon « Apply now » gagnerait contre la ligne de carte qui, elle, porte le
 * vrai intitulé.
 */
function meilleurTitre(a) {
  const lignesConteneur = String(a?.conteneur ?? '')
    .split(SAUT_DE_LIGNE)
    .map((l) => txt(l))
    .filter(Boolean);
  for (const c of [a?.titre, a?.aria, a?.text, ...lignesConteneur]) {
    if (titreAcceptable(c)) return txt(c);
  }
  return '';
}

/**
 * @param {Array<{href?: string, text?: string, titre?: string, aria?: string}>} liens
 */
export function offresDepuisLiens(liens, { base, company } = {}) {
  const brut = [];
  for (const a of Array.isArray(liens) ? liens : []) {
    const href = txt(a?.href);
    // meilleurTitre a déjà appliqué titreAcceptable à chaque candidat : une
    // chaîne vide ici veut dire « aucune provenance ne donne d'intitulé ».
    const title = meilleurTitre(a);
    if (!href || !title) continue;
    if (!HREF_OFFRE.test(href)) continue;
    brut.push({ title, url: href, company, location: '' });
  }
  const offres = normalise(brut, { base, company });
  // Une seule offre trouvée par heuristique, c'est plus probablement un lien
  // isolé mal classé qu'une vraie page carrière. On exige une vraie liste.
  return offres.length >= 2 ? offres : [];
}

/**
 * Choisit la meilleure source disponible.
 *
 * On ne fusionne pas les trois : la même offre y apparaît sous des URLs
 * légèrement différentes (page publique vs endpoint d'API), le dédoublonnage
 * les laisserait passer et Linéo verrait des doublons. La source la plus sûre
 * qui donne un résultat non vide gagne, et on dit laquelle c'était.
 *
 * @returns {{jobs: Array, source: 'json-ld'|'api'|'liens'|'aucune'}}
 */
export function choisirMeilleureSource({ jsonLd = [], api = [], liens = [] } = {}) {
  if (jsonLd.length) return { jobs: jsonLd, source: 'json-ld' };
  if (api.length) return { jobs: api, source: 'api' };
  if (liens.length) return { jobs: liens, source: 'liens' };
  return { jobs: [], source: 'aucune' };
}
