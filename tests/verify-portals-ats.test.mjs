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
//   3. Fix (2) landed inline in discoverAlternates only, so the OTHER discovery
//      path — `--add` — kept suggesting a guessed SmartRecruiters slug for every
//      name on earth (caught 2026-08-11). Both paths now share
//      probeProvesTenant() and slugProbePlan().
//
// All three are pinned below. Every probe here injects `fetchJson`: this suite
// must never touch the network, or it would fail whenever an ATS is down.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ATS,
  parseAtsSlug,
  probeProvesTenant,
  probeSlug,
  runAdd,
  verifyCompanies,
} from '../verify-portals.mjs';

/** Un board WelcomeKit minimal mais fidèle (une offre). */
const BOARD_WK = `<li class='jobs-list-item'><a class="jobs-list-item-link" href="/jobs/x_toulouse"><h3 class='jobs-list-item-title'>Un poste</h3></a></li>`;

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

test('probeProvesTenant : un 200 vide ne prouve rien là où un slug inconnu ne 404 pas', () => {
  // La règle que les deux chemins de découverte doivent partager. Un board
  // peuplé est toujours une preuve ; un board vide ne l'est que sur un ATS qui
  // répond 404 à un slug inventé.
  assert.equal(probeProvesTenant({ status: 'live', ats: 'smartrecruiters' }), true);
  assert.equal(probeProvesTenant({ status: 'empty', ats: 'greenhouse' }), true);
  assert.equal(probeProvesTenant({ status: 'empty', ats: 'smartrecruiters' }), false);
  assert.equal(probeProvesTenant({ status: 'missing', ats: 'greenhouse' }), false);
  assert.equal(probeProvesTenant(null), false);
});

test("--add ne suggère plus un slug SmartRecruiters deviné (régression 2026-08-11)", async () => {
  // Cas réel du 2026-08-11 : un employeur sans aucun locataire SmartRecruiters
  // (son board est chez WelcomeKit), pour qui l'API répond quand même 200 + zéro
  // offre sur chacune des 8 variantes de slug. L'ancienne boucle de --add les
  // comptait comme des hits et en promouvait une en « Suggested: » — un slug que
  // personne ne peut utiliser, écrit dans portals.yml, qui 404 en silence à
  // chaque scan suivant.
  const lignes = [];
  const { best, hits, inconclusive } = await runAdd('Ghostcorp', {
    fetchJson: fauxFetch({ 'api.smartrecruiters.com': { totalFound: 0, content: [] } }),
    log: (ligne) => lignes.push(ligne),
  });
  assert.equal(best, null);
  assert.deepEqual(hits, []);
  // Les sondes ont bien répondu 200 : le rapport doit dire ce qu'il a écarté,
  // sinon « rien trouvé » se lit comme « rien n'a répondu ».
  assert.equal(inconclusive, 8);
  const sortie = lignes.join('\n');
  assert.ok(!sortie.includes('Suggested'), sortie);
  assert.ok(sortie.includes('inconclusive'), sortie);
});

test('--add suggère en revanche un board SmartRecruiters peuplé', async () => {
  const { best } = await runAdd('Acme', {
    fetchJson: fauxFetch({
      'companies/acme/postings': { totalFound: 7, content: [{ id: '1' }] },
    }),
    log: () => {},
  });
  assert.equal(best?.ats, 'smartrecruiters');
  assert.equal(best?.jobCount, 7);
});

test('--add sonde aussi l\'instance Lever EU', async () => {
  // Son ancienne boucle n'itérait pas le drapeau eu, donc un locataire EU-only
  // était indécouvrable par --add alors que le cross-probe le trouvait.
  const { best } = await runAdd('Diabolocom', {
    fetchJson: fauxFetch({ 'api.eu.lever.co/v0/postings/diabolocom': [{}, {}] }),
    log: () => {},
  });
  assert.equal(best?.ats, 'lever');
  assert.equal(best?.eu, true);
  assert.equal(best?.jobCount, 2);
});

// ── WelcomeKit : un ATS servi en HTML, ajouté le 2026-08-12 ─────────────────
//
// C'était le trou par lequel des employeurs français entiers échappaient à la
// découverte : les quatre autres ATS sont la pile des startups américaines.

test('probeSlug WelcomeKit : un board peuplé est live, et compté', async () => {
  const r = await probeSlug('welcomekit', 'nutripure', {
    fetchJson: fauxFetch({}),
    fetchText: async (url) => {
      assert.equal(url, 'https://nutripure.welcomekit.co/');
      return BOARD_WK;
    },
  });
  assert.equal(r.status, 'live');
  assert.equal(r.jobCount, 1);
});

test("un slug WelcomeKit inconnu répond 200 + vide : ça ne prouve RIEN", async () => {
  // Constaté sur le vif le 2026-08-12 : `zzzzzz-ceci-nexiste-pas-42.welcomekit.co`
  // répond 200 avec 63 octets et zéro offre — exactement le piège
  // SmartRecruiters. D'où le drapeau, et donc le refus de suggérer.
  const r = await probeSlug('welcomekit', 'ceci-nexiste-pas-42', {
    fetchJson: fauxFetch({}),
    fetchText: async () => '<html><body></body></html>',
  });
  assert.equal(r.status, 'empty');
  assert.equal(ATS.welcomekit.emptyProvesTenant, false);
  assert.equal(probeProvesTenant(r), false);
});

test('un sondage texte SANS transport injecté ne va pas sur le réseau', async () => {
  // LA garde qui garde cette suite hors-ligne : sans elle, chaque test qui
  // n'injecte que `fetchJson` partirait pour de vrai vers welcomekit.co, et la
  // suite tomberait dès que le réseau ou le board bouge.
  const r = await probeSlug('welcomekit', 'nutripure', { fetchJson: fauxFetch({}) });
  assert.equal(r.status, 'missing');
  assert.match(String(r.reason), /text transport/);
});

test('--add trouve un board WelcomeKit quand aucun ATS JSON ne résout', async () => {
  const { best } = await runAdd('Nutripure', {
    fetchJson: fauxFetch({}), // tout 404 côté JSON
    fetchText: async (url) => (url === 'https://nutripure.welcomekit.co/' ? BOARD_WK : ''),
    log: () => {},
  });
  assert.equal(best?.ats, 'welcomekit');
  assert.equal(best?.slug, 'nutripure');
  assert.equal(best?.jobCount, 1);
});

test("un careers_url welcomekit.co ne matche PAS le tier 1", () => {
  // Même raison que SmartRecruiters : l'entrée doit tomber dans la couche
  // provider (providers/welcomekit.mjs), qui est le code que le scanner exécute.
  assert.equal(parseAtsSlug('https://nutripure.welcomekit.co/'), null);
});
