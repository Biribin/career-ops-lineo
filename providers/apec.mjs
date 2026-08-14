// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// APEC provider — the public search endpoint behind apec.fr's own results page
// (`POST /cms/webservices/rechercheOffre`). No key, no login, JSON in and JSON
// out, so it lives in-process alongside the other JSON-API providers.
//
// Why this board: the APEC is France's national board for `cadre` roles
// (engineers, managers, specialists). It is the French counterpart to
// arbeitsagentur.mjs for Germany and vdab.mjs for Flanders, and it publishes
// listings that never reach France Travail — a private-sector employer often
// posts to the APEC only.
//
// The list payload carries the full advert text (`texteOffre`), so descriptions
// come for free and scan.mjs's content_filter works without a second request
// per job — same property that makes lever.mjs cheap.
//
// One search per keyword; scan.mjs applies title_filter + location_filter +
// dedup afterwards, so this provider over-fetches on purpose (recall-first).
//
// Configure via a `job_boards` entry with `provider: apec` and an optional
// `apec:` block:
//
//   - name: APEC — IA / automatisation
//     provider: apec
//     apec:
//       keywords: ["automatisation", "data engineer"]  # optional; falls back to
//                                 # config/profile.yml target_roles
//       size: 100               # results per keyword (1–100, default 50)
//       pages: 2                # pages per keyword (default 1)
//       sort: date              # `date` (default) or `score`
//     enabled: true

import { resolveProfileKeywords } from './_profile-keywords.mjs';

const API_URL = 'https://www.apec.fr/cms/webservices/rechercheOffre';
const TRUSTED_HOST = 'www.apec.fr';
// Public URL of one posting. Verified 2026-08-14: it answers 200 for a
// `numeroOffre` ("179260715W"), not for the bare `id`.
const DETAIL_BASE = 'https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/';

/** @param {string} url */
function assertApecUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`apec: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`apec: URL must use HTTPS: ${url}`);
  if (parsed.hostname !== TRUSTED_HOST) {
    throw new Error(`apec: untrusted hostname "${parsed.hostname}" - must be ${TRUSTED_HOST}`);
  }
  return url;
}

// Clamp a runtime integer into [min, max], falling back to `def` for NaN, so a
// stray portals.yml value cannot produce empty (size=0) or pathological queries.
function intInRange(val, def, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/**
 * Reads and sanitizes the entry's `apec:` config block.
 *
 * Keywords fall back to `config/profile.yml` target_roles (shared helper, same
 * as vdab.mjs): a user who has onboarded already recorded what they are looking
 * for, and duplicating it here by hand is how the two drift apart.
 *
 * @param {{ apec?: any }} entry
 * @returns {{ keywords: string[], size: number, pages: number, sort: 'date'|'score' }}
 */
export function parseApecConfig(entry) {
  const cfg = (entry && entry.apec) || {};
  const declared = Array.isArray(cfg.keywords)
    ? cfg.keywords.filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim())
    : [];
  return {
    keywords: declared.length ? declared : resolveProfileKeywords(),
    size: intInRange(cfg.size, 50, 1, 100),
    pages: intInRange(cfg.pages, 1, 1, 20),
    sort: cfg.sort === 'score' ? 'score' : 'date',
  };
}

// NaN-safe Date.parse — `|| undefined` would also discard a valid epoch 0.
function toEpochMs(value) {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const txt = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

/**
 * Normalizes one raw APEC result into a Job, or null when it lacks what an
 * offer needs to be actionable (a public reference and a title).
 *
 * `numeroOffre` and not `id`: only the former builds a URL that resolves.
 *
 * @param {any} offre
 * @param {string} [fallbackCompany]
 * @returns {({title: string, url: string, company: string, location: string, description: string, postedAt?: number}) | null}
 */
export function normalizeApecOffer(offre, fallbackCompany = 'APEC') {
  const o = offre ?? {};
  const ref = txt(o.numeroOffre);
  const title = txt(o.intitule);
  if (!ref || !title) return null;
  // A reference is alphanumeric. Rejecting anything else stops an unexpected
  // value from building a path (`../`) instead of a posting URL.
  if (!/^[A-Za-z0-9_-]+$/.test(ref)) return null;
  const postedAt = toEpochMs(o.datePublication || o.dateValidation);
  /** @type {any} */
  const job = {
    title,
    url: DETAIL_BASE + encodeURIComponent(ref),
    // `nomCommercial` sometimes reads "X pour Y" (agency on behalf of its
    // client). Kept verbatim: it is what the candidate actually sees.
    company: txt(o.nomCommercial) || fallbackCompany,
    location: txt(o.lieuTexte),
    // The list ships the whole advert, so scan.mjs's content_filter works with
    // no extra request per job.
    description: txt(o.texteOffre),
  };
  if (postedAt !== undefined) job.postedAt = postedAt;
  return job;
}

/**
 * The search body the endpoint expects. Isolated and exported so it can be
 * unit-tested: it is the one part of this provider that must stay aligned with
 * a service we do not control.
 *
 * @param {{motsCles: string, size: number, startIndex: number, sort: 'date'|'score'}} p
 */
export function buildApecBody({ motsCles, size, startIndex, sort }) {
  return {
    motsCles,
    pagination: { range: size, startIndex },
    sorts: [{ type: sort === 'score' ? 'SCORE' : 'DATE', direction: 'DESCENDING' }],
    activeFiltre: true,
  };
}

/** @type {Provider} */
export default {
  id: 'apec',

  detect(entry) {
    // Explicit-only: this is a national board, not a per-company ATS. Nothing
    // in a `careers_url` could be used to claim an entry.
    return entry?.provider === 'apec' ? { url: API_URL } : null;
  },

  async fetch(entry, ctx) {
    const { keywords, size, pages, sort } = parseApecConfig(entry);
    if (!keywords.length) {
      throw new Error(
        `apec: entry "${entry.name || '(unnamed)'}" has no apec.keywords[] and config/profile.yml declares no target_roles`,
      );
    }
    assertApecUrl(API_URL);
    // The portal health probe passes maxPages: 1 — honored, otherwise a mere
    // availability check would paginate the whole board.
    const maxPages = Number.isFinite(Number(ctx.maxPages)) ? Math.max(1, Number(ctx.maxPages)) : pages;

    const byUrl = new Map();
    const errors = [];
    let succeeded = 0;

    for (const kw of keywords) {
      for (let page = 0; page < maxPages; page++) {
        let json;
        try {
          json = await ctx.fetchJson(API_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(buildApecBody({ motsCles: kw, size, startIndex: page * size, sort })),
            redirect: 'error',
            timeoutMs: 20_000,
          });
        } catch (err) {
          // Recall-first: one failing keyword must not kill the others.
          errors.push(`"${kw}" (page ${page + 1}): ${(err && err.message) || err}`);
          break;
        }
        if (page === 0) succeeded++;
        const resultats = Array.isArray(json && json.resultats) ? json.resultats : [];
        for (const brut of resultats) {
          const job = normalizeApecOffer(brut, entry?.name);
          if (job && !byUrl.has(job.url)) byUrl.set(job.url, job);
        }
        // Short page, or total reached: no point asking for the next one.
        const total = Number(json && json.totalCount);
        if (resultats.length < size) break;
        if (Number.isFinite(total) && (page + 1) * size >= total) break;
        if (typeof ctx.sleep === 'function') await ctx.sleep(300);
      }
    }

    // Total outage = every request failed. A keyword that answers zero results
    // is NOT an outage, so key off the success count and not the result size —
    // otherwise a legitimately empty search would throw.
    if (succeeded === 0 && errors.length) {
      throw new Error(`apec: all ${keywords.length} keyword request(s) failed — ${errors[0]}`);
    }

    return [...byUrl.values()];
  },
};
