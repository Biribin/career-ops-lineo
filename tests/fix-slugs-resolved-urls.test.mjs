// Le writer de fix-slugs.mjs face aux ATS que verify-portals sait suggérer.
//
// resolvedUrls() n'avait de branche que pour greenhouse et ashby, et retombait
// SANS TEST sur la forme Lever pour tout le reste. Le jour où SmartRecruiters a
// rejoint la table de sondage de verify-portals, une suggestion
// `smartrecruiters/<slug>` s'est donc mise à s'écrire dans portals.yml en
// `https://jobs.lever.co/<slug>` — une URL morte, sous une note annonçant une
// migration vers SmartRecruiters. Même dérive que celle qui a produit les
// fausses suggestions de `--add` (cf. tests/verify-portals-ats.test.mjs) : un
// ATS ajouté d'un côté, les consommateurs jamais mis à jour.
//
// Le drapeau `eu` est dans le même cas : la forme Lever le lit depuis toujours,
// mais discoverAlternates ne le posait pas sur ses suggestions, donc un
// locataire EU-only était réparé vers `jobs.lever.co`, qui 404.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFixes, resolvedUrls } from '../fix-slugs.mjs';

/** portals.yml minimal : une entrée dont le slug greenhouse est mort. */
const PORTALS = [
  'tracked_companies:',
  '',
  '  - name: Acme',
  '    careers_url: https://job-boards.greenhouse.io/acme-old',
  '    api: https://boards-api.greenhouse.io/v1/boards/acme-old/jobs',
  '    enabled: true',
  '',
].join('\n');

/** Une ligne de résultat verify-portals : slug mort + alternative trouvée. */
function resultatMissing(suggested) {
  return [
    {
      name: 'Acme',
      ats: 'greenhouse',
      slug: 'acme-old',
      status: 'missing',
      errorKind: 'slug_gone',
      suggested,
    },
  ];
}

test('une suggestion SmartRecruiters ne s\'écrit plus sous la forme Lever', () => {
  const { text, fixes, skipped } = computeFixes(
    PORTALS,
    resultatMissing({ ats: 'smartrecruiters', slug: 'acme', jobCount: 7 }),
    { dateStr: '2026-08-11' },
  );
  assert.equal(skipped.length, 0);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0].careersUrlNew, 'https://careers.smartrecruiters.com/acme');
  assert.ok(!text.includes('jobs.lever.co'), text);
  // Cette forme d'URL est volontairement hors du tier 1 de verify-portals :
  // elle route l'entrée vers providers/smartrecruiters.mjs, le code que le
  // scanner exécute vraiment.
  assert.ok(text.includes('careers_url: https://careers.smartrecruiters.com/acme'), text);
  // L'ancien `api:` greenhouse doit disparaître, sinon le scanner continue
  // d'appeler un endpoint mort.
  assert.ok(!text.includes('boards-api.greenhouse.io'), text);
  assert.ok(text.includes('slug migrated greenhouse->smartrecruiters 2026-08-11'), text);
});

test("une suggestion Lever EU s'écrit sur le bon datacenter", () => {
  const { text, fixes } = computeFixes(
    PORTALS,
    resultatMissing({ ats: 'lever', slug: 'acme', eu: true }),
    { dateStr: '2026-08-11' },
  );
  assert.equal(fixes[0].careersUrlNew, 'https://jobs.eu.lever.co/acme');
  assert.ok(text.includes('jobs.eu.lever.co/acme'), text);
});

test('un ATS inconnu du writer est signalé, pas deviné', () => {
  // La garde anti-régression : le prochain ATS ajouté à verify-portals sans
  // branche ici doit laisser l'entrée intacte et se faire annoncer, au lieu
  // d'être écrit avec la forme d'URL d'un autre ATS.
  const { text, fixes, skipped } = computeFixes(
    PORTALS,
    resultatMissing({ ats: 'workday', slug: 'acme' }),
    { dateStr: '2026-08-11' },
  );
  assert.deepEqual(fixes, []);
  assert.deepEqual(skipped, [{ name: 'Acme', ats: 'workday', slug: 'acme' }]);
  assert.equal(text, PORTALS); // fichier rendu octet pour octet
  assert.equal(resolvedUrls({ ats: 'workday', slug: 'acme' }), null);
});

test('les formes greenhouse et ashby restent inchangées', () => {
  assert.deepEqual(resolvedUrls({ ats: 'greenhouse', slug: 'acme' }), {
    careersUrl: 'https://job-boards.greenhouse.io/acme',
    api: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs',
  });
  assert.deepEqual(resolvedUrls({ ats: 'ashby', slug: 'acme' }), {
    careersUrl: 'https://jobs.ashbyhq.com/acme',
    api: null,
  });
  assert.deepEqual(resolvedUrls({ ats: 'lever', slug: 'acme' }), {
    careersUrl: 'https://jobs.lever.co/acme',
    api: null,
  });
});
