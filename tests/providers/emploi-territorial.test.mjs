// tests/providers/emploi-territorial.test.mjs — French local-government board.
//
// The fixture is a trimmed copy of a real <item> captured 2026-08-14, keeping the
// two places the same fact appears (a `<category domain="…">` and a
// `<div class="…">` in the CDATA description) because the provider reads one and
// falls back to the other.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — emploi-territorial');

const ITEM = `<item>
  <guid isPermaLink="false">https://www.emploi-territorial.fr/:O085260814000428</guid>
  <title><![CDATA[PUÉRICULTEUR VOLANT DÉPARTEMENTAL H/F]]></title>
  <link><![CDATA[https://www.emploi-territorial.fr/offre/o085260814000428-puEriculteur-volant?mtm_campaign=rss]]></link>
  <description><![CDATA[
    <div class="employeur"><strong>Employeur : </strong> CONSEIL DEPARTEMENTAL DE LA VENDEE</div>
    <div class="metier"><strong>Métier(s) : </strong> Infirmier, Puériculteur</div>
    <div class="datepub"><strong>Date de publication : </strong> du 14/08/2026 au 13/09/2026</div>
    <div class="lieutravail"><strong>Lieu de travail : </strong> La Roche-sur-Yon</div>
  ]]></description>
  <pubDate>Fri, 14 Aug 2026 09:15:56 +0000</pubDate>
  <category domain="emploi-territorial:secteurgeo"><![CDATA[La Roche-sur-Yon]]></category>
  <category domain="emploi-territorial:collectivite"><![CDATA[CONSEIL DEPARTEMENTAL DE LA VENDEE]]></category>
</item>`;

// Same posting with the structured categories removed: only the presentational
// divs remain, which is the fallback path.
const ITEM_DIVS_ONLY = ITEM.replace(/<category[\s\S]*?<\/category>\s*/g, '').replace('o085260814000428-puEriculteur-volant', 'o000-fallback');

const FEED = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>Emploi Territorial</title>${items}</channel></rss>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/emploi-territorial.mjs')).href);
  const et = mod.default;
  const { parseEtFeed, categoryValue, descField } = mod;

  if (et.id === 'emploi-territorial') pass('emploi-territorial.id is "emploi-territorial"');
  else fail(`id is ${JSON.stringify(et.id)}`);

  if (et.detect({ provider: 'emploi-territorial' })?.url === 'https://www.emploi-territorial.fr/rss') pass('detect() claims an entry with provider: emploi-territorial');
  else fail(`detect(provider) = ${JSON.stringify(et.detect({ provider: 'emploi-territorial' }))}`);
  if ([et.detect({ provider: 'apec' }), et.detect({ careers_url: 'https://www.emploi-territorial.fr/' }), et.detect({})].every((r) => r === null)) pass('detect() claims nothing else');
  else fail('detect() over-claims');

  // -- parseEtFeed ------------------------------------------------------------
  const [job] = parseEtFeed(FEED(ITEM));
  if (
    job &&
    job.title === 'PUÉRICULTEUR VOLANT DÉPARTEMENTAL H/F' &&
    job.company === 'CONSEIL DEPARTEMENTAL DE LA VENDEE' &&
    job.location === 'La Roche-sur-Yon' &&
    job.postedAt === Date.parse('Fri, 14 Aug 2026 09:15:56 +0000')
  ) {
    pass('parseEtFeed maps title/employer/location/pubDate from the structured categories');
  } else {
    fail(`parseEtFeed job = ${JSON.stringify(job)}`);
  }

  // The dedup key is the URL, so the feed's analytics parameter must go: the same
  // posting reached from the feed and from a page scan has to produce one string.
  if (job.url === 'https://www.emploi-territorial.fr/offre/o085260814000428-puEriculteur-volant') {
    pass('parseEtFeed strips the ?mtm_campaign=rss tracking parameter (the URL is the dedup key)');
  } else {
    fail(`parseEtFeed url = ${JSON.stringify(job.url)}`);
  }

  // No fake description: what the feed calls one is a metadata block, and passing
  // it off as the advert would make content_filter match words no employer wrote.
  if (!('description' in job) || !job.description) pass('parseEtFeed produces no description (the feed carries metadata, not the advert)');
  else fail(`parseEtFeed invented a description: ${JSON.stringify(job.description)}`);

  const [fallback] = parseEtFeed(FEED(ITEM_DIVS_ONLY));
  if (fallback?.company === 'CONSEIL DEPARTEMENTAL DE LA VENDEE' && fallback?.location === 'La Roche-sur-Yon') {
    pass('parseEtFeed falls back to the description divs when the categories are absent');
  } else {
    fail(`parseEtFeed fallback = ${JSON.stringify(fallback)}`);
  }

  // Company fallback: entry name, then the board name.
  const noCompany = ITEM.replace(/<category[^>]*collectivite[\s\S]*?<\/category>/, '').replace(/<div class="employeur">[\s\S]*?<\/div>/, '');
  const [named] = parseEtFeed(FEED(noCompany), 'Entry Name');
  const [defaulted] = parseEtFeed(FEED(noCompany));
  if (named?.company === 'Entry Name' && defaulted?.company === 'Emploi Territorial') pass('parseEtFeed falls back company → entry name → "Emploi Territorial"');
  else fail(`parseEtFeed company fallbacks = ${JSON.stringify({ a: named?.company, b: defaulted?.company })}`);

  // Drops: off-host, http, missing link, empty title.
  const bad = FEED(
    '<item><title>Off host</title><link>https://evil.example/offre/x</link></item>' +
    '<item><title>Insecure</title><link>http://www.emploi-territorial.fr/offre/x</link></item>' +
    '<item><title>No link</title></item>' +
    '<item><title>   </title><link>https://www.emploi-territorial.fr/offre/y</link></item>',
  );
  if (parseEtFeed(bad).length === 0) pass('parseEtFeed drops off-host / http / link-less / empty-title items');
  else fail(`parseEtFeed bad items = ${JSON.stringify(parseEtFeed(bad))}`);

  if (parseEtFeed(null).length === 0 && parseEtFeed(FEED('')).length === 0) pass('parseEtFeed survives a non-string and an empty feed');
  else fail('parseEtFeed did not survive degenerate input');

  const noDate = parseEtFeed(FEED(ITEM.replace(/<pubDate>[\s\S]*?<\/pubDate>/, '')))[0];
  if (noDate && !('postedAt' in noDate)) pass('parseEtFeed omits postedAt rather than inventing a date');
  else fail(`parseEtFeed postedAt presence = ${JSON.stringify(noDate)}`);

  if (categoryValue(ITEM, 'secteurgeo') === 'La Roche-sur-Yon' && categoryValue(ITEM, 'inconnu') === '') pass('categoryValue reads a namespaced category and returns "" for an absent one');
  else fail('categoryValue misread a category');
  if (descField(ITEM, 'lieutravail') === 'La Roche-sur-Yon') pass('descField strips the <strong>label :</strong> prefix');
  else fail(`descField = ${JSON.stringify(descField(ITEM, 'lieutravail'))}`);

  // -- fetch() ---------------------------------------------------------------
  let seen = null;
  const jobs = await et.fetch(
    { name: 'ET' },
    { transport: 'http', fetchJson: async () => ({}), fetchText: async (url, opts) => { seen = { url, redirect: opts?.redirect, timeoutMs: opts?.timeoutMs }; return FEED(ITEM); } },
  );
  if (jobs.length === 1) pass('fetch() returns the feed contents');
  else fail(`fetch() returned ${jobs.length} jobs`);
  if (seen?.url === 'https://www.emploi-territorial.fr/rss' && seen.redirect === 'error') pass('fetch() hits the pinned feed URL with redirect:"error"');
  else fail(`fetch() request = ${JSON.stringify(seen)}`);
  if (seen?.timeoutMs && seen.timeoutMs > 10_000) pass('fetch() raises the timeout above the default for a ~270 KB feed');
  else fail(`fetch() timeout = ${JSON.stringify(seen?.timeoutMs)}`);

  // No keyword option exists, and that is deliberate: the live feed ignores
  // ?motcle= / ?filtre= (verified — same 100 items). A `keywords:` setting would
  // silently do nothing, which is worse than not offering it.
  const src = await import('fs').then((fs) => fs.readFileSync(join(ROOT, 'providers/emploi-territorial.mjs'), 'utf8'));
  if (!/keywords/i.test(src.replace(/^\/\/.*$/gm, ''))) pass('the provider exposes no keywords option (the live feed ignores search parameters)');
  else fail('the provider appears to accept keywords, which the feed cannot honor');
} catch (e) {
  fail(`emploi-territorial tests crashed: ${e.message}`);
}
