// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Taleez provider — the French ATS used by a large share of French SMEs and
// mid-caps. Per-tenant career sites live at `<tenant>.taleez.com`, so this is
// the French counterpart of greenhouse/lever/ashby: one entry per employer.
//
// FINDING THE PUBLIC ENDPOINT WAS THE WHOLE WORK, and the obvious candidates are
// all dead ends (measured 2026-08-14):
//
//   api.taleez.com/0/jobs              -> 403   (employer API, needs a key)
//   taleez.com/api/pub/jobs            -> 401
//   <tenant>.taleez.com/api/jobs       -> 401
//   <tenant>.taleez.com/jobs.json      -> 404
//
// and the career page is an Angular SPA, so its HTML carries no postings at all.
// A first pass therefore concluded "auth-gated, plugin territory" — wrong. The
// SPA has to read the postings from somewhere: its own bundle declares
// `this.urlPrefix = "/api/careez"`, and
//
//   GET https://<tenant>.taleez.com/api/careez   -> 200, no auth, every posting
//
// is public. The lesson worth keeping: a JS-rendered career page is not an
// auth-gated one — it just moved its contract from the HTML into an XHR call.
//
// THE JOB URL IS NOT ON THE TENANT HOST. Tenant sitemaps list only the home page
// (verified) and every `<tenant>.taleez.com/<path>/<slug>` shape 404s. The one
// stable per-posting link is Taleez's own apply page:
//
//   https://taleez.com/apply/<slug>
//
// Verified as a real route and not an SPA catch-all: two genuine slugs answer
// 200, a made-up one answers 404. That matters because this URL is the
// scanner's dedup key — a catch-all would have made every posting share it.
//
// Auto-detects from `careers_url` on `<tenant>.taleez.com`; or set
// `provider: taleez` with that host in `careers_url`.

const TALEEZ_HOST_SUFFIX = '.taleez.com';
const APPLY_BASE = 'https://taleez.com/apply/';

/**
 * The career-site API URL for an entry, or null when the entry is not a Taleez
 * tenant. Only the HOST is taken from the config: the path is ours, so a
 * `careers_url` pointing at some deep page still resolves correctly.
 *
 * @param {import('./_types.js').PortalEntry} entry
 * @returns {string|null}
 */
export function resolveApiUrl(entry) {
  const raw = entry?.api || entry?.careers_url || '';
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  // A tenant subdomain, not taleez.com itself: the bare domain is the vendor's
  // marketing site and has no career payload.
  if (!host.endsWith(TALEEZ_HOST_SUFFIX)) return null;
  const sub = host.slice(0, -TALEEZ_HOST_SUFFIX.length);
  if (!sub || sub.includes('.') || sub === 'www') return null;
  return `https://${host}/api/careez`;
}

/** @param {string} url */
function assertTaleezUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`taleez: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`taleez: URL must use HTTPS: ${url}`);
  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith(TALEEZ_HOST_SUFFIX) || host === TALEEZ_HOST_SUFFIX.slice(1)) {
    throw new Error(`taleez: untrusted hostname "${parsed.hostname}" - must be a <tenant>${TALEEZ_HOST_SUFFIX} host`);
  }
  return url;
}

const txt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Flattens Taleez's structured location into one readable line.
 *
 * `city (departmentCode)` mirrors what the French public-sector provider yields
 * ("Paris (75)"), which is what scan.mjs's location_filter is configured against
 * for France. The region is the fallback for a posting pinned to a region rather
 * than a city, and a non-FR country is appended so the filter can act on it —
 * same rule as buildLocation in arbeitsagentur.mjs.
 *
 * @param {any} loc
 * @returns {string}
 */
export function buildLocation(loc) {
  if (!loc || typeof loc !== 'object') return '';
  const city = txt(loc.city);
  const dept = txt(loc.departmentCode);
  const region = txt(loc.region);
  const country = txt(loc.country).toUpperCase();
  let base = city ? (dept ? `${city} (${dept})` : city) : region;
  if (!base) base = txt(loc.postalCode);
  if (country && country !== 'FR') base = base ? `${base}, ${country}` : country;
  return base;
}

/**
 * Normalizes one raw posting into a Job, or null when it lacks what makes a
 * posting actionable: a title and the slug the apply URL is built from.
 *
 * @param {any} job
 * @param {string} [fallbackCompany]
 * @returns {({title: string, url: string, company: string, location: string, postedAt?: number}) | null}
 */
export function normalizeTaleezJob(job, fallbackCompany = 'Taleez') {
  const j = job ?? {};
  const title = txt(j.label);
  const slug = txt(j.slug);
  if (!title || !slug) return null;
  // The slug is concatenated into a URL: anything that could climb out of the
  // path (a slash, a dot segment) is refused rather than encoded, because a
  // posting that needs escaping is a posting we do not understand.
  if (!/^[A-Za-z0-9_-]+$/.test(slug)) return null;

  let location = buildLocation(j.location);
  // `remote: true` is worth carrying: scan.mjs's commute-based location_filter
  // rescues a remote posting through always_allow, and it would otherwise be
  // dropped on the employer's city.
  if (j.remote === true) location = location ? `${location} · Télétravail` : 'Télétravail';

  const posted = Number(j.publishDate ?? j.creationDate);
  /** @type {any} */
  const out = {
    title,
    url: APPLY_BASE + slug,
    company: fallbackCompany,
    location,
  };
  // Already epoch ms in the payload — no unit conversion, and NaN never becomes
  // a date.
  if (Number.isFinite(posted) && posted > 0) out.postedAt = posted;
  return out;
}

/** @type {Provider} */
export default {
  id: 'taleez',

  detect(entry) {
    try {
      const url = resolveApiUrl(entry);
      return url ? { url } : null;
    } catch {
      return null;
    }
  },

  async fetch(entry, ctx) {
    const apiUrl = resolveApiUrl(entry);
    if (!apiUrl) throw new Error(`taleez: cannot derive the career-site API URL for ${entry?.name || '(unnamed)'}`);
    assertTaleezUrl(apiUrl);
    // redirect:'error' prevents SSRF via a server-side redirect; combined with
    // assertTaleezUrl it keeps the request pinned to a taleez.com tenant.
    const json = await ctx.fetchJson(apiUrl, { redirect: 'error', headers: { accept: 'application/json' }, timeoutMs: 20_000 });
    const jobs = Array.isArray(json?.jobs) ? json.jobs : [];
    // The employer name comes from the payload (`name`), falling back to the
    // portals.yml entry: the site is the employer here, so the payload is the
    // more accurate of the two.
    const company = txt(json?.name) || txt(entry?.name) || 'Taleez';
    const byUrl = new Map();
    for (const raw of jobs) {
      const job = normalizeTaleezJob(raw, company);
      if (job && !byUrl.has(job.url)) byUrl.set(job.url, job);
    }
    return [...byUrl.values()];
  },
};
