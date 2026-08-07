// Extraction d'offres depuis une page carrière — la partie pure.
//
// Ces tests portent sur ce qui décide, pas sur le navigateur : le pilote
// Playwright ne fait que récolter. C'est aussi la seule façon d'avoir une
// couverture stable, un site tiers pouvant changer ou tomber n'importe quand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_OFFRES,
  choisirMeilleureSource,
  lieuLisible,
  normalise,
  offresDepuisApi,
  offresDepuisJsonLd,
  offresDepuisLiens,
  reponseInteressante,
  urlAbsolue,
} from '../scrapers/careers-extract.mjs';

const BASE = 'https://example.test/careers';

test('urlAbsolue résout le relatif et rejette ce qui n’est pas du web', () => {
  assert.equal(urlAbsolue('/jobs/42', BASE), 'https://example.test/jobs/42');
  assert.equal(urlAbsolue('https://autre.test/x', BASE), 'https://autre.test/x');
  // Un `javascript:` ou un `mailto:` finirait comme lien d'annonce dans le
  // tracker, où il ne mène nulle part.
  assert.equal(urlAbsolue('javascript:void(0)', BASE), '');
  assert.equal(urlAbsolue('mailto:rh@example.test', BASE), '');
  assert.equal(urlAbsolue('', BASE), '');
});

test('normalise déduplique sur l’URL et exige titre + lien', () => {
  const r = normalise(
    [
      { title: 'Ingénieur', url: '/jobs/1' },
      { title: 'Ingénieur (postuler)', url: '/jobs/1' }, // même offre, 2e lien
      { title: '', url: '/jobs/2' }, // sans titre
      { title: 'Sans lien', url: '' },
    ],
    { base: BASE, company: 'Acme' },
  );
  assert.equal(r.length, 1);
  assert.deepEqual(r[0], {
    title: 'Ingénieur',
    url: 'https://example.test/jobs/1',
    company: 'Acme',
    location: '',
  });
});

test('normalise borne le nombre d’offres', () => {
  const beaucoup = Array.from({ length: MAX_OFFRES + 50 }, (_, i) => ({
    title: `Poste ${i}`,
    url: `/jobs/${i}`,
  }));
  assert.equal(normalise(beaucoup, { base: BASE }).length, MAX_OFFRES);
});

test('lieuLisible aplatit les formes de schema.org', () => {
  assert.equal(
    lieuLisible({ address: { addressLocality: 'Paris', addressCountry: 'FR' } }),
    'Paris, FR',
  );
  assert.equal(lieuLisible(['Paris', 'Lyon']), 'Paris, Lyon');
  assert.equal(lieuLisible('Remote'), 'Remote');
  assert.equal(lieuLisible(null), '');
});

test('JSON-LD : lit les JobPosting, y compris sous @graph', () => {
  const r = offresDepuisJsonLd(
    [
      {
        '@graph': [
          { '@type': 'Organization', name: 'Acme' },
          {
            '@type': 'JobPosting',
            title: 'Développeur RPA',
            url: '/jobs/rpa',
            jobLocation: { address: { addressLocality: 'Lille' } },
            hiringOrganization: { name: 'Acme' },
          },
        ],
      },
    ],
    { base: BASE },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0].title, 'Développeur RPA');
  assert.equal(r[0].location, 'Lille');
  assert.equal(r[0].company, 'Acme');
});

test('JSON-LD : ignore ce qui n’est pas une offre', () => {
  const r = offresDepuisJsonLd(
    [{ '@type': 'WebSite', name: 'Acme', url: '/' }, { '@type': 'BreadcrumbList' }],
    { base: BASE },
  );
  assert.deepEqual(r, []);
});

test('API : retient le PLUS GRAND tableau d’offres, pas le premier', () => {
  // Cas réel : une page liste 2 offres « en vedette » avant la vraie liste.
  // Prendre le premier tableau rencontré ne ramenait que les vedettes.
  const payload = {
    featured: [
      { title: 'Vedette A', url: '/jobs/a' },
      { title: 'Vedette B', url: '/jobs/b' },
    ],
    data: {
      positions: [
        { title: 'Poste 1', absolute_url: '/jobs/1', location: { name: 'Paris' } },
        { title: 'Poste 2', absolute_url: '/jobs/2', location: { name: 'Remote' } },
        { title: 'Poste 3', absolute_url: '/jobs/3', location: { name: 'Lyon' } },
      ],
    },
  };
  const r = offresDepuisApi(payload, { base: BASE, company: 'Acme' });
  assert.equal(r.length, 3);
  assert.equal(r[0].title, 'Poste 1');
  assert.equal(r[0].location, 'Paris');
});

test('API : un tableau hétérogène n’est pas une liste d’offres', () => {
  // Deux éléments sur cinq ont par hasard un `name` et un `link`. Sans la
  // règle de majorité, ce menu de navigation passait pour du recrutement.
  const payload = {
    nav: [
      { name: 'Accueil', link: '/' },
      { name: 'Blog', link: '/blog' },
      { icone: 'x' },
      { icone: 'y' },
      { icone: 'z' },
    ],
  };
  assert.deepEqual(offresDepuisApi(payload, { base: BASE }), []);
});

test('API : ne boucle pas sur une structure cyclique', () => {
  // Un payload qui se référence lui-même ferait tourner la descente à l'infini
  // sans la garde `vu`. Le test vaut surtout par le fait qu'il TERMINE.
  const cycle = { liste: [{ title: 'Poste', url: '/jobs/1' }] };
  cycle.self = cycle;
  const r = offresDepuisApi(cycle, { base: BASE });
  assert.deepEqual(
    r.map((o) => o.url),
    ['https://example.test/jobs/1'],
  );
});

test('reponseInteressante filtre sur le contenu ET l’URL', () => {
  assert.equal(reponseInteressante('https://x.test/api/jobs', 'application/json'), true);
  assert.equal(reponseInteressante('https://x.test/graphql', 'application/json; charset=utf-8'), true);
  // Du HTML ou du JS n'est jamais un payload d'API exploitable ici.
  assert.equal(reponseInteressante('https://x.test/api/jobs', 'text/html'), false);
  // La télémétrie parle souvent JSON et contient parfois « api » : inutile de
  // la parser à chaque page.
  assert.equal(reponseInteressante('https://x.test/api/analytics', 'application/json'), false);
});

test('liens : accepte une vraie liste, refuse les liens de navigation', () => {
  const r = offresDepuisLiens(
    [
      { href: '/careers/ingenieur-donnees', text: 'Ingénieur données' },
      { href: '/careers/chef-de-produit', text: 'Chef de produit' },
      { href: '/careers', text: 'Voir toutes nos offres' }, // libellé de menu
      { href: '/blog/on-recrute', text: 'On recrute chez nous' }, // pas une fiche
      { href: '/careers/x', text: 'Postuler' }, // verbe d'action
    ],
    { base: BASE, company: 'Acme' },
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].title, 'Ingénieur données');
});

test('liens : le titre balisé gagne contre le texte concaténé du lien', () => {
  // Cas Lindy : le <a> enveloppe toute la carte, donc son textContent colle le
  // poste, le lieu et le « Learn more ». Le <h3> interne porte l'intitulé seul.
  const r = offresDepuisLiens(
    [
      {
        href: '/jobs/656963-software-engineer-internship',
        text: 'Software Engineer InternshipSan Francisco, OnsiteLearn more',
        titre: 'Software Engineer Internship',
      },
      { href: '/jobs/657855-product-manager', text: 'Product ManagerSan Francisco', titre: 'Product Manager' },
    ],
    { base: BASE },
  );
  assert.deepEqual(
    r.map((o) => o.title),
    ['Software Engineer Internship', 'Product Manager'],
  );
});

test('liens : « Apply now » cède la place à l’intitulé de la carte parente', () => {
  // Cas Factorial : le lien n'est qu'un bouton, et la carte n'a AUCUNE balise de
  // titre — l'intitulé est un <div> stylé. Sans la remontée au conteneur, ses
  // 119 offres étaient invisibles. Et sans « premier candidat ACCEPTABLE » (au
  // lieu de « premier non vide »), c'est « Apply now » qui l'emportait.
  const r = offresDepuisLiens(
    [
      {
        href: 'https://x.test/job_posting/design-system-engineer-314309',
        text: 'Apply now',
        conteneur: 'Design System Engineer\nBarcelona\nApply now',
      },
      {
        href: 'https://x.test/job_posting/engineering-manager-312936',
        text: 'Apply now',
        conteneur: 'Engineering Manager\nRemote\nApply now',
      },
    ],
    { base: BASE },
  );
  assert.deepEqual(
    r.map((o) => o.title),
    ['Design System Engineer', 'Engineering Manager'],
  );
});

test('liens : accepte un segment intermédiaire dans l’URL', () => {
  // Cas Vinted : /jobs/j/4938529101. Exiger l'identifiant juste après /jobs/
  // rejetait ses 20 offres alors qu'elles étaient bien dans la page.
  const r = offresDepuisLiens(
    [
      { href: '/jobs/j/4938529101', text: 'Analytics Engineer, Marketing DSA' },
      { href: '/jobs/e/4864756101', text: 'Chef d’équipe adjoint' },
      { href: '/jobs', text: 'Toutes nos offres' }, // la liste, pas une offre
    ],
    { base: BASE },
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].url, 'https://example.test/jobs/j/4938529101');
});

test('liens : une seule trouvaille ne fait pas une page carrière', () => {
  // Un lien isolé qui matche est plus probablement un article de blog qu'une
  // offre : on préfère ne rien rendre que d'inventer une candidature.
  const r = offresDepuisLiens([{ href: '/jobs/unique-poste', text: 'Un seul poste ici' }], {
    base: BASE,
  });
  assert.deepEqual(r, []);
});

test('la source la plus sûre gagne, et on sait laquelle', () => {
  const jsonLd = [{ title: 'A', url: 'https://x.test/1' }];
  const api = [{ title: 'B', url: 'https://x.test/2' }];
  const liens = [{ title: 'C', url: 'https://x.test/3' }];

  // On ne fusionne PAS : la même offre apparaît sous deux URLs selon la source,
  // et Linéo verrait des doublons.
  assert.deepEqual(choisirMeilleureSource({ jsonLd, api, liens }), { jobs: jsonLd, source: 'json-ld' });
  assert.deepEqual(choisirMeilleureSource({ api, liens }), { jobs: api, source: 'api' });
  assert.deepEqual(choisirMeilleureSource({ liens }), { jobs: liens, source: 'liens' });
  assert.deepEqual(choisirMeilleureSource({}), { jobs: [], source: 'aucune' });
});
