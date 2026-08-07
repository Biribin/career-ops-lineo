// Tier-1 ATS layer of verify-portals: slug parsing and slug probing.
//
// This layer had no coverage at all, which is how the SmartRecruiters addition
// nearly shipped two silent regressions:
//
//   1. A `careers.smartrecruiters.com/...` careers_url matched at tier 1 and
//      short-circuited the provider layer, so the health check reported "live"
//      through an endpoint the real scanner never calls.
//   2. SmartRecruiters answers HTTP 200 + `{totalFound: 0, content: []}` for
//      ANY slug, so every failing company drew a confident
//      "→ try smartrecruiters/<guess>" suggestion built from a guess.
//
// Both are pinned below. Every probe here injects `fetchJson`: this suite must
// never touch the network, or it would fail whenever an ATS is down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATS, parseAtsSlug, probeSlug, verifyCompanies } from '../verify-portals.mjs';

/** An HTTP 404, shaped the way providers/_http.mjs throws it. */
function http404() {
  const err = new Error('HTTP 404 Not Found');
  err.status = 404;
  return err;
}

/** fetchJson stub driven by a url→payload map; anything unlisted 404s. */
function fauxFetch(reponses) {
  return async (url) => {
    for (const [fragment, payload] of Object.entries(reponses)) {
      if (url.includes(fragment)) {
        if (payload instanceof Error) throw payload;
        return payload;
      }
    }
    throw http404();
  };
}

test('parseAtsSlug reconnaît les trois ATS sondables en un GET', () => {
  assert.deepEqual(parseAtsSlug('https://boards.greenhouse.io/anthropic'), {
    ats: 'greenhouse',
    slug: 'anthropic',
  });
  assert.deepEqual(parseAtsSlug('https://jobs.ashbyhq.com/elevenlabs'), {
    ats: 'ashby',
    slug: 'elevenlabs',
  });
  assert.equal(parseAtsSlug('https://jobs.lever.co/example')?.ats, 'lever');
  // L'instance européenne doit rester distinguée, sinon on sonde le mauvais
  // datacenter et un employeur EU devient invisible.
  assert.equal(parseAtsSlug('https://jobs.eu.lever.co/example')?.eu, true);
});

test("un careers_url SmartRecruiters ou Workday ne matche PAS le tier 1", () => {
  // LA garde anti-régression. `null` ici ne veut pas dire « ignoré » : ça veut
  // dire « confié à providers/smartrecruiters.mjs et providers/workday.mjs »,
  // qui sont le code réellement exécuté par le scanner. Faire matcher ces URLs
  // ici rendrait le health-check faussement rassurant.
  assert.equal(parseAtsSlug('https://careers.smartrecruiters.com/Visa'), null);
  assert.equal(parseAtsSlug('https://jobs.smartrecruiters.com/Ubisoft'), null);
  assert.equal(parseAtsSlug('https://aah.wd5.myworkdayjobs.com/external'), null);
  assert.equal(parseAtsSlug('https://exampleco.wd5.myworkdayjobs.com/en-US/exampleco'), null);
});

test('un hôte contrefait ne passe pas pour un board ATS', () => {
  // Le nom d'hôte est épinglé, pas cherché n'importe où dans l'URL.
  assert.equal(parseAtsSlug('https://evil.example/jobs.lever.co/x'), null);
  assert.equal(parseAtsSlug('https://evil.example/boards.greenhouse.io/x'), null);
});

test('probeSlug SmartRecruiters : live si le board a des offres', async () => {
  const r = await probeSlug('smartrecruiters', 'visa', {
    fetchJson: fauxFetch({ 'companies/visa/postings': { totalFound: 42, content: [{ id: '1' }] } }),
  });
  assert.equal(r.status, 'live');
  // `limit=1` tronque `content` : c'est `totalFound` qui porte le vrai total.
  // Lire content.length rapporterait 1 offre pour un board qui en a 42.
  assert.equal(r.jobCount, 42);
});

test('probeSlug SmartRecruiters : un slug inconnu répond 200 + vide, pas 404', async () => {
  const r = await probeSlug('smartrecruiters', 'ceci-nexiste-pas-du-tout-42', {
    fetchJson: fauxFetch({ postings: { totalFound: 0, content: [] } }),
  });
  // Constaté en vrai le 2026-08-07 : l'API ne distingue pas une entreprise
  // absente d'une entreprise sans offre. D'où le drapeau ci-dessous.
  assert.equal(r.status, 'empty');
  assert.equal(ATS.smartrecruiters.emptyProvesTenant, false);
});

test("une réponse hors-forme n'est jamais comptée comme un board", async () => {
  const r = await probeSlug('smartrecruiters', 'x', {
    fetchJson: fauxFetch({ postings: { message: 'Not Found' } }),
  });
  assert.equal(r.status, 'missing');
});

test("un board SmartRecruiters vide ne devient pas une suggestion", async () => {
  // Slug greenhouse mort + SmartRecruiters qui répond vide (donc : aucune
  // preuve). Sans emptyProvesTenant:false, la sortie afficherait
  // « → try smartrecruiters/acme » alors que rien n'a été trouvé.
  const resultats = await verifyCompanies(
    [{ name: 'Acme', careers_url: 'https://boards.greenhouse.io/acme' }],
    { fetchJson: fauxFetch({ 'smartrecruiters': { totalFound: 0, content: [] } }) },
  );
  assert.equal(resultats[0].status, 'missing');
  assert.equal(resultats[0].suggested, undefined);
});

test('un board SmartRecruiters peuplé, lui, est bien suggéré', async () => {
  const resultats = await verifyCompanies(
    [{ name: 'Acme', careers_url: 'https://boards.greenhouse.io/acme' }],
    {
      fetchJson: fauxFetch({
        'companies/acme/postings': { totalFound: 7, content: [{ id: '1' }] },
      }),
    },
  );
  assert.equal(resultats[0].status, 'missing');
  assert.equal(resultats[0].suggested?.ats, 'smartrecruiters');
  assert.equal(resultats[0].suggested?.jobCount, 7);
});
