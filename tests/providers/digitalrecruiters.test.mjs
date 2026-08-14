// tests/providers/digitalrecruiters.test.mjs — DigitalRecruiters / Cegid Talent
// Acquisition, the ATS behind a large share of French corporate career sites.
//
// The fixture mirrors a real response captured 2026-08-14 on jobs.cegid.com,
// including the multi-address slug shape that a first version of this provider
// silently dropped (10 of 56 postings — see slugValide).
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — digitalrecruiters');

const ENTRY = {
  name: 'Cegid',
  provider: 'digitalrecruiters',
  careers_url: 'https://jobs.cegid.com/fr/annonces',
};
const ITEM = {
  id: '4547617-93802837',
  job_ad_id: 4547617,
  title: '  Developer Backend Laravel - M/H/NB  ',
  contract: 'CDI',
  location: '  Manresa  ',
  job: 'Recherche et Développement',
  url: '4547617-developer-backend-laravel-mhnb-8003-manresa',
  career_domain: 'jobs.cegid.com',
};
// One address of a multi-address posting: the slug carries a slash.
const ITEM_MULTI = { ...ITEM, id: '4480603-132544973', job_ad_id: 4480603, title: 'Partner Developer - F/M/NB', url: '4480603/132544973-partner-developer-fmnb-4715-213-braga', location: 'Braga' };

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/digitalrecruiters.mjs')).href);
  const dr = mod.default;
  const { normalizeDrJob, slugValide, parseDrConfig, buildRequestUrl, resolveTenant } = mod;

  if (dr.id === 'digitalrecruiters') pass('digitalrecruiters.id is "digitalrecruiters"');
  else fail(`id is ${JSON.stringify(dr.id)}`);

  // -- detect: EXPLICIT-ONLY -------------------------------------------------
  // A tenant serves its career site from its own domain, so there is no host
  // pattern to match. Claiming by pattern would hijack every "jobs.*" entry.
  if (dr.detect(ENTRY)?.url?.startsWith('https://api.digitalrecruiters.com/public/v1/careers-site/job-ads?domainName=jobs.cegid.com')) {
    pass('detect() claims an explicit entry and points at the tenant-parameterised API');
  } else {
    fail(`detect(explicit) = ${JSON.stringify(dr.detect(ENTRY))}`);
  }
  const refuses = [
    ['the same URL without provider:', { careers_url: ENTRY.careers_url }],
    ['http', { provider: 'digitalrecruiters', careers_url: 'http://jobs.cegid.com/fr/annonces' }],
    ['the API host itself', { provider: 'digitalrecruiters', careers_url: 'https://api.digitalrecruiters.com/x' }],
    ['no careers_url', { provider: 'digitalrecruiters' }],
    ['another provider', { provider: 'taleez', careers_url: ENTRY.careers_url }],
  ];
  const over = refuses.filter(([, e]) => dr.detect(e) !== null).map(([n]) => n);
  if (over.length === 0) pass('detect() refuses implicit entries, http, the API host and other providers');
  else fail(`detect() over-claims: ${over.join(', ')}`);

  // -- resolveTenant ---------------------------------------------------------
  if (resolveTenant(ENTRY)?.host === 'jobs.cegid.com' && resolveTenant(ENTRY)?.lang === 'fr') {
    pass('resolveTenant reads the host and the language segment from careers_url');
  } else {
    fail(`resolveTenant = ${JSON.stringify(resolveTenant(ENTRY))}`);
  }
  if (resolveTenant({ careers_url: 'https://jobs.cegid.com/' })?.lang === 'fr') pass('resolveTenant defaults the language to fr');
  else fail('resolveTenant did not default the language');
  if (resolveTenant({ careers_url: 'https://jobs.cegid.com/en/annonces' })?.lang === 'en') pass('resolveTenant keeps an explicit language segment');
  else fail('resolveTenant dropped the language segment');
  if (resolveTenant({ ...ENTRY, digitalrecruiters: { lang: 'de' } })?.lang === 'de') pass('a configured lang overrides the URL segment');
  else fail('the configured lang was ignored');

  // -- slugValide: THE bug this function exists for --------------------------
  // 10 of 56 postings of a real tenant were silently dropped by a no-slash rule.
  // A dropped posting looks exactly like a posting that does not exist.
  if (slugValide('4547617-developer-backend-laravel-mhnb-8003-manresa')) pass('slugValide accepts a single-address slug');
  else fail('slugValide rejected a plain slug');
  if (slugValide('4480603/132544973-partner-developer-fmnb-4715-213-braga')) {
    pass('slugValide accepts the MULTI-ADDRESS slug (the 18 % a stricter rule lost)');
  } else {
    fail('slugValide rejects the multi-address shape');
  }
  const rejets = ['..', '.', 'a/../b', 'a/b/c', '..%2f', 'ok..slug', '', 'a b', 'a?b=1'];
  const passes = rejets.filter((s) => slugValide(s));
  if (passes.length === 0) pass('slugValide rejects dot segments, deep paths, encoded traversal, spaces and query characters');
  else fail(`slugValide accepted: ${JSON.stringify(passes)}`);

  // -- normalizeDrJob --------------------------------------------------------
  const tenant = { host: 'jobs.cegid.com', lang: 'fr' };
  const job = normalizeDrJob(ITEM, tenant, 'Cegid');
  if (
    job &&
    job.title === 'Developer Backend Laravel - M/H/NB' &&
    job.company === 'Cegid' &&
    job.location === 'Manresa' &&
    job.url === `https://jobs.cegid.com/fr/annonce/${ITEM.url}`
  ) {
    pass('normalizeDrJob maps + trims title/location and builds the public job URL');
  } else {
    fail(`normalizeDrJob = ${JSON.stringify(job)}`);
  }
  const multi = normalizeDrJob(ITEM_MULTI, tenant, 'Cegid');
  if (multi?.url === 'https://jobs.cegid.com/fr/annonce/4480603/132544973-partner-developer-fmnb-4715-213-braga') {
    pass('normalizeDrJob keeps the multi-address URL shape intact');
  } else {
    fail(`multi-address URL = ${JSON.stringify(multi?.url)}`);
  }

  // The payload carries NO publish date: postedAt must be absent, never guessed.
  if (job && !('postedAt' in job)) pass('normalizeDrJob sets no postedAt — the payload has no date, and a guessed one would poison freshness filters');
  else fail(`postedAt presence = ${JSON.stringify(job)}`);

  const drops = [
    normalizeDrJob({ title: '   ', url: 'ok-slug' }, tenant),
    normalizeDrJob({ title: 'No slug' }, tenant),
    normalizeDrJob({ title: 'Traversal', url: '../../etc/passwd' }, tenant),
    normalizeDrJob({ title: 'Dot', url: '..' }, tenant),
    normalizeDrJob(null, tenant),
  ];
  if (drops.every((r) => r === null)) pass('normalizeDrJob drops empty-title / slug-less / traversal / dot-segment / non-object items');
  else fail(`drops = ${JSON.stringify(drops)}`);

  // -- parseDrConfig / buildRequestUrl ---------------------------------------
  const cfg = parseDrConfig({ digitalrecruiters: { limit: 9999, pages: 0 } });
  if (cfg.limit === 200 && cfg.pages === 1 && cfg.locale === 'fr_FR') pass('parseDrConfig clamps limit/pages and defaults the locale to fr_FR');
  else fail(`parseDrConfig = ${JSON.stringify(cfg)}`);
  // `fr` is REJECTED by the API (400 naming the field): the default must be the
  // underscore form, and a configured value is passed through untouched.
  if (parseDrConfig({ digitalrecruiters: { locale: 'en_GB' } }).locale === 'en_GB') pass('a configured locale is passed through (the API validates it and names the field on error)');
  else fail('the configured locale was rewritten');
  const url = buildRequestUrl({ host: 'jobs.cegid.com', locale: 'fr_FR', limit: 100, page: 2 });
  if (url.includes('domainName=jobs.cegid.com') && url.includes('limit=100') && url.includes('page=2') && url.includes('locale=fr_FR')) {
    pass('buildRequestUrl carries the tenant as a query parameter (one endpoint, every tenant)');
  } else {
    fail(`buildRequestUrl = ${url}`);
  }

  // -- fetch() ---------------------------------------------------------------
  const calls = [];
  const page = (n, taille) => ({ count: 5, items: Array.from({ length: taille }, (_, i) => ({ ...ITEM, job_ad_id: n * 10 + i, url: `${n}${i}-poste-${n}-${i}` })) });
  const jobs = await dr.fetch(
    { ...ENTRY, digitalrecruiters: { limit: 3, pages: 5 } },
    {
      transport: 'http',
      fetchText: async () => '',
      fetchJson: async (u, opts) => {
        calls.push({ url: u, method: opts?.method, redirect: opts?.redirect, body: opts?.body });
        return u.includes('page=1') ? page(1, 3) : page(2, 2);
      },
    },
  );
  if (jobs.length === 5) pass('fetch() paginates until the announced count is covered (5 across 2 pages)');
  else fail(`fetch() returned ${jobs.length} jobs`);
  if (calls.length === 2) pass('fetch() stops on a short page instead of asking for pages 3..5');
  else fail(`fetch() made ${calls.length} requests`);
  if (calls.every((c) => c.method === 'POST' && c.redirect === 'error' && c.body === '{}')) {
    pass('fetch() POSTs an empty filter body with redirect:"error" (the endpoint rejects GET with 405)');
  } else {
    fail(`request options = ${JSON.stringify(calls.map((c) => ({ m: c.method, r: c.redirect, b: c.body })))}`);
  }

  const probe = [];
  await dr.fetch(
    { ...ENTRY, digitalrecruiters: { limit: 3, pages: 9 } },
    { transport: 'http', fetchText: async () => '', maxPages: 1, fetchJson: async (u) => { probe.push(u); return page(1, 3); } },
  );
  if (probe.length === 1) pass('fetch() honors ctx.maxPages (health probe stays at one request)');
  else fail(`with maxPages: 1 it made ${probe.length} requests`);

  const vide = await dr.fetch(ENTRY, { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ count: 0, items: [] }) });
  if (Array.isArray(vide) && vide.length === 0) pass('fetch() returns an empty array for a tenant with no openings');
  else fail(`empty tenant = ${JSON.stringify(vide)}`);

  const casse = await dr.fetch(ENTRY, { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ items: 'pas un tableau' }) });
  if (Array.isArray(casse) && casse.length === 0) pass('fetch() survives a payload whose items is not an array');
  else fail(`malformed payload = ${JSON.stringify(casse)}`);

  let refused = null;
  try {
    await dr.fetch({ name: 'X', provider: 'digitalrecruiters' }, { transport: 'http', fetchText: async () => '', fetchJson: async () => ({}) });
  } catch (e) {
    refused = e.message;
  }
  if (refused && /careers_url/.test(refused)) pass('fetch() says what is missing when there is no careers_url');
  else fail(`missing careers_url = ${JSON.stringify(refused)}`);
} catch (e) {
  fail(`digitalrecruiters tests crashed: ${e.message}`);
}
