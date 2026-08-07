#!/usr/bin/env node
// Lit une page carrière au navigateur et imprime ses offres en JSON sur stdout.
//
// Branché via le provider `local-parser` (providers/local-parser.mjs), qui est
// le point d'entrée sanctionné pour un employeur sans API. Dans portals.yml :
//
//   - name: Lindy
//     careers_url: https://www.lindy.ai/careers
//     parser:
//       command: node
//       args: [scrapers/careers-page.mjs, --url, "{careers_url}", --company, "{company}"]
//       timeout_ms: 90000
//
// CE FICHIER NE DÉCIDE RIEN. Il ouvre la page, récolte trois matières premières
// (JSON-LD, réponses d'API, liens) et les passe à careers-extract.mjs, qui est
// pur et testé. Tout ce qui est ici dépend d'un navigateur et d'un site tiers,
// donc tout ce qui est ici est intestable — raison de plus pour qu'il n'y ait
// aucune règle métier dedans.
//
// CONTRAT DE SORTIE, strict : stdout ne contient QUE du JSON. local-parser fait
// JSON.parse(stdout) et échoue sur le moindre caractère parasite. Les
// diagnostics vont sur stderr, où local-parser les remonte en cas d'erreur.

import { parseArgs } from 'node:util';
import {
  choisirMeilleureSource,
  offresDepuisApi,
  offresDepuisJsonLd,
  offresDepuisLiens,
  reponseInteressante,
} from './careers-extract.mjs';

const DELAI_NAVIGATION_MS = 45_000;
// Après le premier rendu, une SPA continue de charger ses offres en XHR. Sans
// cette fenêtre, on capturait la page vide et on ne voyait aucune offre.
const DELAI_RESEAU_MS = 6_000;
// Délai laissé aux offres pour APPARAÎTRE après le premier rendu. Constaté sur
// des pages qui répondent 200 avec zéro lien : le squelette arrive, la liste
// suit une seconde plus tard.
const DELAI_OFFRES_MS = 12_000;

/**
 * Libellés d'acceptation des bandeaux cookies. Sur les sites européens le
 * bandeau est posé en overlay plein écran : tant qu'il est là, la liste
 * d'offres n'est pas rendue et on repart avec zéro lien.
 *
 * On ne clique QUE sur l'acceptation. Refuser ouvre souvent un second panneau
 * de réglages, ce qui bloquerait la page pour de bon. Rien n'est persisté : le
 * contexte navigateur est jeté à la fin.
 */
const BOUTONS_CONSENTEMENT = [
  'Tout accepter',
  'Accepter tout',
  'Accepter',
  "J'accepte",
  'Accept all',
  'Accept All Cookies',
  'Accept cookies',
  'Accept',
  'Allow all',
  'Got it',
  'I agree',
  'Alle akzeptieren',
  'Aceptar todo',
];
// Une page carrière ne pèse pas 40 Mo de JSON : au-delà, c'est un bundle ou un
// flux de télémétrie, et le parser y passerait un temps fou pour rien.
const TAILLE_REPONSE_MAX = 4_000_000;

const journal = (...m) => console.error('[careers-page]', ...m);

function options() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      company: { type: 'string', default: '' },
      // Utile pour diagnostiquer un site à la main : `--montre-le-navigateur`
      // ouvre une fenêtre visible au lieu du mode headless.
      'montre-le-navigateur': { type: 'boolean', default: false },
      // Quand une page rend « 0 offre », la question est toujours la même :
      // quelles réponses a-t-on vues, et à quoi ressemblaient-elles ? Sans ça
      // le diagnostic se fait à l'aveugle. Sortie sur stderr, donc inoffensif
      // pour le contrat JSON de stdout.
      diagnostic: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (!values.url) throw new Error('--url est obligatoire');
  const u = new URL(values.url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`--url doit être en http(s) : ${values.url}`);
  }
  return values;
}

/** Playwright est une dépendance lourde : on diagnostique son absence. */
async function chargeChromium() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch (e) {
    throw new Error(
      `playwright indisponible (${e.message}) — installe-le avec : npx playwright install chromium`,
    );
  }
}

/**
 * Ferme le bandeau cookies s'il y en a un. Best-effort et borné : on essaie
 * chaque libellé une fois, on s'arrête au premier clic réussi, et un échec
 * n'interrompt rien — beaucoup de pages n'ont pas de bandeau du tout.
 */
async function accepteLesCookies(page) {
  for (const libelle of BOUTONS_CONSENTEMENT) {
    try {
      // `getByRole` couvre <button> ET <a role="button">, et l'accord exact
      // évite de cliquer « Accepter uniquement les cookies nécessaires » quand
      // on cherche « Accepter ».
      const bouton = page.getByRole('button', { name: libelle, exact: true }).first();
      if (!(await bouton.isVisible({ timeout: 700 }).catch(() => false))) continue;
      await bouton.click({ timeout: 2500 });
      journal(`bandeau cookies fermé via « ${libelle} »`);
      await page.waitForTimeout(1200);
      return true;
    } catch {
      // Bouton absent, masqué ou déjà disparu : on passe au libellé suivant.
    }
  }
  return false;
}

async function recolte({ url, company, headless, diagnostic }) {
  const chromium = await chargeChromium();
  const navigateur = await chromium.launch({ headless });
  /** @type {unknown[]} */
  const payloadsApi = [];
  try {
    const contexte = await navigateur.newContext({
      // Certaines pages carrière servent une version dégradée aux agents
      // inconnus ; un UA de navigateur courant évite ce faux négatif.
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'fr-FR',
    });
    const page = await contexte.newPage();

    // On écoute AVANT de naviguer, sinon les requêtes du chargement initial —
    // c'est-à-dire précisément celles qui portent les offres — sont manquées.
    page.on('response', async (rep) => {
      try {
        if (!rep.ok()) return;
        if (!reponseInteressante(rep.url(), rep.headers()['content-type'])) return;
        const corps = await rep.body();
        if (corps.length > TAILLE_REPONSE_MAX) return;
        payloadsApi.push({ url: rep.url(), json: JSON.parse(corps.toString('utf8')) });
      } catch {
        // Réponse illisible, déjà consommée ou JSON invalide : ce n'est pas une
        // panne, juste une piste qui ne donne rien. Les autres sources restent.
      }
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DELAI_NAVIGATION_MS });
    // `networkidle` échoue sur les sites qui gardent une connexion ouverte
    // (chat, analytics temps réel) : on l'essaie, et on se rabat sur un délai
    // fixe plutôt que de tout perdre sur un timeout.
    await page
      .waitForLoadState('networkidle', { timeout: DELAI_RESEAU_MS })
      .catch(() => page.waitForTimeout(DELAI_RESEAU_MS));

    await accepteLesCookies(page);

    // Attendre que les offres existent VRAIMENT, plutôt que d'espérer qu'un
    // délai fixe suffise. Si rien n'apparaît on continue quand même : la page
    // n'a peut-être aucune offre, ce qui est une réponse valide.
    await page
      .locator('a[href*="job"], a[href*="career"], a[href*="position"], a[href*="offre"]')
      .first()
      .waitFor({ state: 'attached', timeout: DELAI_OFFRES_MS })
      .catch(() => journal('aucun lien d’offre après attente — page vide, ou liste non-<a>'));

    // Beaucoup de listes se chargent au défilement. Deux passes suffisent à
    // déclencher le lazy-loading sans transformer la sonde en robot d'aspiration.
    for (let i = 0; i < 2; i += 1) {
      await page.mouse.wheel(0, 4000).catch(() => {});
      await page.waitForTimeout(1200);
    }

    const blocsLd = (
      await page
        .locator('script[type="application/ld+json"]')
        .allTextContents()
        .catch(() => [])
    )
      .map((t) => {
        try {
          return JSON.parse(t);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const liens = await page
      .$$eval('a[href]', (as) =>
        as.slice(0, 3000).map((a) => ({
          href: a.getAttribute('href'),
          text: a.textContent,
          // Le texte d'un <a> qui enveloppe une carte entière concatène tout :
          // « Software Engineer InternshipSan Francisco, OnsiteLearn more ».
          // Un titre interne, quand il existe, donne l'intitulé seul.
          titre:
            a.querySelector('h1,h2,h3,h4,h5,h6')?.textContent ??
            a.querySelector('[class*="title" i],[class*="titre" i],[data-testid*="title" i]')?.textContent ??
            // Mise en page « bouton Postuler » : le lien ne contient que
            // « Apply now » et l'intitulé vit dans la carte parente (constaté
            // sur Factorial). Sans cette remontée, ces offres sont invisibles.
            a
              .closest('article,li,tr,[class*="card" i],[class*="job" i],[class*="position" i],[class*="opening" i]')
              ?.querySelector('h1,h2,h3,h4,h5,h6')?.textContent ??
            null,
          // Dernier recours : le texte RENDU de la carte parente. Factorial
          // n'utilise aucune balise de titre — son intitulé est un <div> stylé.
          // innerText (et non textContent) respecte les sauts de ligne visuels,
          // ce qui permet d'isoler la première ligne : l'intitulé.
          conteneur:
            a.closest('article,li,tr,[class*="card" i],[class*="job" i],[class*="position" i],[class*="opening" i]')
              ?.innerText ?? null,
          // `aria-label` porte souvent l'intitulé propre sur les cartes sans titre.
          aria: a.getAttribute('aria-label'),
        })),
      )
      .catch(() => []);

    if (diagnostic) {
      journal(`${liens.length} lien(s) dans le DOM, ${payloadsApi.length} réponse(s) JSON retenue(s)`);
      for (const { url: u, json } of payloadsApi) {
        const forme = Array.isArray(json) ? `tableau[${json.length}]` : Object.keys(json ?? {}).slice(0, 12).join(',');
        journal(`  ← ${u.slice(0, 110)}  {${forme}}`);
      }
      // Les hrefs les plus fréquents disent tout de suite si la page a une
      // liste d'offres qu'on rate, ou si elle est réellement vide.
      const echantillon = liens.filter((a) => /job|career|position|offre/i.test(a.href || '')).slice(0, 8);
      for (const a of echantillon) journal(`  a → ${String(a.href).slice(0, 80)} « ${String(a.text).trim().slice(0, 50)} »`);
    }

    // L'URL finale, pas celle demandée : après une redirection, résoudre les
    // liens relatifs contre l'ancienne donnerait des URLs mortes.
    const base = page.url();
    return { base, blocsLd, liens, payloadsApi, company };
  } finally {
    await navigateur.close().catch(() => {});
  }
}

async function main() {
  const opts = options();
  const company = opts.company || '';
  const matiere = await recolte({
    url: opts.url,
    company,
    headless: !opts['montre-le-navigateur'],
    diagnostic: opts.diagnostic,
  });

  const jsonLd = offresDepuisJsonLd(matiere.blocsLd, { base: matiere.base, company });
  // Chaque payload est évalué séparément puis on garde le meilleur : fusionner
  // les réponses d'endpoints différents mélangerait deux formats et deux bases
  // d'URL.
  let api = [];
  for (const { json } of matiere.payloadsApi) {
    const trouve = offresDepuisApi(json, { base: matiere.base, company });
    if (trouve.length > api.length) api = trouve;
  }
  const liens = offresDepuisLiens(matiere.liens, { base: matiere.base, company });

  const { jobs, source } = choisirMeilleureSource({ jsonLd, api, liens });
  journal(
    `${matiere.base} → ${jobs.length} offre(s) via ${source}`,
    `(json-ld:${jsonLd.length} api:${api.length}/${matiere.payloadsApi.length} liens:${liens.length})`,
  );

  // `jobs` même vide : local-parser accepte un tableau vide et l'entreprise
  // ressortira « live but empty », ce qui est l'information juste. Sortir en
  // erreur ferait croire à une panne du scraper.
  process.stdout.write(JSON.stringify({ jobs, source }));
}

main().catch((e) => {
  journal('échec —', e?.message || e);
  process.exit(1);
});
