// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// DigitalRecruiters / Cegid Talent Acquisition provider — the French ATS behind a
// large share of French corporate career sites. DigitalRecruiters was absorbed by
// Cegid (`digitalrecruiters.com/clients` now 301s to cegid.com), so one provider
// covers both product names.
//
// ONE ENDPOINT COVERS EVERY TENANT, which is what makes this provider unusual:
//
//   POST https://api.digitalrecruiters.com/public/v1/careers-site/job-ads
//        ?domainName=<careers host>&limit=<n>&page=<n>&locale=fr_FR
//        body: {}
//
// The tenant is a QUERY PARAMETER, not a host or a slug — so any DR/Cegid career
// site is reachable by passing its own domain. Public, no key, no session.
//
// HOW IT WAS FOUND, because none of it is guessable (2026-08-14, on
// jobs.cegid.com):
//   - the career site is a Nuxt app; its HTML has no JobPosting JSON-LD;
//   - `/api/v1/...` on the career host answers a JSON 404 — that is the site's
//     own Nitro handler, not the ATS API;
//   - the client bundle exposes `httpClient.post('/careers-site/job-ads?…')` and
//     the page config names TWO bases: `apiBaseURL` (…/careers/v1) and
//     `commonApiBaseUrl` (…/public/v1). Only the SECOND one serves this route —
//     `/careers/v1/careers-site/job-ads` answers « route not found ».
//   - `locale` is validated and `fr` is REJECTED: it wants `fr_FR` (or `en_GB`).
//     A wrong locale yields a 400 whose body names the field, which is how the
//     format was found.
//
// ⚠️ THREE LIMITS, all measured, all worth knowing before trusting this source:
//
//  1. NO PUBLISH DATE in the payload. `postedAt` is therefore never set, so
//     freshness filters (`max_posting_age_days`, `--posted-after`) cannot act on
//     these postings — they pass those filters by the "never penalize missing
//     data" rule.
//  2. NO EMPLOYER NAME either: the payload carries a `brand_id`, not a label. The
//     company comes from the portals.yml entry name, which is correct for a
//     single-employer career site and approximate for a multi-brand one.
//  3. A DEAD POSTING REDIRECTS (302 to the listing) instead of answering 404, so
//     `scan.mjs --verify` and check-liveness.mjs cannot use a 404 to detect an
//     expired posting on this source.
//
// Explicit-only by design: a tenant serves the career site from its OWN domain
// (jobs.cegid.com, recrutement.<company>.fr…), so there is no host pattern to
// auto-detect. Configure with:
//
//   - name: Cegid
//     careers_url: https://jobs.cegid.com/fr/annonces
//     provider: digitalrecruiters
//     digitalrecruiters:
//       locale: fr_FR      # API locale (fr_FR default; en_GB also accepted)
//       lang: fr           # path segment of the job URLs (default: from careers_url)
//       limit: 100         # postings per request (1–200, default 100)
//       pages: 5           # max pages (default 5; the loop stops on `count`)
//     enabled: true

const API_URL = 'https://api.digitalrecruiters.com/public/v1/careers-site/job-ads';
const API_HOST = 'api.digitalrecruiters.com';
const DEFAULT_LOCALE = 'fr_FR';
const DEFAULT_LANG = 'fr';

const txt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * One safe path segment: URL-ish characters only, and never a dot segment.
 *
 * The `..` exclusions are not theatre. The character class allows dots (real
 * slugs contain them), so a bare `..` would otherwise pass and build a URL that
 * climbs a level.
 *
 * @param {string} s
 */
const segmentSur = (s) => /^[A-Za-z0-9._~-]+$/.test(s) && s !== '.' && s !== '..' && !s.includes('..');

/**
 * Validates the payload's `url` field, which is concatenated into the public job
 * URL. Accepts the TWO shapes the API actually emits:
 *
 *   <jobAdId>-<slug>                    a single-address posting
 *   <jobAdId>/<addressId>-<slug>        one address of a multi-address posting
 *
 * The second one matters: a first version of this provider allowed no slash and
 * silently dropped 10 of the 56 postings of a real tenant — 18 %, invisible,
 * because a dropped posting looks exactly like a posting that does not exist.
 *
 * @param {string} slug
 * @returns {boolean}
 */
export function slugValide(slug) {
  const parts = String(slug).split('/');
  return parts.length <= 2 && parts.every(segmentSur);
}

function intInRange(val, def, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * The tenant's careers host and the language segment of its job URLs, read from
 * the configured `careers_url`.
 *
 * @param {import('./_types.js').PortalEntry & {digitalrecruiters?: any}} entry
 * @returns {{host: string, lang: string}|null}
 */
export function resolveTenant(entry) {
  let url;
  try {
    url = new URL(String(entry?.careers_url || ''));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (!host || host === API_HOST) return null;
  const cfg = (entry && entry.digitalrecruiters) || {};
  const declared = txt(cfg.lang).toLowerCase();
  if (declared && !/^[a-z]{2}$/.test(declared)) return null;
  // The career site paths are `/<lang>/annonces` and `/<lang>/annonce/<slug>`,
  // so the language of the configured URL is the one to reuse.
  const first = url.pathname.split('/').filter(Boolean)[0] || '';
  const lang = declared || (/^[a-z]{2}$/.test(first) ? first : DEFAULT_LANG);
  return { host, lang };
}

/** @param {string} url */
function assertApiUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`digitalrecruiters: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`digitalrecruiters: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== API_HOST) {
    throw new Error(`digitalrecruiters: untrusted hostname "${parsed.hostname}" - must be ${API_HOST}`);
  }
  return url;
}

/**
 * Reads and sanitizes the entry's `digitalrecruiters:` block.
 *
 * @param {{digitalrecruiters?: any}} entry
 */
export function parseDrConfig(entry) {
  const cfg = (entry && entry.digitalrecruiters) || {};
  const locale = txt(cfg.locale) || DEFAULT_LOCALE;
  return {
    // Passed through as configured: the API validates it and its 400 names the
    // field, which is a better error than anything guessed here.
    locale,
    limit: intInRange(cfg.limit, 100, 1, 200),
    pages: intInRange(cfg.pages, 5, 1, 50),
  };
}

/** The request URL for one page of one tenant. */
export function buildRequestUrl({ host, locale, limit, page }) {
  const params = new URLSearchParams({ domainName: host, limit: String(limit), page: String(page), locale });
  return `${API_URL}?${params.toString()}`;
}

/**
 * Normalizes one raw item into a Job, or null when it lacks a title or the slug
 * its public URL is built from.
 *
 * @param {any} item
 * @param {{host: string, lang: string}} tenant
 * @param {string} [company]
 * @returns {({title: string, url: string, company: string, location: string}) | null}
 */
export function normalizeDrJob(item, tenant, company = 'DigitalRecruiters') {
  const it = item ?? {};
  const title = txt(it.title);
  const slug = txt(it.url);
  if (!title || !slug) return null;
  // The slug is concatenated into a URL, so it is validated rather than escaped:
  // a posting whose slug we do not understand is a posting we drop. See
  // slugValide for the two shapes the API emits — and for the 18 % this used to
  // lose.
  if (!slugValide(slug)) return null;
  return {
    title,
    url: `https://${tenant.host}/${tenant.lang}/annonce/${slug}`,
    company,
    location: txt(it.location),
  };
}

/** @type {Provider} */
export default {
  id: 'digitalrecruiters',

  detect(entry) {
    // Explicit-only: a tenant serves its career site from its own domain, so
    // nothing in a careers_url identifies the platform. Claiming by pattern
    // would hijack every entry whose host happens to start with "jobs.".
    if (entry?.provider !== 'digitalrecruiters') return null;
    const tenant = resolveTenant(entry);
    if (!tenant) return null;
    const { locale, limit } = parseDrConfig(entry);
    return { url: buildRequestUrl({ host: tenant.host, locale, limit, page: 1 }) };
  },

  async fetch(entry, ctx) {
    const tenant = resolveTenant(entry);
    if (!tenant) {
      throw new Error(`digitalrecruiters: entry "${entry?.name || '(unnamed)'}" needs an https careers_url on the tenant's own domain`);
    }
    const { locale, limit, pages } = parseDrConfig(entry);
    const maxPages = Number.isFinite(Number(ctx.maxPages)) ? Math.max(1, Number(ctx.maxPages)) : pages;
    const company = txt(entry?.name) || 'DigitalRecruiters';

    const byUrl = new Map();
    let total = null;
    for (let page = 1; page <= maxPages; page++) {
      const url = assertApiUrl(buildRequestUrl({ host: tenant.host, locale, limit, page }));
      // POST with an empty filter object — the endpoint rejects GET (405).
      // redirect:'error' prevents SSRF via a server-side redirect.
      const json = await ctx.fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({}),
        redirect: 'error',
        timeoutMs: 20_000,
      });
      const items = Array.isArray(json?.items) ? json.items : [];
      const compte = Number(json?.count);
      if (Number.isFinite(compte)) total = compte;
      for (const raw of items) {
        const job = normalizeDrJob(raw, tenant, company);
        if (job && !byUrl.has(job.url)) byUrl.set(job.url, job);
      }
      // Short page, or the announced total is covered: stop rather than paging
      // into the void.
      if (items.length < limit) break;
      if (total !== null && page * limit >= total) break;
      if (typeof ctx.sleep === 'function') await ctx.sleep(300);
    }
    return [...byUrl.values()];
  },
};
