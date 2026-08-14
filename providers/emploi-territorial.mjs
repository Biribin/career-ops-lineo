// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Emploi Territorial provider — the official board of French local government
// (`emploi-territorial.fr`), run by the Centres de Gestion. It carries the
// postings of communes, départements, régions and their agencies, which appear
// neither on France Travail nor on private boards.
//
// Public RSS feed, no auth, so it is parsed in-process with the same tiny tag
// extractor as larajobs.mjs rather than adding an XML dependency.
//
// KNOWN LIMIT, MEASURED — the feed is NOT searchable. Verified 2026-08-14:
// `?motcle=informatique` and `?filtre=informatique` both return the SAME 100
// items as the bare feed, i.e. the latest 100 postings across every profession
// (nurses, gardeners, IT). That is why no `keywords:` option exists here: it
// would be a lie. Relevance is left to scan.mjs's title_filter, and the honest
// consequence is that a run only sees what was published recently — schedule it
// often rather than expecting a keyword to reach deeper.
//
// Wire in via a `job_boards` entry with `provider: emploi-territorial`.

const FEED_URL = 'https://www.emploi-territorial.fr/rss';
const TRUSTED_HOST = 'www.emploi-territorial.fr';

/** @param {string} url */
function assertEtUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`emploi-territorial: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`emploi-territorial: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`emploi-territorial: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`);
  }
  return url;
}

function fromCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

// Same decoder as larajobs.mjs: numeric forms first, `&amp;` LAST so a literal
// "&amp;lt;" yields "&lt;" instead of over-decoding to "<".
function decodeXmlEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractText(inner) {
  const cdata = inner.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) return cdata[1].trim();
  return decodeXmlEntities(inner).trim();
}

/** Text of the first <tag>…</tag> in a block; '' when absent. */
function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? extractText(m[1]) : '';
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Value of one `<category domain="emploi-territorial:<name>">`.
 *
 * Preferred over the `<div class="…">` blocks of the description: the categories
 * are structured data, the divs are presentation. Both are read (category
 * first, div as fallback) because a few items ship one and not the other.
 *
 * @param {string} item
 * @param {string} name
 */
export function categoryValue(item, name) {
  const m = String(item ?? '').match(
    new RegExp(`<category[^>]*domain="emploi-territorial:${name}"[^>]*>([\\s\\S]*?)</category>`, 'i'),
  );
  return m ? clean(extractText(m[1])) : '';
}

/**
 * Value of one labelled `<div class="<name>">` of the description block.
 *
 * @param {string} item
 * @param {string} name
 */
export function descField(item, name) {
  const m = String(item ?? '').match(new RegExp(`<div class="${name}">([\\s\\S]*?)</div>`, 'i'));
  if (!m) return '';
  return clean(decodeXmlEntities(m[1]).replace(/<[^>]*>/g, ' ').replace(/^[^:]*:\s*/, ''));
}

/**
 * The French department code, read from the posting's own identifier.
 *
 * WHY THIS EXISTS. The feed names the city and nothing else — "Melun", "Gramat",
 * "La Roche-sur-Yon". scan.mjs's `location_filter.allow` is a keyword whitelist,
 * so a bare city name matches nothing a user can reasonably list: measured
 * 2026-08-14, 23 postings a day passed the title filter and were then dropped on
 * location, with no keyword list able to rescue them.
 *
 * The identifier carries the answer. Every posting is `O<DDD><date><seq>` (in the
 * guid, and lowercased in the link), where `<DDD>` is the zero-padded department:
 * verified on 100/100 items of a live feed — 41 distinct departments, every one
 * `0XX`, and the cross-checks are exact (072 → Le Mans/Sarthe, 038 →
 * Bouvesse-Quirieu/Isère, 093 → Bobigny/Seine-Saint-Denis).
 *
 * Metropolitan codes drop ONLY the padding zero ("085" → "85", "009" → "09").
 * Stripping every leading zero would be the bug this comment exists to prevent:
 * it turns Ariège ("009") into "9", which is not how a French code is ever
 * written and matches no whitelist entry. Caught on the live feed — 8 of 100
 * items are 002/006/009 (Aisne, Alpes-Maritimes, Ariège).
 *
 * Overseas codes (971-976) keep their three digits. Corsica, if it ever appears
 * as "020", yields "20" — the informal form, NOT the official 2A/2B, so a
 * whitelist wanting Corsica needs "20" too.
 *
 * Returns '' rather than a guess when the identifier is missing or malformed.
 *
 * @param {string} identifiant  guid or link of the item
 * @returns {string}
 */
export function departementDepuisId(identifiant) {
  const m = String(identifiant ?? '').match(/[:/]o(\d{3})\d{6,}/i);
  if (!m) return '';
  const brut = m[1];
  if (brut.startsWith('9')) return brut; // 971-976: outre-mer, trois chiffres
  // Everything metropolitan is zero-padded to three digits, so the department is
  // the last two — never a re-derived number.
  if (!brut.startsWith('0')) return '';
  const court = brut.slice(1);
  return court === '00' ? '' : court;
}

/** `Ville (DD)` — the shape the other French providers emit, so one
 *  location_filter covers them all. Either half may be missing. */
export function composeLieu(ville, departement) {
  const v = clean(ville);
  const d = clean(departement);
  if (v && d) return `${v} (${d})`;
  if (v) return v;
  return d ? `(${d})` : '';
}

// NaN-safe Date.parse — `|| undefined` would also discard a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Keep only absolute HTTPS posting links on the trusted host, and DROP the
 * `?mtm_campaign=rss` analytics parameter the feed appends.
 *
 * That parameter is why stripping matters: the URL is the scanner's dedup key,
 * so the same posting reached from the feed and from a page scan must produce
 * the same string, or it would be treated as two jobs.
 */
function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value).trim());
    if (parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase();
    if (host !== TRUSTED_HOST && !host.endsWith(`.${TRUSTED_HOST}`)) return '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Parse the public RSS feed. Exported for unit testing.
 *
 * No `description` is produced, on purpose: what the feed calls a description is
 * a metadata block (Métier(s), Grade(s), dates), not the advert body. Passing it
 * off as a description would feed scan.mjs's content_filter with boilerplate and
 * make it match on words the employer never wrote.
 *
 * @param {string} xml
 * @param {string} [defaultCompany]
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseEtFeed(xml, defaultCompany = 'Emploi Territorial') {
  if (typeof xml !== 'string') return [];
  const fallback = clean(defaultCompany) || 'Emploi Territorial';
  const jobs = [];
  for (const item of xml.match(/<item\b[^>]*>[\s\S]*?<\/item>/gi) || []) {
    const url = cleanUrl(tagText(item, 'link'));
    if (!url) continue;
    const title = clean(tagText(item, 'title'));
    if (!title) continue;
    const postedAt = toEpochMs(tagText(item, 'pubDate'));
    // The department comes from the identifier, and the guid is tried first: it
    // carries the id in its canonical uppercase form, while the link only holds a
    // lowercased copy inside a slug.
    const departement =
      departementDepuisId(tagText(item, 'guid')) || departementDepuisId(tagText(item, 'link'));
    /** @type {any} */
    const job = {
      title,
      url,
      // The hiring authority, not the board: `collectivite` is the structured
      // field, `employeur` the presentational one.
      company: categoryValue(item, 'collectivite') || descField(item, 'employeur') || fallback,
      // City alone matched no reasonable whitelist keyword — see
      // departementDepuisId for the 23 postings a day that cost.
      location: composeLieu(categoryValue(item, 'secteurgeo') || descField(item, 'lieutravail'), departement),
    };
    if (postedAt !== undefined) job.postedAt = postedAt;
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'emploi-territorial',

  detect(entry) {
    return entry?.provider === 'emploi-territorial' ? { url: FEED_URL } : null;
  },

  async fetch(entry, ctx) {
    const feedUrl = assertEtUrl(FEED_URL);
    // redirect:'error' prevents SSRF via server-side redirects; combined with
    // assertEtUrl it keeps the request pinned to emploi-territorial.fr.
    // The feed weighs ~270 KB (measured), hence the raised timeout.
    const text = await ctx.fetchText(feedUrl, { redirect: 'error', timeoutMs: 20_000 });
    return parseEtFeed(text, entry?.name);
  },
};
