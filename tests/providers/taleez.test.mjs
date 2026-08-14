// tests/providers/taleez.test.mjs — Taleez (French ATS, per-tenant career sites).
//
// The fixture mirrors a real `/api/careez` payload captured 2026-08-14, including
// the structured `location` object, so a change in Taleez's field names fails
// here instead of silently returning zero jobs.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — taleez');

const LOC_PARIS = {
  locationType: 'ARRONDISSEMENT', arrondissement: '9e arrondissement', postalCode: '75009',
  city: 'Paris', department: 'Paris', departmentCode: '75', region: 'Île-de-France', country: 'FR',
};
const JOB = {
  id: 583438,
  label: '  Chargé de mission communication H/F  ',
  slug: 'charge-de-mission-communication-h-f-paris-reseau-talents-cdi',
  contract: 'CDI',
  location: LOC_PARIS,
  publishDate: 1786703529000,
  creationDate: 1786701718000,
  remote: false,
};

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/taleez.mjs')).href);
  const taleez = mod.default;
  const { normalizeTaleezJob, buildLocation, resolveApiUrl } = mod;

  if (taleez.id === 'taleez') pass('taleez.id is "taleez"');
  else fail(`taleez.id is ${JSON.stringify(taleez.id)}`);

  // -- detect / resolveApiUrl -------------------------------------------------
  if (taleez.detect({ careers_url: 'https://rt.taleez.com/' })?.url === 'https://rt.taleez.com/api/careez') {
    pass('detect() derives /api/careez from a tenant careers_url');
  } else {
    fail(`detect(tenant) = ${JSON.stringify(taleez.detect({ careers_url: 'https://rt.taleez.com/' }))}`);
  }
  // The path of the configured URL is irrelevant — only the host is ours to use.
  if (taleez.detect({ careers_url: 'https://rt.taleez.com/some/deep/page?x=1' })?.url === 'https://rt.taleez.com/api/careez') {
    pass('detect() ignores the path of the configured careers_url');
  } else {
    fail('detect() failed on a deep careers_url');
  }
  const refuses = [
    ['the bare vendor domain', { careers_url: 'https://taleez.com/' }],
    ['www', { careers_url: 'https://www.taleez.com/' }],
    ['http', { careers_url: 'http://rt.taleez.com/' }],
    ['a suffix-attack host', { careers_url: 'https://rt.taleez.com.attacker.example/' }],
    ['a nested subdomain', { careers_url: 'https://a.b.taleez.com/' }],
    ['another ATS', { careers_url: 'https://jobs.lever.co/x' }],
    ['nothing at all', {}],
  ];
  const overclaims = refuses.filter(([, entry]) => taleez.detect(entry) !== null).map(([nom]) => nom);
  if (overclaims.length === 0) pass('detect() refuses the vendor domain, www, http, suffix attacks, nested subdomains and other ATS');
  else fail(`detect() over-claims: ${overclaims.join(', ')}`);

  // `api:` wins, so an entry can keep a human-facing careers_url.
  if (resolveApiUrl({ api: 'https://tehtris.taleez.com/', careers_url: 'https://www.tehtris.com/carriere' }) === 'https://tehtris.taleez.com/api/careez') {
    pass('resolveApiUrl() lets api: override a branded careers_url');
  } else {
    fail('resolveApiUrl() ignores the api: field');
  }

  // -- buildLocation ---------------------------------------------------------
  if (buildLocation(LOC_PARIS) === 'Paris (75)') pass('buildLocation yields "city (dept)" — the shape the other French providers emit');
  else fail(`buildLocation(Paris) = ${JSON.stringify(buildLocation(LOC_PARIS))}`);
  if (buildLocation({ region: 'Bretagne', country: 'FR' }) === 'Bretagne') pass('buildLocation falls back to the region when there is no city');
  else fail(`buildLocation(region) = ${JSON.stringify(buildLocation({ region: 'Bretagne', country: 'FR' }))}`);
  // A non-FR country must survive into the string: location_filter acts on it.
  if (buildLocation({ city: 'Francfort-sur-le-Main', country: 'DE' }) === 'Francfort-sur-le-Main, DE') {
    pass('buildLocation appends a non-French country');
  } else {
    fail(`buildLocation(DE) = ${JSON.stringify(buildLocation({ city: 'Francfort-sur-le-Main', country: 'DE' }))}`);
  }
  if (buildLocation(null) === '' && buildLocation({}) === '') pass('buildLocation survives a missing location');
  else fail('buildLocation did not survive a missing location');

  // -- normalizeTaleezJob ----------------------------------------------------
  const job = normalizeTaleezJob(JOB, 'Réseau Talents');
  if (
    job &&
    job.title === 'Chargé de mission communication H/F' &&
    job.company === 'Réseau Talents' &&
    job.location === 'Paris (75)' &&
    job.url === `https://taleez.com/apply/${JOB.slug}` &&
    job.postedAt === 1786703529000
  ) {
    pass('normalizeTaleezJob maps + trims the label, builds the apply URL from the slug, keeps the publish date');
  } else {
    fail(`normalizeTaleezJob = ${JSON.stringify(job)}`);
  }

  // The apply URL is on taleez.com, NOT on the tenant host: every
  // `<tenant>.taleez.com/<path>/<slug>` shape 404s (verified live).
  if (job.url.startsWith('https://taleez.com/apply/')) pass('the job URL is the taleez.com apply page, not a tenant path');
  else fail(`job URL = ${job.url}`);

  // publishDate is already epoch ms — no unit conversion.
  if (job.postedAt === JOB.publishDate) pass('publishDate is used as-is (already epoch ms)');
  else fail(`postedAt = ${job.postedAt} for publishDate ${JOB.publishDate}`);

  const noDate = normalizeTaleezJob({ label: 'T', slug: 'ok-slug' });
  if (noDate && !('postedAt' in noDate)) pass('normalizeTaleezJob omits postedAt rather than inventing a date');
  else fail(`postedAt presence = ${JSON.stringify(noDate)}`);

  const remote = normalizeTaleezJob({ label: 'T', slug: 'ok-slug', location: LOC_PARIS, remote: true });
  if (remote.location === 'Paris (75) · Télétravail') pass('remote: true is carried into the location (location_filter rescues it via always_allow)');
  else fail(`remote location = ${JSON.stringify(remote.location)}`);
  const remoteOnly = normalizeTaleezJob({ label: 'T', slug: 'ok-slug', remote: true });
  if (remoteOnly.location === 'Télétravail') pass('a remote posting with no city still says Télétravail');
  else fail(`remote-only location = ${JSON.stringify(remoteOnly.location)}`);
  // Only `true` counts: a string or a truthy-looking value must not tag.
  const notRemote = normalizeTaleezJob({ label: 'T', slug: 'ok-slug', location: LOC_PARIS, remote: 'false' });
  if (notRemote.location === 'Paris (75)') pass('only remote === true tags a posting (a false tag would smuggle an office job past the distance check)');
  else fail(`remote:'false' location = ${JSON.stringify(notRemote.location)}`);

  // Drops. The traversal slug is the one that matters: it is concatenated into a URL.
  const drops = [
    normalizeTaleezJob({ label: '   ', slug: 'ok' }),
    normalizeTaleezJob({ label: 'No slug' }),
    normalizeTaleezJob({ label: 'Traversal', slug: '../../etc/passwd' }),
    normalizeTaleezJob({ label: 'Slash', slug: 'a/b' }),
    normalizeTaleezJob(null),
  ];
  if (drops.every((r) => r === null)) pass('normalizeTaleezJob drops empty-label / slug-less / traversal / slashed / non-object postings');
  else fail(`drops = ${JSON.stringify(drops)}`);

  // -- fetch() ---------------------------------------------------------------
  let seen = null;
  const payload = { id: 1, name: 'Réseau Talents', slug: 'rt', jobs: [JOB, { ...JOB, id: 2 }, { ...JOB, id: 3, slug: 'autre-poste-h-f' }] };
  const jobs = await taleez.fetch(
    { name: 'entry name', careers_url: 'https://rt.taleez.com/' },
    { transport: 'http', fetchText: async () => '', fetchJson: async (url, opts) => { seen = { url, redirect: opts?.redirect, timeoutMs: opts?.timeoutMs }; return payload; } },
  );
  if (seen?.url === 'https://rt.taleez.com/api/careez' && seen.redirect === 'error') {
    pass('fetch() hits /api/careez on the tenant host with redirect:"error"');
  } else {
    fail(`fetch() request = ${JSON.stringify(seen)}`);
  }
  if (jobs.length === 2) pass('fetch() dedups two postings sharing one slug (same apply URL)');
  else fail(`fetch() returned ${jobs.length} jobs`);
  // The payload names the employer; the entry name is only a fallback.
  if (jobs[0].company === 'Réseau Talents') pass('fetch() takes the employer from the payload, not from the entry name');
  else fail(`company = ${JSON.stringify(jobs[0].company)}`);

  const fallback = await taleez.fetch(
    { name: 'Entry Name', careers_url: 'https://rt.taleez.com/' },
    { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ jobs: [{ label: 'T', slug: 'ok-slug' }] }) },
  );
  if (fallback[0].company === 'Entry Name') pass('fetch() falls back to the entry name when the payload has none');
  else fail(`company fallback = ${JSON.stringify(fallback[0].company)}`);

  // A tenant with nothing open is not an error (observed live on a real tenant).
  const vide = await taleez.fetch(
    { name: 'X', careers_url: 'https://guidap.taleez.com/' },
    { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ name: 'X', jobs: [] }) },
  );
  if (Array.isArray(vide) && vide.length === 0) pass('fetch() returns an empty array for a tenant with no openings');
  else fail(`empty tenant = ${JSON.stringify(vide)}`);

  // A malformed payload must not crash the scan.
  const casse = await taleez.fetch(
    { name: 'X', careers_url: 'https://rt.taleez.com/' },
    { transport: 'http', fetchText: async () => '', fetchJson: async () => ({ jobs: 'pas un tableau' }) },
  );
  if (Array.isArray(casse) && casse.length === 0) pass('fetch() survives a payload whose jobs is not an array');
  else fail(`malformed payload = ${JSON.stringify(casse)}`);

  let refused = null;
  try {
    await taleez.fetch({ name: 'X', careers_url: 'https://evil.example/' }, { transport: 'http', fetchText: async () => '', fetchJson: async () => ({}) });
  } catch (e) {
    refused = e.message;
  }
  if (refused && /cannot derive/.test(refused)) pass('fetch() refuses an entry that is not a Taleez tenant');
  else fail(`off-host fetch = ${JSON.stringify(refused)}`);
} catch (e) {
  fail(`taleez tests crashed: ${e.message}`);
}
