// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
//
// WelcomeKit — Welcome to the Jungle's legacy ATS, still serving the public
// careers board of many French employers at `<slug>.welcomekit.co`.
//
// WHY THIS PROVIDER EXISTS
// -----------------------
// It was the hole whole employers fell through. Slug discovery probed only
// Greenhouse / Ashby / Lever / SmartRecruiters — the US startup stack — so
// "no slug variant resolved" was the mechanical answer for a French employer
// whose board runs here (observed 2026-08-11 on a tracked company: board alive,
// 40 openings, invisible to career-ops).
//
// The board is SERVER-RENDERED: there is no JSON API (verified 2026-08-12 —
// `/jobs.json` and `/api/v1/jobs` answer 404, and `?format=json` advertises
// `application/json` while serving HTML, so do not trust its content type), but
// the page carries stable, complete markup:
//
//   <li class='jobs-list-item' data-department='38206' data-office='28372'>
//     <a class="jobs-list-item-link" href="/jobs/my-role_toulouse">
//       <h3 class='jobs-list-item-title'> My role </h3>
//       <ul class='jobs-list-item-details'>
//         <li class='jobs-list-item-contract-type'>…CDI</li>
//         <li class='jobs-list-item-office'>…Toulouse</li>
//
// ONE REQUEST: the page lists every posting, with no pagination (no
// `pagination` / `page=` / load-more marker anywhere in the document). A
// 40-posting board therefore arrives in a single GET, which also keeps the
// health-check's request budget intact.
//
// The contract type (CDI, internship…) is present in the markup but deliberately
// NOT surfaced: the normalized `Job` shape has no field for it, and inventing one
// that nothing consumes would be a schema change for free.

import { decodeEntities } from './_html-entities.mjs';

const HOST_SUFFIX = '.welcomekit.co';

/**
 * The text of an HTML fragment: tags stripped, entities decoded, whitespace
 * collapsed. The board's markup puts an `<i>` icon before every value, so
 * stripping tags is mandatory before reading a location.
 *
 * @param {string} fragment
 * @returns {string}
 */
function textOf(fragment) {
  return decodeEntities(String(fragment ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The value of a `<li class='jobs-list-item-XXX'>` inside a posting block.
 *
 * Attribute quotes are accepted single OR double: the board mixes both in the
 * same document (`class='jobs-list-item'` but `class="jobs-list-item-link"`), so
 * pinning one style breaks on the other.
 *
 * @param {string} block
 * @param {string} suffix - Class suffix, e.g. 'office'.
 * @returns {string}
 */
function detail(block, suffix) {
  const re = new RegExp(`<li[^>]*class=['"]jobs-list-item-${suffix}['"][^>]*>([\\s\\S]*?)<\\/li>`, 'i');
  const m = block.match(re);
  return m ? textOf(m[1]) : '';
}

/**
 * Parse a WelcomeKit board into normalized Job objects.
 *
 * Exported for offline unit testing; `fetch()` only wraps it around an HTTP GET.
 *
 * @param {string} html - The board document.
 * @param {string} origin - The board origin (`https://slug.welcomekit.co`), used
 *   to absolutize relative links — the URL is the scanner's dedup key, so a
 *   relative one would be unusable.
 * @param {string} [company] - Name to carry on every posting.
 * @returns {Job[]}
 */
export function parseWelcomekitBoard(html, origin, company = '') {
  const doc = String(html ?? '');
  // Split on `<li class='jobs-list-item'>` boundaries. The first chunk is the
  // page header: it carries no posting.
  const chunks = doc.split(/<li[^>]*class=['"]jobs-list-item['"]/i);
  const jobs = [];
  const seen = new Set();

  for (let i = 1; i < chunks.length; i++) {
    const block = chunks[i];
    const link = block.match(/<a[^>]*class=['"]jobs-list-item-link['"][^>]*href=['"]([^'"]+)['"]/i)
      || block.match(/<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"]jobs-list-item-link['"]/i);
    const heading = block.match(/<h3[^>]*class=['"]jobs-list-item-title['"][^>]*>([\s\S]*?)<\/h3>/i);
    if (!link || !heading) continue;

    const title = textOf(heading[1]);
    if (!title) continue;

    let url;
    try {
      url = new URL(decodeEntities(link[1]), origin).toString();
    } catch {
      continue; // unusable href: a posting with no URL cannot be deduped
    }
    // The same role can be listed under two departments. The scanner's dedup key
    // is the URL, so apply it here already.
    if (seen.has(url)) continue;
    seen.add(url);

    jobs.push({
      title,
      url,
      company,
      location: detail(block, 'office'),
    });
  }

  return jobs;
}

/**
 * The board origin for an entry, when it is legitimate.
 *
 * Pinned to `*.welcomekit.co` over https, the way every provider pins its host:
 * `careers_url` is not always hand-written (entries are also created from offer
 * URLs coming off France Travail), so the host must be verified, not assumed.
 *
 * @param {{careers_url?: string, api?: string, provider?: string, name?: string}} entry
 * @returns {string|null}
 */
export function boardOrigin(entry) {
  for (const raw of [entry?.api, entry?.careers_url]) {
    if (typeof raw !== 'string' || !raw) continue;
    let u;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:') continue;
    const h = u.hostname.toLowerCase();
    if (h.endsWith(HOST_SUFFIX) && h.length > HOST_SUFFIX.length) return `https://${h}/`;
  }
  return null;
}

/** @type {Provider} */
export default {
  id: 'welcomekit',

  detect(entry) {
    const url = boardOrigin(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const url = boardOrigin(entry);
    if (!url) throw new Error(`welcomekit: careers_url is not a *.welcomekit.co board for ${entry?.name ?? '(unnamed)'}`);
    const html = await ctx.fetchText(url);
    return parseWelcomekitBoard(html, url, typeof entry?.name === 'string' ? entry.name : '');
  },
};
