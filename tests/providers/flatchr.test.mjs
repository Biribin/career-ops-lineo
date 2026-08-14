// tests/providers/flatchr.test.mjs — Flatchr (French ATS, Next.js career sites).
//
// The fixture is a trimmed copy of a real `__NEXT_DATA__` payload captured
// 2026-08-14 (structured Google-Places address, HTML description, `remote`
// enum), so a change in Flatchr's page props fails here rather than silently
// returning zero jobs.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — flatchr');

const ADDRESS = {
  locality: 'Boulogne-Billancourt', postal_code: '92100', route: 'Rue Marcel Dassault',
  administrative_area_level_1: 'Île-de-France', administrative_area_level_2: 'Hauts-de-Seine',
  formatted_address: '79 Rue Marcel Dassault, 92100 Boulogne-Billancourt, France', country: 'France',
};
const VACANCY = {
  id: 'Wy3EOp2eNOL91KMq',
  vacancy_id: 684002,
  slug: 'wy3eop2enol91kmq-account-executive-_-hrtech',
  title: '  Account executive _ HrTech  ',
  description: '<p>Chez Flatchr, nous r&eacute;inventons le recrutement.</p><p>Plateforme n8n &amp; automatisation.</p>',
  contract_type: 'CDI',
  remote: 'notime',
  address: ADDRESS,
  start_date: '2026-08-12T07:15:03.873Z',
  created_at: '2026-08-01T00:00:00.000Z',
};
const page = (items, company = { name: 'Flatchr', slug: 'flatchr' }) =>
  `<html><head></head><body><div id="__next"></div>` +
  `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { data: { items }, config: { company } }, query: { companySlug: company.slug } })}</script>` +
  `</body></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/flatchr.mjs')).href);
  const flatchr = mod.default;
  const { normalizeFlatchrItem, buildLocation, estTeletravail, parseNextData, parseCareersUrl, vacancyUrl } = mod;

  if (flatchr.id === 'flatchr') pass('flatchr.id is "flatchr"');
  else fail(`flatchr.id is ${JSON.stringify(flatchr.id)}`);

  // -- detect ----------------------------------------------------------------
  // THE trap: the un-slashed URL answers 308, and providers pass
  // redirect:'error', so the provider must canonicalize to the slashed form.
  if (flatchr.detect({ careers_url: 'https://careers.flatchr.io/fr/company/flatchr' })?.url === 'https://careers.flatchr.io/fr/company/flatchr/') {
    pass('detect() canonicalizes to the TRAILING-SLASH URL (the un-slashed one 308s, which redirect:"error" would reject)');
  } else {
    fail(`detect() = ${JSON.stringify(flatchr.detect({ careers_url: 'https://careers.flatchr.io/fr/company/flatchr' }))}`);
  }
  if (parseCareersUrl({ careers_url: 'https://careers.flatchr.io/company/acme' })?.lang === 'fr') {
    pass('parseCareersUrl defaults the language to fr when the path has none');
  } else {
    fail(`parseCareersUrl(no lang) = ${JSON.stringify(parseCareersUrl({ careers_url: 'https://careers.flatchr.io/company/acme' }))}`);
  }
  if (parseCareersUrl({ careers_url: 'https://careers.flatchr.io/en/company/acme/' })?.lang === 'en') pass('parseCareersUrl keeps an explicit language segment');
  else fail('parseCareersUrl dropped the language segment');

  const refuses = [
    ['no company segment', { careers_url: 'https://careers.flatchr.io/fr/' }],
    ['the marketing site', { careers_url: 'https://www.flatchr.io/' }],
    ['a suffix-attack host', { careers_url: 'https://careers.flatchr.io.attacker.example/fr/company/x' }],
    ['a subdomain of the host', { careers_url: 'https://evil.careers.flatchr.io/fr/company/x' }],
    ['http', { careers_url: 'http://careers.flatchr.io/fr/company/x' }],
    ['a traversal slug', { careers_url: 'https://careers.flatchr.io/fr/company/..%2f..%2fetc' }],
    ['nothing at all', {}],
  ];
  const overclaims = refuses.filter(([, e]) => flatchr.detect(e) !== null).map(([n]) => n);
  if (overclaims.length === 0) pass('detect() refuses the marketing site, suffix attacks, subdomains, http, traversal and empty entries');
  else fail(`detect() over-claims: ${overclaims.join(', ')}`);

  // -- parseNextData ---------------------------------------------------------
  if (parseNextData(page([])) && parseNextData('<html></html>') === null && parseNextData(null) === null) {
    pass('parseNextData reads the payload and returns null on a page without one');
  } else {
    fail('parseNextData mishandled a page with no __NEXT_DATA__');
  }
  if (parseNextData('<script id="__NEXT_DATA__" type="application/json">{cassé</script>') === null) {
    pass('parseNextData returns null on invalid JSON instead of throwing');
  } else {
    fail('parseNextData threw or accepted invalid JSON');
  }

  // -- buildLocation ---------------------------------------------------------
  if (buildLocation(ADDRESS) === 'Boulogne-Billancourt (92)') pass('buildLocation derives the department from the postal code');
  else fail(`buildLocation = ${JSON.stringify(buildLocation(ADDRESS))}`);
  if (buildLocation({ locality: 'Genève', country: 'Suisse' }) === 'Genève, Suisse') pass('buildLocation appends a non-French country instead of a meaningless department');
  else fail(`buildLocation(CH) = ${JSON.stringify(buildLocation({ locality: 'Genève', country: 'Suisse' }))}`);
  if (buildLocation({ administrative_area_level_1: 'Bretagne', postal_code: '35000', country: 'France' }) === 'Bretagne (35)') pass('buildLocation falls back to the region');
  else fail(`buildLocation(region) = ${JSON.stringify(buildLocation({ administrative_area_level_1: 'Bretagne', postal_code: '35000', country: 'France' }))}`);
  if (buildLocation(null) === '' && buildLocation({}) === '') pass('buildLocation survives a missing address');
  else fail('buildLocation did not survive a missing address');

  // -- estTeletravail --------------------------------------------------------
  // The enum's full range is unobserved, so the rule is narrow BY DESIGN: a
  // wrong tag smuggles an office-bound job past the commute filter.
  if (!estTeletravail('notime') && !estTeletravail('') && !estTeletravail(undefined) && !estTeletravail('valeur-inconnue')) {
    pass('estTeletravail never tags on "notime" nor on an unknown value');
  } else {
    fail('estTeletravail tags on a value that does not clearly mean remote');
  }
  if (estTeletravail('partial') && estTeletravail('FULL') && estTeletravail('hybride')) pass('estTeletravail tags the values that unambiguously mean remote');
  else fail('estTeletravail missed an explicit remote value');

  // -- normalizeFlatchrItem --------------------------------------------------
  const cible = { lang: 'fr', slug: 'flatchr' };
  const job = normalizeFlatchrItem({ published: true, vacancy: VACANCY }, cible, 'Flatchr');
  if (
    job &&
    job.title === 'Account executive _ HrTech' &&
    job.company === 'Flatchr' &&
    job.location === 'Boulogne-Billancourt (92)' &&
    job.url === vacancyUrl(cible, VACANCY.slug) &&
    job.postedAt === Date.parse(VACANCY.start_date)
  ) {
    pass('normalizeFlatchrItem maps title/company/location/url/start_date');
  } else {
    fail(`normalizeFlatchrItem = ${JSON.stringify(job)}`);
  }
  // The description is free in the same payload — that is what makes
  // content_filter work with no extra request per job.
  if (job.description === 'Chez Flatchr, nous réinventons le recrutement. Plateforme n8n & automatisation.') {
    pass('the description is carried, tags stripped and entities decoded (content_filter reads plain text)');
  } else {
    fail(`description = ${JSON.stringify(job.description)}`);
  }
  if (job.url.endsWith('/')) pass('the job URL keeps its trailing slash, like the site\'s own links');
  else fail(`job URL = ${job.url}`);

  const drops = [
    normalizeFlatchrItem({ published: false, vacancy: VACANCY }, cible),
    normalizeFlatchrItem({ published: true }, cible),
    normalizeFlatchrItem({ published: true, vacancy: { title: 'No slug' } }, cible),
    normalizeFlatchrItem({ published: true, vacancy: { title: '  ', slug: 'ok' } }, cible),
    normalizeFlatchrItem({ published: true, vacancy: { title: 'Traversal', slug: '../../etc/passwd' } }, cible),
    normalizeFlatchrItem(null, cible),
  ];
  if (drops.every((r) => r === null)) pass('normalizeFlatchrItem drops unpublished / vacancy-less / slug-less / empty-title / traversal / non-object items');
  else fail(`drops = ${JSON.stringify(drops.map((d) => d && d.title))}`);

  const noDate = normalizeFlatchrItem({ published: true, vacancy: { title: 'T', slug: 'ok', address: ADDRESS } }, cible);
  if (noDate && !('postedAt' in noDate)) pass('normalizeFlatchrItem omits postedAt rather than inventing a date');
  else fail(`postedAt presence = ${JSON.stringify(noDate)}`);
  const fromCreated = normalizeFlatchrItem({ published: true, vacancy: { title: 'T', slug: 'ok', created_at: VACANCY.created_at } }, cible);
  if (fromCreated.postedAt === Date.parse(VACANCY.created_at)) pass('normalizeFlatchrItem falls back to created_at');
  else fail(`created_at fallback = ${JSON.stringify(fromCreated.postedAt)}`);

  // -- fetch() ---------------------------------------------------------------
  let seen = null;
  const jobs = await flatchr.fetch(
    { name: 'entry name', careers_url: 'https://careers.flatchr.io/fr/company/flatchr' },
    {
      transport: 'http',
      fetchJson: async () => ({}),
      fetchText: async (url, opts) => {
        seen = { url, redirect: opts?.redirect, timeoutMs: opts?.timeoutMs };
        return page([{ published: true, vacancy: VACANCY }, { published: true, vacancy: VACANCY }, { published: false, vacancy: { ...VACANCY, slug: 'brouillon' } }]);
      },
    },
  );
  if (seen?.url === 'https://careers.flatchr.io/fr/company/flatchr/' && seen.redirect === 'error') {
    pass('fetch() requests the slashed URL with redirect:"error" (both traps at once)');
  } else {
    fail(`fetch() request = ${JSON.stringify(seen)}`);
  }
  if (jobs.length === 1) pass('fetch() dedups the same posting and skips the unpublished one');
  else fail(`fetch() returned ${jobs.length} jobs: ${JSON.stringify(jobs.map((j) => j.title))}`);
  if (jobs[0].company === 'Flatchr') pass('fetch() takes the employer from the payload');
  else fail(`company = ${JSON.stringify(jobs[0].company)}`);

  const sansPayload = await flatchr.fetch(
    { name: 'Entry Name', careers_url: 'https://careers.flatchr.io/fr/company/acme/' },
    { transport: 'http', fetchJson: async () => ({}), fetchText: async () => '<html>redesign</html>' },
  );
  if (Array.isArray(sansPayload) && sansPayload.length === 0) pass('fetch() returns an empty array when the page carries no payload (a redesign yields nothing, not a crash)');
  else fail(`no-payload fetch = ${JSON.stringify(sansPayload)}`);

  let refused = null;
  try {
    await flatchr.fetch({ name: 'X', careers_url: 'https://evil.example/fr/company/x' }, { transport: 'http', fetchJson: async () => ({}), fetchText: async () => '' });
  } catch (e) {
    refused = e.message;
  }
  if (refused && /cannot derive/.test(refused)) pass('fetch() refuses an entry that is not a Flatchr career site');
  else fail(`off-host fetch = ${JSON.stringify(refused)}`);
} catch (e) {
  fail(`flatchr tests crashed: ${e.message}`);
}
