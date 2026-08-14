// tests/providers/hellowork.test.mjs — France's largest generalist private board.
//
// The anchors are verbatim copies of real markup captured 2026-08-14, entities
// included (`&#xE0;` for "à", `&#xE9;` for "é"): decoding order is exactly what
// the company/location extraction depends on, so the fixture must keep them
// encoded.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — hellowork');

const ANCHOR_FULL =
  '<a data-cy="offerTitle" href="/fr-fr/emplois/80025261.html" ' +
  'title="Testeur Automatisation H/F - MNT Mutuelle Nationale Territoriale" ' +
  'aria-label="Voir offre de Testeur Automatisation H/F &#xE0; Paris 15e - 75, chez MNT Mutuelle Nationale Territoriale, pour un CDI, avec un salaire de 50&#x202F;000 - 55&#x202F;000 &#x20AC; / an, en temps plein, T&#xE9;l&#xE9;travail partiel">';

// Same shape without the contract clause — some postings stop after the employer.
const ANCHOR_NO_CONTRACT =
  '<a data-cy="offerTitle" href="/fr-fr/emplois/77823656.html" ' +
  'title="Ing&#xE9;nieur QA Automatisation H/F - Stormshield" ' +
  'aria-label="Voir offre de Ing&#xE9;nieur QA Automatisation H/F &#xE0; Lyon 9e - 69, chez Stormshield">';

const anchor = (i) =>
  `<a data-cy="offerTitle" href="/fr-fr/emplois/9000${i}.html" title="Role ${i} - Acme" aria-label="Voir offre de Role ${i} &#xE0; Paris - 75, chez Acme, pour un CDI">`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/hellowork.mjs')).href);
  const hw = mod.default;
  const { parseHelloworkPage, parseHelloworkAnchor, searchUrl, RESULTS_PER_PAGE } = mod;

  if (hw.id === 'hellowork') pass('hellowork.id is "hellowork"');
  else fail(`id is ${JSON.stringify(hw.id)}`);

  if (hw.detect({ provider: 'hellowork' })?.url?.startsWith('https://www.hellowork.com/')) pass('detect() claims an entry with provider: hellowork');
  else fail(`detect(provider) = ${JSON.stringify(hw.detect({ provider: 'hellowork' }))}`);
  if ([hw.detect({ provider: 'apec' }), hw.detect({ careers_url: 'https://www.hellowork.com/x' }), hw.detect({})].every((r) => r === null)) pass('detect() claims nothing else');
  else fail('detect() over-claims');

  if (searchUrl('data engineer') === 'https://www.hellowork.com/fr-fr/emploi/recherche.html?k=data+engineer') pass('searchUrl encodes the keyword as ?k=');
  else fail(`searchUrl = ${searchUrl('data engineer')}`);
  if (searchUrl('n8n', 3).endsWith('&p=3')) pass('searchUrl adds &p=N from page 2 on');
  else fail(`searchUrl page 3 = ${searchUrl('n8n', 3)}`);
  let emptyKw = null;
  try { searchUrl(' '); } catch (e) { emptyKw = e.message; }
  if (emptyKw) pass('searchUrl refuses an empty keyword');
  else fail('searchUrl accepted an empty keyword');

  // -- parseHelloworkAnchor ---------------------------------------------------
  const job = parseHelloworkAnchor(ANCHOR_FULL);
  if (
    job &&
    job.title === 'Testeur Automatisation H/F' &&
    job.company === 'MNT Mutuelle Nationale Territoriale' &&
    job.location === 'Paris 15e - 75' &&
    job.url === 'https://www.hellowork.com/fr-fr/emplois/80025261.html'
  ) {
    pass('parseHelloworkAnchor reads title/company/location from the anchor attributes and absolutizes the URL');
  } else {
    fail(`parseHelloworkAnchor full = ${JSON.stringify(job)}`);
  }

  // THE reason company comes from aria-label and not from the title suffix: the
  // employer name is delimited by ", chez … ," while a title's own " - " is not
  // a reliable separator.
  if (!job.title.includes(' - MNT')) pass('parseHelloworkAnchor strips the " - <employer>" suffix from the title attribute');
  else fail(`parseHelloworkAnchor left the employer in the title: ${job.title}`);

  const noContract = parseHelloworkAnchor(ANCHOR_NO_CONTRACT);
  if (noContract?.company === 'Stormshield' && noContract.location === 'Lyon 9e - 69' && noContract.title === 'Ingénieur QA Automatisation H/F') {
    pass('parseHelloworkAnchor handles an aria-label that stops after the employer, and decodes entities');
  } else {
    fail(`parseHelloworkAnchor no-contract = ${JSON.stringify(noContract)}`);
  }

  // A title containing " - " must survive intact when the employer differs.
  const dashTitle = parseHelloworkAnchor(
    '<a data-cy="offerTitle" href="/fr-fr/emplois/1.html" title="Dev Python - Data - Acme" aria-label="Voir offre de Dev Python - Data &#xE0; Lille - 59, chez Acme, pour un CDI">',
  );
  if (dashTitle?.title === 'Dev Python - Data' && dashTitle.company === 'Acme') pass('parseHelloworkAnchor keeps a hyphen INSIDE the title and still finds the employer');
  else fail(`parseHelloworkAnchor dashed title = ${JSON.stringify(dashTitle)}`);

  // Without a title attribute, the aria-label is the fallback source.
  const ariaOnly = parseHelloworkAnchor('<a data-cy="offerTitle" href="/fr-fr/emplois/2.html" aria-label="Voir offre de Data Engineer &#xE0; Nantes - 44, chez Beta">');
  if (ariaOnly?.title === 'Data Engineer' && ariaOnly.company === 'Beta') pass('parseHelloworkAnchor falls back to the aria-label for the title');
  else fail(`parseHelloworkAnchor aria-only = ${JSON.stringify(ariaOnly)}`);

  // Drops: off-host, http, non-posting path, no title at all.
  const drops = [
    parseHelloworkAnchor('<a data-cy="offerTitle" href="https://evil.example/fr-fr/emplois/1.html" title="X - Y">'),
    parseHelloworkAnchor('<a data-cy="offerTitle" href="http://www.hellowork.com/fr-fr/emplois/1.html" title="X - Y">'),
    parseHelloworkAnchor('<a data-cy="offerTitle" href="/fr-fr/conseils/cv.html" title="X - Y">'),
    parseHelloworkAnchor('<a data-cy="offerTitle" href="/fr-fr/emplois/3.html">'),
    parseHelloworkAnchor(null),
  ];
  if (drops.every((r) => r === null)) pass('parseHelloworkAnchor drops off-host / http / non-posting / title-less / non-string anchors');
  else fail(`parseHelloworkAnchor drops = ${JSON.stringify(drops)}`);

  // -- parseHelloworkPage ----------------------------------------------------
  const page = `<html><body>${ANCHOR_FULL}</a>${ANCHOR_NO_CONTRACT}</a><a href="/fr-fr/emplois/999.html">not a result anchor</a></body></html>`;
  const jobs = parseHelloworkPage(page);
  if (jobs.length === 2) pass('parseHelloworkPage reads only the data-cy="offerTitle" anchors');
  else fail(`parseHelloworkPage returned ${jobs.length} jobs: ${JSON.stringify(jobs.map((j) => j.url))}`);

  if (parseHelloworkPage(`${ANCHOR_FULL}</a>${ANCHOR_FULL}</a>`).length === 1) pass('parseHelloworkPage dedups a posting listed twice on one page');
  else fail('parseHelloworkPage kept a duplicate');

  if (parseHelloworkPage(null).length === 0 && parseHelloworkPage('<html></html>').length === 0) pass('parseHelloworkPage survives a non-string and a page with no results');
  else fail('parseHelloworkPage did not survive degenerate input');

  // -- fetch() ---------------------------------------------------------------
  const requested = [];
  const fullPage = Array.from({ length: RESULTS_PER_PAGE }, (_, i) => `${anchor(i)}</a>`).join('');
  const ctx = {
    transport: 'http',
    fetchJson: async () => ({}),
    fetchText: async (url, opts) => {
      requested.push({ url, redirect: opts?.redirect, timeoutMs: opts?.timeoutMs });
      return url.includes('&p=2') ? page : fullPage; // page 2 is short → stop
    },
  };
  const fetched = await hw.fetch({ name: 'HW', hellowork: { keywords: ['n8n'], pages: 4 } }, ctx);
  if (fetched.length === RESULTS_PER_PAGE + 2) pass('fetch() paginates and merges pages (30 + 2)');
  else fail(`fetch() returned ${fetched.length} jobs`);
  if (requested.length === 2) pass('fetch() stops on a short page instead of asking for pages 3..4');
  else fail(`fetch() requested ${JSON.stringify(requested.map((r) => r.url))}`);
  if (requested.every((r) => r.redirect === 'error')) pass('fetch() passes redirect:"error" (no SSRF via server-side redirect)');
  else fail(`fetch() redirect options = ${JSON.stringify(requested.map((r) => r.redirect))}`);
  if (requested.every((r) => r.timeoutMs && r.timeoutMs > 10_000)) pass('fetch() raises the timeout above the default for a ~600 KB page');
  else fail(`fetch() timeouts = ${JSON.stringify(requested.map((r) => r.timeoutMs))}`);

  const probe = [];
  await hw.fetch({ name: 'HW', hellowork: { keywords: ['n8n'], pages: 8 } }, { ...ctx, maxPages: 1, fetchText: async (url) => { probe.push(url); return fullPage; } });
  if (probe.length === 1) pass('fetch() honors ctx.maxPages (health probe stays at one request)');
  else fail(`fetch() with maxPages: 1 made ${probe.length} requests`);

  const partial = await hw.fetch(
    { name: 'HW', hellowork: { keywords: ['ko', 'ok'] } },
    { ...ctx, fetchText: async (url) => { if (url.includes('k=ko')) throw new Error('HTTP 429'); return page; } },
  );
  if (partial.length === 2) pass('fetch() tolerates one failing keyword and keeps the others');
  else fail(`fetch() partial failure returned ${partial.length} jobs`);

  let outage = null;
  try {
    await hw.fetch({ name: 'HW', hellowork: { keywords: ['a', 'b'] } }, { ...ctx, fetchText: async () => { throw new Error('HTTP 403'); } });
  } catch (e) {
    outage = e.message;
  }
  if (outage && outage.includes('all 2 keyword request(s) failed')) pass('fetch() throws on a total outage instead of returning nothing');
  else fail(`fetch() total outage = ${JSON.stringify(outage)}`);
} catch (e) {
  fail(`hellowork tests crashed: ${e.message}`);
}
