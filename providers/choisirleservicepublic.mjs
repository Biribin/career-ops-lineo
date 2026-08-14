// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Choisir le Service Public provider — the French State's official job board
// (choisirleservicepublic.gouv.fr), successor to "Place de l'emploi public".
// French counterpart of scan-interamt.mjs (German public sector).
//
// SERVER-RENDERED HTML, DELIBERATELY. Checked 2026-08-14: the site is a
// WordPress front whose postings are NOT exposed by its REST API (`wp-json`
// declares no offer post type), its RSS route answers 500, and the result pages
// carry no JSON-LD. The listing markup is the only public contract available —
// so this provider mirrors radancy.mjs (HTML) rather than greenhouse.mjs (API).
//
// The markup is the French State design system (DSFR), which is stable and
// versioned: each posting is an `<h3 class="fr-card__title">` anchor followed by
// a `<ul class="fr-card__desc">` whose items are introduced by `sr-only` labels
// ("Localisation :", "Employeur :"). Those accessibility labels are what this
// parser anchors on — they are the least likely part of the page to change,
// because removing them would break screen readers.
//
// Configure via a `job_boards` entry with `provider: choisirleservicepublic`:
//
//   - name: Choisir le Service Public — IA / data
//     provider: choisirleservicepublic
//     choisirleservicepublic:
//       keywords: ["automatisation", "intelligence artificielle"]  # optional;
//                                 # falls back to config/profile.yml target_roles
//       pages: 2                # pages per keyword (20 postings/page, default 1)
//     enabled: true

import { decodeEntities } from './_html-entities.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

const BASE = 'https://choisirleservicepublic.gouv.fr';
const TRUSTED_HOST = 'choisirleservicepublic.gouv.fr';
/** 20 cards per result page, measured 2026-08-14. */
export const CARDS_PER_PAGE = 20;

/** @param {string} url */
function assertCspUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`choisirleservicepublic: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`choisirleservicepublic: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`choisirleservicepublic: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`);
  }
  return url;
}

function intInRange(val, def, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Turns a keyword into the path segment the site expects. The search lives in
 * the URL PATH (`/nos-offres/filtres/mot-cles/<slug>/`), not in a query string.
 *
 * WORDS ARE JOINED BY `+`, NOT BY `-`, and this is the whole subtlety of this
 * provider. Measured 2026-08-14 on the live site:
 *
 *   .../mot-cles/intelligence-artificielle/   ->  0 result
 *   .../mot-cles/intelligence+artificielle/   -> 20 results
 *
 * A hyphen is taken as part of one literal term, so the hyphenated form silently
 * returns an EMPTY page — HTTP 200, 4.5 MB, zero postings. That is exactly the
 * failure a provider must not ship with: it looks like "the board has nothing
 * for you today" and never like a bug.
 *
 * Diacritics are stripped for a stable, log-readable URL. Verified harmless:
 * `securite` and the percent-encoded `sécurité` both return results.
 *
 * @param {string} keyword
 * @returns {string}
 */
export function keywordSlug(keyword) {
  return String(keyword ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '+')
    .replace(/^\++|\++$/g, '');
}

/**
 * The result-page URL for one keyword and one 1-based page number.
 *
 * @param {string} keyword
 * @param {number} [page]
 * @returns {string}
 */
export function searchUrl(keyword, page = 1) {
  const slug = keywordSlug(keyword);
  if (!slug) throw new Error('choisirleservicepublic: empty keyword');
  const suffix = page > 1 ? `page/${Math.trunc(page)}/` : '';
  return `${BASE}/nos-offres/filtres/mot-cles/${slug}/${suffix}`;
}

const clean = (v) => decodeEntities(String(v ?? '')).replace(/\s+/g, ' ').trim();

/** Strip tags from one card fragment, keeping the text nodes readable. */
function textOf(html) {
  return clean(String(html ?? '').replace(/<[^>]*>/g, ' '));
}

/**
 * Read one labelled item of a card's `<ul class="fr-card__desc">`.
 *
 * The label lives in a `<span class="sr-only">` and the value follows it as
 * plain text (plus, for a location, a `<strong>(92)</strong>` department code
 * that is kept — a French reader uses it, and location_filter matches on it).
 *
 * @param {string} card
 * @param {string} label - e.g. "Employeur"
 * @returns {string}
 */
export function cardField(card, label) {
  const re = new RegExp(`<span class="sr-only">\\s*${label}\\s*:\\s*</span>([\\s\\S]*?)</li>`, 'i');
  const m = String(card ?? '').match(re);
  return m ? textOf(m[1]) : '';
}

/** French month names, to read "En ligne depuis le 06 août 2026". */
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * Publication date, as epoch ms, from the card's "En ligne depuis le …" line.
 * Returns undefined when absent or unreadable — never a guessed date, because
 * postedAt feeds freshness decisions downstream.
 *
 * @param {string} card
 * @returns {number|undefined}
 */
export function cardPostedAt(card) {
  const m = clean(card).match(/En ligne depuis le\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]+)\s+(\d{4})/i);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return undefined;
  const ms = Date.UTC(Number(m[3]), month, Number(m[1]));
  return Number.isNaN(ms) ? undefined : ms;
}

/** Keep only absolute HTTPS posting links on the trusted host. */
function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value).trim(), BASE);
    if (parsed.protocol !== 'https:') return '';
    const host = parsed.hostname.toLowerCase();
    if (host !== TRUSTED_HOST) return '';
    if (!parsed.pathname.startsWith('/offre-emploi/')) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Parse one result page. Exported for unit testing — the fixture in
 * tests/providers/choisirleservicepublic.test.mjs is a trimmed copy of real
 * markup, so a site redesign fails the test rather than silently returning zero
 * jobs in production.
 *
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string, postedAt?: number}>}
 */
export function parseCspPage(html) {
  if (typeof html !== 'string') return [];
  // One chunk per card: from a title marker to the next one (or end of page).
  const chunks = html.split(/<h3[^>]*class="[^"]*fr-card__title[^"]*"[^>]*>/i).slice(1);
  const jobs = [];
  for (const chunk of chunks) {
    const anchor = chunk.match(/<a\b[\s\S]*?>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const href = (anchor[0].match(/href="([^"]+)"/i) || [])[1];
    const url = cleanUrl(href);
    if (!url) continue;
    const title = textOf(anchor[1]);
    if (!title) continue;
    jobs.push({
      title,
      url,
      // "Employeur" is the hiring administration (a ministry, a hospital, a
      // local authority). Absent on a few cards; left empty rather than filled
      // with the board's name, which would claim the State is the employer.
      company: cardField(chunk, 'Employeur'),
      location: cardField(chunk, 'Localisation'),
      ...(cardPostedAt(chunk) !== undefined ? { postedAt: cardPostedAt(chunk) } : {}),
    });
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'choisirleservicepublic',

  detect(entry) {
    return entry?.provider === 'choisirleservicepublic' ? { url: `${BASE}/nos-offres/` } : null;
  },

  async fetch(entry, ctx) {
    const cfg = (entry && entry.choisirleservicepublic) || {};
    const declared = Array.isArray(cfg.keywords)
      ? cfg.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim())
      : [];
    const keywords = declared.length ? declared : resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(
        `choisirleservicepublic: entry "${entry.name || '(unnamed)'}" has no choisirleservicepublic.keywords[] and config/profile.yml declares no target_roles`,
      );
    }
    const configuredPages = intInRange(cfg.pages, 1, 1, 10);
    const maxPages = Number.isFinite(Number(ctx.maxPages)) ? Math.max(1, Number(ctx.maxPages)) : configuredPages;

    const byUrl = new Map();
    const errors = [];
    let succeeded = 0;

    for (const kw of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        let html;
        const url = assertCspUrl(searchUrl(kw, page));
        try {
          // A result page weighs ~4.5 MB (measured): the timeout is raised well
          // above the 10s default, or every run would abort mid-body.
          html = await ctx.fetchText(url, { redirect: 'error', timeoutMs: 30_000 });
        } catch (err) {
          errors.push(`"${kw}" (page ${page}): ${(err && err.message) || err}`);
          break;
        }
        if (page === 1) succeeded++;
        const jobs = parseCspPage(html);
        for (const job of jobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
        // A short page is the last page.
        if (jobs.length < CARDS_PER_PAGE) break;
        if (typeof ctx.sleep === 'function') await ctx.sleep(500);
      }
    }

    if (succeeded === 0 && errors.length) {
      throw new Error(`choisirleservicepublic: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...byUrl.values()];
  },
};
