// tests/providers/choisirleservicepublic.test.mjs — the French State's job board.
//
// The HTML fixture is a trimmed copy of real markup captured 2026-08-14 (tabs,
// newlines and attribute order preserved, because that is exactly what a naive
// regex trips on). A site redesign must fail here rather than silently return
// zero jobs in production.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — choisirleservicepublic');

// Two real cards, verbatim shape: the anchor's href sits on its own line AFTER a
// newline, and each `fr-card__desc` item is introduced by an `sr-only` label.
const CARD = (slug, title, employer, dept, code, day) => `
\t\t\t\t\t\t\t<h3 class="fr-card__title">

\t\t\t\t\t\t\t\t\t\t\t<a
\t\t\t\t\t\t\thref="https://choisirleservicepublic.gouv.fr/offre-emploi/${slug}/"
\t\t\t\t\t\t\t\t\t\t\t\t\t\tclass="is-same-domain
        \t\t\t\t\t\t\t"
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\ttarget="_blank"
\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\taria-label="${title}, nouvelle fen&ecirc;tre"
\t\t\t\t\t\t\t\t\t\t\t\t\t\t>

\t\t\t\t\t\t\t${title}
\t\t\t\t\t\t\t\t\t\t\t\t\t</a>
\t\t\t\t\t\t\t\t\t</h3>
\t\t\t<ul class="fr-card__desc">
\t\t\t\t<li class="fr-icon-map-pin-2-line fr-icon--sm"><span class="sr-only">Localisation : </span> ${dept} <strong>(${code})</strong></li>
\t\t\t\t<li class="fr-icon-user-line fr-icon--sm"><span class="sr-only">Employeur : </span> ${employer}</li>
\t\t\t\t<li class="fr-icon-calendar-line fr-icon--sm"> En ligne depuis le ${day}</li>
\t\t\t</ul>`;

const PAGE =
  '<html><body><ul>' +
  CARD('responsable-produit-infrastructure-linux-reference-MEF_2026-32366', 'Responsable produit Infrastructure Linux et Automatisation H/F', 'Autorit&eacute; de S&ucirc;ret&eacute; Nucl&eacute;aire (ASNR)', 'Hauts-de-Seine', '92', '06 ao&ucirc;t 2026') +
  CARD('data-engineer--intelligence-artificielle-reference-2026-2357158', 'DATA ENGINEER - INTELLIGENCE ARTIFICIELLE', "Conseil d'Etat", 'Paris', '75', '18 juillet 2026') +
  '</ul></body></html>';

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/choisirleservicepublic.mjs')).href);
  const csp = mod.default;
  const { parseCspPage, keywordSlug, searchUrl, cardField, cardPostedAt, CARDS_PER_PAGE } = mod;

  if (csp.id === 'choisirleservicepublic') pass('choisirleservicepublic.id is "choisirleservicepublic"');
  else fail(`id is ${JSON.stringify(csp.id)}`);

  if (csp.detect({ provider: 'choisirleservicepublic' })?.url?.startsWith('https://choisirleservicepublic.gouv.fr/')) {
    pass('detect() claims an entry with provider: choisirleservicepublic');
  } else {
    fail(`detect(provider) = ${JSON.stringify(csp.detect({ provider: 'choisirleservicepublic' }))}`);
  }
  if ([csp.detect({ provider: 'apec' }), csp.detect({ careers_url: 'https://choisirleservicepublic.gouv.fr/x' }), csp.detect({})].every((r) => r === null)) {
    pass('detect() claims nothing else');
  } else {
    fail('detect() over-claims');
  }

  // -- keywordSlug: THE bug this provider exists to avoid ---------------------
  // Measured live: the hyphenated form returns an empty page (HTTP 200, 4.5 MB,
  // zero postings) while the `+` form returns 20. A wrong separator therefore
  // looks like "no offers today", never like a bug.
  if (keywordSlug('intelligence artificielle') === 'intelligence+artificielle') {
    pass('keywordSlug joins words with "+" (the hyphenated form returns an EMPTY page on the live site)');
  } else {
    fail(`keywordSlug('intelligence artificielle') = ${JSON.stringify(keywordSlug('intelligence artificielle'))}`);
  }
  if (keywordSlug('Sécurité informatique') === 'securite+informatique') pass('keywordSlug strips diacritics (verified harmless live)');
  else fail(`keywordSlug accents = ${JSON.stringify(keywordSlug('Sécurité informatique'))}`);
  if (keywordSlug('  data  ') === 'data' && keywordSlug('a / b') === 'a+b') pass('keywordSlug trims and collapses punctuation');
  else fail(`keywordSlug trim/punct = ${JSON.stringify([keywordSlug('  data  '), keywordSlug('a / b')])}`);

  if (searchUrl('data', 1) === 'https://choisirleservicepublic.gouv.fr/nos-offres/filtres/mot-cles/data/') pass('searchUrl builds the page-1 URL without a page segment');
  else fail(`searchUrl page 1 = ${searchUrl('data', 1)}`);
  if (searchUrl('data', 3) === 'https://choisirleservicepublic.gouv.fr/nos-offres/filtres/mot-cles/data/page/3/') pass('searchUrl appends /page/N/ from page 2 on');
  else fail(`searchUrl page 3 = ${searchUrl('data', 3)}`);
  let emptyKw = null;
  try { searchUrl('   '); } catch (e) { emptyKw = e.message; }
  if (emptyKw) pass('searchUrl refuses an empty keyword rather than fetching the whole board');
  else fail('searchUrl accepted an empty keyword');

  // -- parseCspPage -----------------------------------------------------------
  const jobs = parseCspPage(PAGE);
  if (jobs.length === 2) pass('parseCspPage reads every card of a page');
  else fail(`parseCspPage returned ${jobs.length} jobs`);

  const [first] = jobs;
  if (
    first &&
    first.title === 'Responsable produit Infrastructure Linux et Automatisation H/F' &&
    first.url === 'https://choisirleservicepublic.gouv.fr/offre-emploi/responsable-produit-infrastructure-linux-reference-MEF_2026-32366/' &&
    first.company === 'Autorité de Sûreté Nucléaire (ASNR)' &&
    first.location === 'Hauts-de-Seine (92)' &&
    first.postedAt === Date.UTC(2026, 7, 6)
  ) {
    pass('parseCspPage maps title/url/employer/location, decodes entities, keeps the department code, reads the French date');
  } else {
    fail(`parseCspPage first job = ${JSON.stringify(first)}`);
  }

  if (jobs[1]?.company === "Conseil d'Etat" && jobs[1]?.postedAt === Date.UTC(2026, 6, 18)) pass('parseCspPage handles an apostrophe in the employer and a second month name');
  else fail(`parseCspPage second job = ${JSON.stringify(jobs[1])}`);

  // The department code stays in the location: location_filter matches on it.
  if (jobs.every((j) => /\(\d{2,3}\)/.test(j.location))) pass('parseCspPage keeps the (dept) code that location_filter matches on');
  else fail(`parseCspPage locations = ${JSON.stringify(jobs.map((j) => j.location))}`);

  // Off-host and non-posting links must be dropped, not rewritten.
  const hostile = parseCspPage(
    '<h3 class="fr-card__title"><a href="https://evil.example/offre-emploi/x/">Ext</a></h3>' +
    '<h3 class="fr-card__title"><a href="https://choisirleservicepublic.gouv.fr/conseils/cv/">Not a posting</a></h3>' +
    '<h3 class="fr-card__title"><a href="http://choisirleservicepublic.gouv.fr/offre-emploi/x/">Insecure</a></h3>' +
    '<h3 class="fr-card__title"><a href="https://choisirleservicepublic.gouv.fr/offre-emploi/y/">   </a></h3>',
  );
  if (hostile.length === 0) pass('parseCspPage drops off-host / non-posting / http / empty-title cards');
  else fail(`parseCspPage hostile input = ${JSON.stringify(hostile)}`);

  if (parseCspPage(null).length === 0 && parseCspPage('<html></html>').length === 0) pass('parseCspPage survives a non-string and a page with no cards');
  else fail('parseCspPage did not survive degenerate input');

  // An unreadable or absent date yields no postedAt — never a guessed one.
  if (cardPostedAt('En ligne depuis le 32 brumaire 2026') === undefined && cardPostedAt('') === undefined) pass('cardPostedAt returns undefined rather than guessing a date');
  else fail('cardPostedAt invented a date');
  if (cardField('<span class="sr-only">Employeur : </span> Mairie de X</li>', 'Employeur') === 'Mairie de X') pass('cardField reads a labelled item by its screen-reader label');
  else fail('cardField failed on a labelled item');

  // -- fetch() ----------------------------------------------------------------
  const requested = [];
  const full = '<html>' + Array.from({ length: CARDS_PER_PAGE }, (_, i) => CARD(`slug-${i}-reference-R${i}`, `Role ${i}`, 'Ministère', 'Paris', '75', '01 juin 2026')).join('') + '</html>';
  const ctx = {
    transport: 'http',
    fetchJson: async () => ({}),
    fetchText: async (url, opts) => {
      requested.push({ url, redirect: opts?.redirect, timeoutMs: opts?.timeoutMs });
      return url.includes('/page/2/') ? PAGE : full; // page 2 is short → stop
    },
  };
  const fetched = await csp.fetch({ name: 'CSP', choisirleservicepublic: { keywords: ['data'], pages: 5 } }, ctx);
  if (fetched.length === CARDS_PER_PAGE + 2) pass('fetch() paginates and merges pages (20 + 2)');
  else fail(`fetch() returned ${fetched.length} jobs`);
  if (requested.length === 2) pass('fetch() stops on a short page instead of asking for pages 3..5');
  else fail(`fetch() requested ${JSON.stringify(requested.map((r) => r.url))}`);
  if (requested.every((r) => r.redirect === 'error')) pass('fetch() passes redirect:"error" (no SSRF via server-side redirect)');
  else fail(`fetch() redirect options = ${JSON.stringify(requested.map((r) => r.redirect))}`);
  // A result page weighs ~4.5 MB: the 10s default timeout would abort mid-body.
  if (requested.every((r) => r.timeoutMs && r.timeoutMs > 10_000)) pass('fetch() raises the timeout above the default for a ~4.5 MB page');
  else fail(`fetch() timeouts = ${JSON.stringify(requested.map((r) => r.timeoutMs))}`);

  const probe = [];
  await csp.fetch(
    { name: 'CSP', choisirleservicepublic: { keywords: ['data'], pages: 9 } },
    { ...ctx, maxPages: 1, fetchText: async (url) => { probe.push(url); return full; } },
  );
  if (probe.length === 1) pass('fetch() honors ctx.maxPages (health probe stays at one request)');
  else fail(`fetch() with maxPages: 1 made ${probe.length} requests`);

  let outage = null;
  try {
    await csp.fetch({ name: 'CSP', choisirleservicepublic: { keywords: ['a', 'b'] } }, { ...ctx, fetchText: async () => { throw new Error('HTTP 503'); } });
  } catch (e) {
    outage = e.message;
  }
  if (outage && outage.includes('all 2 keyword request(s) failed')) pass('fetch() throws on a total outage instead of returning nothing');
  else fail(`fetch() total outage = ${JSON.stringify(outage)}`);
} catch (e) {
  fail(`choisirleservicepublic tests crashed: ${e.message}`);
}
