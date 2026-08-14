// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Flatchr provider — French ATS (Boulogne-Billancourt), hosted career sites at
// `careers.flatchr.io/<lang>/company/<slug>/`. One entry per employer, like
// greenhouse/lever/ashby.
//
// NO API CALL AT ALL, and that is the interesting part. The career site is a
// Next.js app, so its HTML embeds the page props in a `__NEXT_DATA__` script
// tag — and those props already contain every posting with its FULL text. The
// employer-side API (`api.flatchr.io`) needs a token; this page does not need
// anything. One GET, no auth, no second request per job.
//
// Measured 2026-08-14: `props.data.items[].vacancy` carries title, slug,
// description, contract type, a structured Google-Places-style address, and the
// salary range. `props.config.company` carries the employer name and slug.
//
// ⚠️ TWO TRAPS, both verified live and both mattering to the scanner:
//
//  1. The URL MUST end with a slash. `/fr/company/<slug>` answers 308 to
//     `/fr/company/<slug>/`, and providers pass `redirect: 'error'` (anti-SSRF),
//     so the un-slashed form fails the fetch instead of following the redirect.
//
//  2. The per-job route is a CATCH-ALL: a made-up vacancy slug answers 200, not
//     404 (unlike Taleez, whose apply route validates the slug). Nothing here
//     depends on that — slugs come from the payload, so they are real by
//     construction — but `scan.mjs --verify` and check-liveness.mjs cannot use a
//     404 to detect an expired Flatchr posting. Liveness on this source has to
//     come from the posting disappearing from the payload, not from its URL
//     breaking.

import { decodeEntities } from './_html-entities.mjs';

const CAREERS_HOST = 'careers.flatchr.io';
const DEFAULT_LANG = 'fr';

const txt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Reads `<lang>` and `<slug>` out of a configured careers URL.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {{lang: string, slug: string}|null}
 */
export function parseCareersUrl(entry) {
  const raw = entry?.api || entry?.careers_url || '';
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname.toLowerCase() !== CAREERS_HOST) return null;
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('company');
  if (i === -1 || !parts[i + 1]) return null;
  const slug = parts[i + 1];
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return null;
  // The language segment precedes `company` when present; anything else falls
  // back to the default rather than being guessed at.
  const lang = i > 0 && /^[a-z]{2}$/.test(parts[i - 1]) ? parts[i - 1] : DEFAULT_LANG;
  return { lang, slug };
}

/** The company page URL — WITH the trailing slash (see trap 1 in the header). */
export function companyUrl({ lang, slug }) {
  return `https://${CAREERS_HOST}/${lang}/company/${slug}/`;
}

/** The canonical per-posting URL, the one the site itself links to. */
export function vacancyUrl({ lang, slug }, vacancySlug) {
  return `https://${CAREERS_HOST}/${lang}/company/${slug}/vacancy/${vacancySlug}/`;
}

/** @param {string} url */
function assertFlatchrUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`flatchr: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`flatchr: URL must use HTTPS: ${url}`);
  if (parsed.hostname.toLowerCase() !== CAREERS_HOST) {
    throw new Error(`flatchr: untrusted hostname "${parsed.hostname}" - must be ${CAREERS_HOST}`);
  }
  return url;
}

/**
 * Extracts and parses the `__NEXT_DATA__` payload of a Next.js page.
 *
 * Exported for unit testing. Returns null rather than throwing: a redesigned
 * page must yield zero jobs, not crash a whole scan.
 *
 * @param {string} html
 * @returns {any|null}
 */
export function parseNextData(html) {
  const m = String(html ?? '').match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

/**
 * Flattens Flatchr's structured address into `city (dept)`.
 *
 * The department code is derived from the postal code's first two digits, which
 * is exactly how a French reader reads it, and it matches the shape the other
 * French providers emit ("Paris (75)") so one location_filter covers them all.
 * A non-French country is appended instead, because a department code would be
 * meaningless there.
 *
 * @param {any} address
 * @returns {string}
 */
export function buildLocation(address) {
  if (!address || typeof address !== 'object') return '';
  const city = txt(address.locality);
  const country = txt(address.country);
  const region = txt(address.administrative_area_level_1);
  const cp = txt(address.postal_code);
  const etranger = country && !/^(france|fr)$/i.test(country);
  if (etranger) return [city || region, country].filter(Boolean).join(', ');
  const dept = /^\d{2,3}/.test(cp) ? cp.slice(0, 2) : '';
  const base = city || region;
  if (!base) return dept ? `(${dept})` : '';
  return dept ? `${base} (${dept})` : base;
}

/**
 * `remote` is an enum whose full range we have NOT observed (one live sample:
 * `"notime"`, meaning no remote work). So the rule is deliberately narrow: tag
 * only values that unambiguously say remote, and never tag on an unknown one.
 *
 * Tagging wrongly is the costly direction — scan.mjs's location_filter rescues a
 * "Télétravail" posting through always_allow, so a false tag smuggles an
 * office-bound job past the distance check.
 *
 * @param {unknown} remote
 * @returns {boolean}
 */
export function estTeletravail(remote) {
  return /^(partial|partiel|full|fulltime|total|hybrid|hybride)$/i.test(txt(remote));
}

/** Plain text out of the payload's HTML description. */
function texteBrut(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes one `items[]` entry into a Job, or null when it is not an
 * advertisable posting.
 *
 * @param {any} item
 * @param {{lang: string, slug: string}} cible
 * @param {string} [fallbackCompany]
 * @returns {({title: string, url: string, company: string, location: string, description: string, postedAt?: number}) | null}
 */
export function normalizeFlatchrItem(item, cible, fallbackCompany = 'Flatchr') {
  const it = item ?? {};
  // An unpublished item is a draft the employer has not opened yet.
  if (it.published === false) return null;
  const v = it.vacancy;
  if (!v || typeof v !== 'object') return null;
  const title = txt(v.title);
  const slug = txt(v.slug);
  if (!title || !slug) return null;
  // The slug is concatenated into a URL. Dots are allowed because real slugs
  // carry them, which is exactly why the dot SEGMENTS have to be excluded
  // explicitly: a bare `..` would otherwise build a URL that climbs a level.
  if (!/^[A-Za-z0-9._~-]+$/.test(slug) || slug === '.' || slug === '..' || slug.includes('..')) return null;

  let location = buildLocation(v.address);
  if (estTeletravail(v.remote)) location = location ? `${location} · Télétravail` : 'Télétravail';

  const date = Date.parse(txt(v.start_date) || txt(v.created_at) || '');
  /** @type {any} */
  const job = {
    title,
    url: vacancyUrl(cible, slug),
    company: fallbackCompany,
    location,
    // Free in the same payload — no extra request, so content_filter works.
    description: texteBrut(v.description),
  };
  if (Number.isFinite(date)) job.postedAt = date;
  return job;
}

/** @type {Provider} */
export default {
  id: 'flatchr',

  detect(entry) {
    const cible = parseCareersUrl(entry);
    return cible ? { url: companyUrl(cible) } : null;
  },

  async fetch(entry, ctx) {
    const cible = parseCareersUrl(entry);
    if (!cible) throw new Error(`flatchr: cannot derive the career-site URL for ${entry?.name || '(unnamed)'}`);
    const url = assertFlatchrUrl(companyUrl(cible));
    // redirect:'error' prevents SSRF via a server-side redirect — hence the
    // trailing slash above, which is what keeps this request off the 308.
    const html = await ctx.fetchText(url, { redirect: 'error', timeoutMs: 20_000 });
    const data = parseNextData(html);
    const items = Array.isArray(data?.props?.data?.items) ? data.props.data.items : [];
    const company = txt(data?.props?.config?.company?.name) || txt(entry?.name) || 'Flatchr';
    const byUrl = new Map();
    for (const item of items) {
      const job = normalizeFlatchrItem(item, cible, company);
      if (job && !byUrl.has(job.url)) byUrl.set(job.url, job);
    }
    return [...byUrl.values()];
  },
};
