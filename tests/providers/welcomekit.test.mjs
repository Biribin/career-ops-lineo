// tests/providers/welcomekit.test.mjs — WelcomeKit, Welcome to the Jungle's
// legacy ATS, served as HTML at `<slug>.welcomekit.co`.
//
// What these tests protect:
//   1. The board's real markup (observed 2026-08-12 on a 40-posting board) stays
//      parseable: MIXED single and double attribute quotes in the same document,
//      an `<i>` icon before every value, and relative hrefs. Each of those three
//      details breaks a naive parser.
//   2. The host stays pinned. `careers_url` is not always hand-written (entries
//      are created from France Travail offer URLs too), so a lookalike host must
//      not become a board.
//   3. A relative URL becomes absolute: the URL is the scanner's dedup key, so a
//      relative one would be unusable.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — welcomekit');

// Faithful excerpt of the real board: single quotes on `jobs-list-item` and
// `jobs-list-item-title`, double on `jobs-list-item-link`, icons before values,
// relative hrefs.
const BOARD = `<!DOCTYPE html><html class='nutripure'><head><title>Jobs</title></head><body>
<ul class='jobs-list'>
  <li class='jobs-list-item' data-department='38206' data-office='28372'>
    <a class="jobs-list-item-link" href="/jobs/data-platform-engineer_toulouse"><h3 class='jobs-list-item-title'> Data Platform Engineer </h3>
      <ul class='jobs-list-item-details'>
        <li class='jobs-list-item-contract-type'> <i class='icon-secondary icon-briefcase'></i> CDI </li>
        <li class='jobs-list-item-office'> <i class='icon-secondary icon-location'></i> Toulouse </li>
      </ul>
    </a></li>
  <li class='jobs-list-item' data-department='38207' data-office='28372'>
    <a class="jobs-list-item-link" href="/jobs/charge-e-d-approvisionnement_paris"><h3 class='jobs-list-item-title'> Charg&eacute;.e d&#39;approvisionnement </h3>
      <ul class='jobs-list-item-details'>
        <li class='jobs-list-item-office'> <i class='icon-secondary icon-location'></i> Paris </li>
      </ul>
    </a></li>
  <li class='jobs-list-item' data-department='38208' data-office='28372'>
    <a class="jobs-list-item-link" href="/jobs/data-platform-engineer_toulouse"><h3 class='jobs-list-item-title'> Data Platform Engineer </h3></a></li>
</ul></body></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/welcomekit.mjs')).href);
  const welcomekit = mod.default;
  const { parseWelcomekitBoard, boardOrigin } = mod;

  if (welcomekit.id === 'welcomekit') pass('welcomekit.id is "welcomekit"');
  else fail(`welcomekit.id is ${JSON.stringify(welcomekit.id)}`);

  const jobs = parseWelcomekitBoard(BOARD, 'https://nutripure.welcomekit.co/', 'Nutripure');

  // Three blocks, but the third repeats the first one's URL: the scanner's dedup
  // key is the URL, so one role listed under two departments must not count twice.
  if (jobs.length === 2) pass('postings are parsed and deduped by URL');
  else fail(`parseWelcomekitBoard returned ${jobs.length} posting(s): ${JSON.stringify(jobs)}`);

  const first = jobs[0];
  if (
    first?.title === 'Data Platform Engineer' &&
    first?.url === 'https://nutripure.welcomekit.co/jobs/data-platform-engineer_toulouse' &&
    first?.company === 'Nutripure' &&
    first?.location === 'Toulouse'
  ) {
    pass('title, absolute URL, company and location are surfaced');
  } else {
    fail(`unexpected first posting: ${JSON.stringify(first)}`);
  }

  // The `<i>` icon precedes the location in the markup: without stripping tags,
  // `location` would carry the icon along with the text.
  if (!/icon|<|>/.test(String(first?.location))) pass('location carries no leftover markup');
  else fail(`polluted location: ${JSON.stringify(first?.location)}`);

  // HTML entities must be decoded — "Chargé.e d'approvisionnement", not
  // "Charg&eacute;.e d&#39;...", or the scanner's keyword filter no longer
  // recognizes the title.
  if (jobs[1]?.title === "Chargé.e d'approvisionnement") pass('HTML entities in the title are decoded');
  else fail(`title not decoded: ${JSON.stringify(jobs[1]?.title)}`);

  // A document with no posting at all (unknown slug: the board answers 200 with a
  // tiny body) must produce nothing — that is what lets verify-portals NOT take it
  // for an existing tenant.
  if (parseWelcomekitBoard('<html><body>nothing here</body></html>', 'https://x.welcomekit.co/').length === 0) {
    pass('an empty board yields zero postings');
  } else {
    fail('an empty board produced postings');
  }

  if (parseWelcomekitBoard('', 'https://x.welcomekit.co/').length === 0 && parseWelcomekitBoard(null, 'https://x.welcomekit.co/').length === 0) {
    pass('empty or null input does not throw');
  } else {
    fail('parseWelcomekitBoard is not guarded against empty input');
  }

  // --- Host pinning --------------------------------------------------------
  const viaCareers = welcomekit.detect({ name: 'Nutripure', careers_url: 'https://nutripure.welcomekit.co/' });
  const viaApi = welcomekit.detect({ name: 'Nutripure', api: 'https://nutripure.welcomekit.co/' });
  if (viaCareers?.url === 'https://nutripure.welcomekit.co/' && viaApi?.url === 'https://nutripure.welcomekit.co/') {
    pass('detect() claims a *.welcomekit.co board, from careers_url and from api');
  } else {
    fail(`detect() on a legitimate URL = ${JSON.stringify({ viaCareers, viaApi })}`);
  }

  const rejected = [
    { name: 'http', entry: { careers_url: 'http://nutripure.welcomekit.co/' } },
    { name: 'lookalike host', entry: { careers_url: 'https://evil.example/nutripure.welcomekit.co' } },
    { name: 'suffix spoof', entry: { careers_url: 'https://welcomekit.co.evil.example/' } },
    { name: 'bare domain', entry: { careers_url: 'https://welcomekit.co/' } },
    { name: 'another ATS', entry: { careers_url: 'https://jobs.lever.co/acme' } },
    { name: 'no URL', entry: { name: 'Acme' } },
  ];
  const leaks = rejected.filter((r) => boardOrigin(r.entry) !== null).map((r) => r.name);
  if (leaks.length === 0) pass('no non-welcomekit URL passes for a board');
  else fail(`boardOrigin() accepted: ${leaks.join(', ')}`);

  // fetch() must refuse outright rather than go and fetch something else.
  let refused = false;
  try {
    await welcomekit.fetch({ name: 'Acme', careers_url: 'https://jobs.lever.co/acme' }, { fetchText: async () => BOARD });
  } catch {
    refused = true;
  }
  if (refused) pass('fetch() refuses an entry that is not a welcomekit board');
  else fail('fetch() accepted a non-welcomekit entry');

  // Nominal path: a single text request, no pagination (the board renders every
  // posting at once — verified against the real board).
  let requests = 0;
  const fetched = await welcomekit.fetch(
    { name: 'Nutripure', careers_url: 'https://nutripure.welcomekit.co/' },
    { fetchText: async () => { requests += 1; return BOARD; } },
  );
  if (fetched.length === 2 && requests === 1) pass('fetch() returns the postings in a single request');
  else fail(`fetch(): ${fetched.length} posting(s) in ${requests} request(s)`);
} catch (e) {
  fail(`welcomekit provider tests crashed: ${e.message}`);
}
