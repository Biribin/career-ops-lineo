// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// HelloWork provider — France's largest generalist private-sector job board
// (`hellowork.com`, ex-RegionsJob). It aggregates listings from employers and
// agencies that never reach France Travail nor the APEC.
//
// SERVER-RENDERED HTML. Checked 2026-08-14: the search page ships three
// `application/ld+json` blocks (WebSite, Organization, breadcrumb) and NOT ONE
// `JobPosting`, so there is no structured feed to read — the result anchors are
// the only public contract.
//
// What makes those anchors usable rather than fragile: HelloWork writes the whole
// posting summary into the anchor's own accessibility attributes —
//
//   <a data-cy="offerTitle" href="/fr-fr/emplois/80025261.html"
//      title="Testeur Automatisation H/F - MNT Mutuelle Nationale Territoriale"
//      aria-label="Voir offre de Testeur Automatisation H/F à Paris 15e - 75,
//                  chez MNT Mutuelle Nationale Territoriale, pour un CDI, …">
//
// so title, employer and location come from one element instead of from the
// layout around it. Layout classes are Tailwind-generated and change with every
// build; `data-cy` (their own test hook) and `aria-label` do not.
//
// The employer is read from `aria-label` (", chez X, pour …") and only then from
// the `title` suffix, because a title that itself contains " - " would otherwise
// be split in the wrong place — "Testeur Automatisation H/F - MNT" is ambiguous,
// ", chez MNT Mutuelle Nationale Territoriale," is not.
//
// Configure via a `job_boards` entry with `provider: hellowork`:
//
//   - name: HelloWork — automatisation / IA
//     provider: hellowork
//     hellowork:
//       keywords: ["automatisation", "data engineer"]  # optional; falls back to
//                                 # config/profile.yml target_roles
//       pages: 2                # pages per keyword (30 postings/page, default 1)
//     enabled: true

import { decodeEntities } from './_html-entities.mjs';
import { resolveProfileKeywords } from './_profile-keywords.mjs';

const BASE = 'https://www.hellowork.com';
const TRUSTED_HOST = 'www.hellowork.com';
/** 30 result anchors per page, measured 2026-08-14. */
export const RESULTS_PER_PAGE = 30;

/** @param {string} url */
function assertHelloworkUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`hellowork: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`hellowork: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`hellowork: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`);
  }
  return url;
}

function intInRange(val, def, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Search URL for one keyword and one 1-based page.
 *
 * @param {string} keyword
 * @param {number} [page]
 */
export function searchUrl(keyword, page = 1) {
  const k = String(keyword ?? '').trim();
  if (!k) throw new Error('hellowork: empty keyword');
  const params = new URLSearchParams({ k });
  if (page > 1) params.set('p', String(Math.trunc(page)));
  return `${BASE}/fr-fr/emploi/recherche.html?${params.toString()}`;
}

const clean = (v) => decodeEntities(String(v ?? '')).replace(/\s+/g, ' ').trim();

/** Keep only absolute HTTPS posting links on the trusted host. */
function cleanUrl(value) {
  if (!value) return '';
  try {
    const parsed = new URL(String(value).trim(), BASE);
    if (parsed.protocol !== 'https:') return '';
    if (parsed.hostname.toLowerCase() !== TRUSTED_HOST) return '';
    if (!/^\/[a-z-]+\/emplois\//i.test(parsed.pathname)) return '';
    parsed.hash = '';
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Pull title / company / location out of one result anchor's attributes.
 *
 * Returns null when the anchor carries no usable link or title — a page whose
 * markup changed must yield nothing rather than half-filled jobs.
 *
 * @param {string} tag - the raw `<a …>` open tag
 * @returns {({title: string, url: string, company: string, location: string}) | null}
 */
export function parseHelloworkAnchor(tag) {
  const raw = String(tag ?? '');
  const url = cleanUrl((raw.match(/href="([^"]*)"/i) || [])[1]);
  if (!url) return null;
  const titleAttr = clean((raw.match(/title="([^"]*)"/i) || [])[1]);
  const aria = clean((raw.match(/aria-label="([^"]*)"/i) || [])[1]);

  // ", chez <employer>, pour …" — the unambiguous form. The trailing clause is
  // optional: some postings carry no contract type.
  const company = clean((aria.match(/,\s*chez\s+(.+?)(?:,\s*(?:pour|avec|en)\s|$)/i) || [])[1]);
  // " à <city> - <dept>, chez …"
  const location = clean((aria.match(/\s+à\s+(.+?),\s*chez\s/i) || [])[1]);

  // The `title` attribute is "<title> - <company>". Only strip that suffix when
  // the employer is known from the aria-label, never by guessing at the last
  // " - " (French titles contain plenty of them).
  let title = titleAttr;
  if (company && title.toLowerCase().endsWith(` - ${company.toLowerCase()}`)) {
    title = clean(title.slice(0, title.length - company.length - 3));
  }
  if (!title) title = clean((aria.match(/^Voir offre de\s+(.+?)(?:\s+à\s|,\s*chez\s|$)/i) || [])[1]);
  if (!title) return null;

  return { title, url, company, location };
}

/**
 * Parse one search-result page. Exported for unit testing, with a fixture copied
 * from real markup so a redesign fails the test instead of silently returning
 * zero jobs in production.
 *
 * @param {string} html
 * @returns {Array<{title: string, url: string, company: string, location: string}>}
 */
export function parseHelloworkPage(html) {
  if (typeof html !== 'string') return [];
  const jobs = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a\b[^>]*data-cy="offerTitle"[^>]*>/gi)) {
    const job = parseHelloworkAnchor(m[0]);
    if (!job || seen.has(job.url)) continue;
    seen.add(job.url);
    jobs.push(job);
  }
  return jobs;
}

/** @type {Provider} */
export default {
  id: 'hellowork',

  detect(entry) {
    return entry?.provider === 'hellowork' ? { url: `${BASE}/fr-fr/emploi/recherche.html` } : null;
  },

  async fetch(entry, ctx) {
    const cfg = (entry && entry.hellowork) || {};
    const declared = Array.isArray(cfg.keywords)
      ? cfg.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim())
      : [];
    const keywords = declared.length ? declared : resolveProfileKeywords();
    if (!keywords.length) {
      throw new Error(
        `hellowork: entry "${entry.name || '(unnamed)'}" has no hellowork.keywords[] and config/profile.yml declares no target_roles`,
      );
    }
    const configuredPages = intInRange(cfg.pages, 1, 1, 10);
    const maxPages = Number.isFinite(Number(ctx.maxPages)) ? Math.max(1, Number(ctx.maxPages)) : configuredPages;

    const byUrl = new Map();
    const errors = [];
    let succeeded = 0;

    for (const kw of keywords) {
      for (let page = 1; page <= maxPages; page++) {
        const url = assertHelloworkUrl(searchUrl(kw, page));
        let html;
        try {
          // ~600 KB per page (measured), hence the raised timeout.
          html = await ctx.fetchText(url, { redirect: 'error', timeoutMs: 25_000 });
        } catch (err) {
          errors.push(`"${kw}" (page ${page}): ${(err && err.message) || err}`);
          break;
        }
        if (page === 1) succeeded++;
        const jobs = parseHelloworkPage(html);
        for (const job of jobs) if (!byUrl.has(job.url)) byUrl.set(job.url, job);
        if (jobs.length < RESULTS_PER_PAGE) break;
        if (typeof ctx.sleep === 'function') await ctx.sleep(500);
      }
    }

    if (succeeded === 0 && errors.length) {
      throw new Error(`hellowork: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...byUrl.values()];
  },
};
