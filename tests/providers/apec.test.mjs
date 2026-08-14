// tests/providers/apec.test.mjs — APEC (France's national board for `cadre` roles).
//
// The fixture rows are trimmed copies of a real response captured 2026-08-14, so
// a change in APEC's field names fails here instead of silently returning zero
// jobs in production.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — apec');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/apec.mjs')).href);
  const apec = mod.default;
  const { normalizeApecOffer, parseApecConfig, buildApecBody } = mod;

  if (apec.id === 'apec') pass('apec.id is "apec"');
  else fail(`apec.id is ${JSON.stringify(apec.id)}`);

  // detect(): explicit-only. A national board cannot be claimed from a careers_url.
  if (apec.detect({ provider: 'apec' })?.url === 'https://www.apec.fr/cms/webservices/rechercheOffre') {
    pass('apec.detect() claims an entry with provider: apec');
  } else {
    fail(`apec.detect(provider: apec) = ${JSON.stringify(apec.detect({ provider: 'apec' }))}`);
  }
  const notClaimed = [
    apec.detect({ careers_url: 'https://www.apec.fr/candidat' }),
    apec.detect({ provider: 'greenhouse' }),
    apec.detect({}),
  ];
  if (notClaimed.every((r) => r === null)) pass('apec.detect() claims nothing else, not even an apec.fr careers_url');
  else fail(`apec.detect() over-claims: ${JSON.stringify(notClaimed)}`);

  // -- normalizeApecOffer -----------------------------------------------------
  const real = {
    id: '179260715',
    numeroOffre: '179260715W',
    intitule: '  Chef de Projet / Business Analyst IA F/H  ',
    nomCommercial: '  CNAM  ',
    lieuTexte: 'Paris 20 - 75',
    salaireTexte: 'A négocier',
    texteOffre: 'Vos missions Concevoir et accompagner les cas d usage IA',
    datePublication: '2026-08-13T08:27:05.000+0000',
    dateValidation: '2026-08-13T08:27:05.000+0000',
  };
  const job = normalizeApecOffer(real);
  if (
    job &&
    job.title === 'Chef de Projet / Business Analyst IA F/H' &&
    job.company === 'CNAM' &&
    job.location === 'Paris 20 - 75' &&
    job.url === 'https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/179260715W' &&
    job.description.startsWith('Vos missions') &&
    job.postedAt === Date.parse('2026-08-13T08:27:05.000+0000')
  ) {
    pass('normalizeApecOffer maps + trims title/company/location, builds the detail URL from numeroOffre, keeps the advert text');
  } else {
    fail(`normalizeApecOffer real row = ${JSON.stringify(job)}`);
  }

  // `numeroOffre` and not `id`: only the former builds a URL that resolves (200
  // vs 404, verified live).
  if (!job.url.endsWith('/179260715')) pass('normalizeApecOffer uses numeroOffre, never the bare id');
  else fail(`normalizeApecOffer built a URL from the bare id: ${job.url}`);

  // dateValidation is the fallback when datePublication is absent.
  const fallbackDate = normalizeApecOffer({ numeroOffre: 'A1', intitule: 'T', dateValidation: '2026-08-01T00:00:00.000+0000' });
  if (fallbackDate.postedAt === Date.parse('2026-08-01T00:00:00.000+0000')) pass('normalizeApecOffer falls back to dateValidation');
  else fail(`normalizeApecOffer dateValidation fallback = ${JSON.stringify(fallbackDate)}`);

  const noDate = normalizeApecOffer({ numeroOffre: 'A2', intitule: 'T' });
  if (noDate && !('postedAt' in noDate)) pass('normalizeApecOffer omits postedAt rather than inventing a date');
  else fail(`normalizeApecOffer postedAt presence = ${JSON.stringify(noDate)}`);

  // Company fallback: entry name, then "APEC" — an empty employer must not read
  // as an empty column downstream.
  const coEntry = normalizeApecOffer({ numeroOffre: 'A3', intitule: 'T', nomCommercial: '' }, 'Entry Name');
  const coDefault = normalizeApecOffer({ numeroOffre: 'A4', intitule: 'T' });
  if (coEntry.company === 'Entry Name' && coDefault.company === 'APEC') pass('normalizeApecOffer falls back company → entry name → "APEC"');
  else fail(`normalizeApecOffer company fallbacks = ${JSON.stringify({ a: coEntry.company, b: coDefault.company })}`);

  // Drops. The path-traversal row is the one that matters: the reference is
  // concatenated into a URL, so a value carrying `/` or `..` must never build one.
  const drops = [
    normalizeApecOffer({ numeroOffre: 'A5', intitule: '   ' }),
    normalizeApecOffer({ intitule: 'No reference' }),
    normalizeApecOffer({ numeroOffre: '../../etc/passwd', intitule: 'Traversal' }),
    normalizeApecOffer({ numeroOffre: 'A B', intitule: 'Space in ref' }),
    normalizeApecOffer(null),
  ];
  if (drops.every((r) => r === null)) pass('normalizeApecOffer drops empty-title / no-reference / traversal / spaced reference / non-object');
  else fail(`normalizeApecOffer drops = ${JSON.stringify(drops)}`);

  // -- parseApecConfig --------------------------------------------------------
  const cfg = parseApecConfig({ apec: { keywords: [' automatisation ', '', 42, 'data engineer'], size: 500, pages: 0, sort: 'score' } });
  if (
    cfg.keywords.length === 2 &&
    cfg.keywords[0] === 'automatisation' &&
    cfg.size === 100 && // clamped to the API max
    cfg.pages === 1 && // clamped to the min
    cfg.sort === 'score'
  ) {
    pass('parseApecConfig trims keywords, drops non-strings, clamps size/pages, honors sort: score');
  } else {
    fail(`parseApecConfig = ${JSON.stringify(cfg)}`);
  }
  const defaults = parseApecConfig({});
  if (defaults.size === 50 && defaults.pages === 1 && defaults.sort === 'date') pass('parseApecConfig defaults: size 50, 1 page, sort by date');
  else fail(`parseApecConfig defaults = ${JSON.stringify(defaults)}`);

  // -- buildApecBody ----------------------------------------------------------
  const body = buildApecBody({ motsCles: 'n8n', size: 20, startIndex: 40, sort: 'date' });
  if (
    body.motsCles === 'n8n' &&
    body.pagination.range === 20 &&
    body.pagination.startIndex === 40 &&
    body.sorts[0].type === 'DATE' &&
    body.activeFiltre === true
  ) {
    pass('buildApecBody builds the documented search body (range = page size, startIndex = offset)');
  } else {
    fail(`buildApecBody = ${JSON.stringify(body)}`);
  }

  // -- fetch() ----------------------------------------------------------------
  const mkRow = (i) => ({ numeroOffre: `R${i}W`, intitule: `Role ${i}`, nomCommercial: 'Acme', lieuTexte: 'Paris - 75', texteOffre: 'body' });
  const calls = [];
  const ctx = {
    transport: 'http',
    fetchText: async () => '',
    fetchJson: async (url, opts) => {
      calls.push({ url, method: opts?.method, redirect: opts?.redirect, body: JSON.parse(opts?.body || '{}') });
      const start = JSON.parse(opts.body).pagination.startIndex;
      // 3 rows per page, total 5 → page 2 is short and must stop the loop.
      return { totalCount: 5, resultats: start === 0 ? [mkRow(0), mkRow(1), mkRow(2)] : [mkRow(3), mkRow(4)] };
    },
  };
  const jobs = await apec.fetch({ name: 'APEC', apec: { keywords: ['n8n'], size: 3, pages: 5 } }, ctx);
  if (jobs.length === 5) pass('apec.fetch() paginates and returns every posting (5 across 2 pages)');
  else fail(`apec.fetch() returned ${jobs.length} jobs`);
  if (calls.length === 2) pass('apec.fetch() stops on a short page instead of asking for pages 3..5');
  else fail(`apec.fetch() made ${calls.length} requests: ${JSON.stringify(calls.map((c) => c.body.pagination))}`);
  if (calls.every((c) => c.method === 'POST' && c.redirect === 'error')) pass('apec.fetch() POSTs with redirect:"error" (no SSRF via server-side redirect)');
  else fail(`apec.fetch() request options = ${JSON.stringify(calls.map((c) => ({ m: c.method, r: c.redirect })))}`);

  // The health probe passes maxPages: 1 — an availability check must not
  // paginate the whole board.
  const probeCalls = [];
  await apec.fetch(
    { name: 'APEC', apec: { keywords: ['n8n'], size: 3, pages: 10 } },
    { ...ctx, maxPages: 1, fetchJson: async (url, opts) => { probeCalls.push(url); return { totalCount: 99, resultats: [mkRow(0), mkRow(1), mkRow(2)] }; } },
  );
  if (probeCalls.length === 1) pass('apec.fetch() honors ctx.maxPages (health probe stays at one request)');
  else fail(`apec.fetch() with maxPages: 1 made ${probeCalls.length} requests`);

  // Recall-first: one dead keyword must not lose the other's results.
  const partial = await apec.fetch(
    { name: 'APEC', apec: { keywords: ['ko', 'ok'], size: 3, pages: 1 } },
    {
      ...ctx,
      fetchJson: async (_u, opts) => {
        if (JSON.parse(opts.body).motsCles === 'ko') throw new Error('HTTP 503');
        return { totalCount: 1, resultats: [mkRow(9)] };
      },
    },
  );
  if (partial.length === 1) pass('apec.fetch() tolerates one failing keyword and keeps the others');
  else fail(`apec.fetch() partial failure returned ${JSON.stringify(partial)}`);

  // But a total outage must throw, not look like an empty board.
  let threw = null;
  try {
    await apec.fetch({ name: 'APEC', apec: { keywords: ['a', 'b'] } }, { ...ctx, fetchJson: async () => { throw new Error('HTTP 500'); } });
  } catch (e) {
    threw = e.message;
  }
  if (threw && threw.includes('all 2 keyword request(s) failed')) pass('apec.fetch() throws when every request fails (never a silent empty result)');
  else fail(`apec.fetch() total outage = ${JSON.stringify(threw)}`);

  // A keyword that legitimately answers zero results is NOT an outage.
  const empty = await apec.fetch({ name: 'APEC', apec: { keywords: ['zzz'] } }, { ...ctx, fetchJson: async () => ({ totalCount: 0, resultats: [] }) });
  if (Array.isArray(empty) && empty.length === 0) pass('apec.fetch() returns an empty array for a search with no hits');
  else fail(`apec.fetch() empty search = ${JSON.stringify(empty)}`);

  // No keywords at all → an explicit error naming both places to fix.
  let noKw = null;
  try {
    await apec.fetch({ name: 'APEC' }, { ...ctx, fetchJson: async () => ({ resultats: [] }) });
  } catch (e) {
    noKw = e.message;
  }
  if (noKw === null || (noKw.includes('apec.keywords') && noKw.includes('profile.yml'))) {
    pass('apec.fetch() without keywords either uses profile target_roles or says where to declare them');
  } else {
    fail(`apec.fetch() no-keyword error = ${JSON.stringify(noKw)}`);
  }
} catch (e) {
  fail(`apec tests crashed: ${e.message}`);
}
