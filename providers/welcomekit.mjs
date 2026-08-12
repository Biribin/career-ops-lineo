// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
/** @typedef {import('./_types.js').Job} Job */
//
// WelcomeKit — l'ATS historique de Welcome to the Jungle, qui sert encore le
// board carrières public de beaucoup d'employeurs français, sur
// `<slug>.welcomekit.co`.
//
// POURQUOI CE PROVIDER EXISTE
// ---------------------------
// C'était le trou par lequel des employeurs entiers échappaient au scanner. La
// recherche d'ATS ne sondait que Greenhouse / Ashby / Lever / SmartRecruiters —
// la pile des startups américaines — et rendait donc « aucun slug ne résout »
// pour un employeur français dont le board tourne ici (constaté le 2026-08-11
// sur un employeur suivi : board bien vivant, 40 postes, invisible pour
// career-ops).
//
// Le board est RENDU CÔTÉ SERVEUR : pas d'API JSON (vérifié le 2026-08-12 —
// `/jobs.json`, `/api/v1/jobs` répondent 404, et `?format=json` annonce
// `application/json` en renvoyant du HTML, donc ne pas s'y fier), mais un
// balisage stable et complet dans la page :
//
//   <li class='jobs-list-item' data-department='38206' data-office='28372'>
//     <a class="jobs-list-item-link" href="/jobs/mon-poste_toulouse">
//       <h3 class='jobs-list-item-title'> Mon poste </h3>
//       <ul class='jobs-list-item-details'>
//         <li class='jobs-list-item-contract-type'>…CDI</li>
//         <li class='jobs-list-item-office'>…Toulouse</li>
//
// UNE SEULE REQUÊTE : la page liste l'intégralité des postes, sans pagination
// (aucun marqueur `pagination` / `page=` / load-more dans le document). Un board
// de 40 offres arrive donc en un GET, ce qui respecte aussi le budget de
// requêtes du health-check.
//
// Le type de contrat (CDI, stage…) est présent dans le balisage mais volontairement
// PAS remonté : la forme `Job` normalisée n'a pas de champ pour ça, et en inventer
// un que personne ne consomme serait un changement de schéma gratuit.

import { decodeEntities } from './_html-entities.mjs';

const HOST_SUFFIX = '.welcomekit.co';

/**
 * Le texte d'un fragment HTML : balises retirées, entités décodées, espaces
 * normalisés. Le balisage du board place une icône `<i>` avant chaque valeur,
 * donc retirer les balises est obligatoire avant de lire un lieu.
 *
 * @param {string} fragment
 * @returns {string}
 */
function texte(fragment) {
  return decodeEntities(String(fragment ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La valeur d'un `<li class='jobs-list-item-XXX'>` dans un bloc d'offre.
 *
 * Les guillemets d'attributs sont acceptés simples OU doubles : le board mélange
 * les deux dans le même document (`class='jobs-list-item'` mais
 * `class="jobs-list-item-link"`), donc épingler un seul style casserait sur
 * l'autre.
 *
 * @param {string} bloc
 * @param {string} classe - Suffixe de classe, ex. 'office'.
 * @returns {string}
 */
function detail(bloc, classe) {
  const re = new RegExp(`<li[^>]*class=['"]jobs-list-item-${classe}['"][^>]*>([\\s\\S]*?)<\\/li>`, 'i');
  const m = bloc.match(re);
  return m ? texte(m[1]) : '';
}

/**
 * Parser un board WelcomeKit en offres normalisées.
 *
 * Exporté pour être testé hors réseau : `fetch()` ne fait que l'envelopper.
 *
 * @param {string} html - Le document du board.
 * @param {string} origine - L'origine du board (`https://slug.welcomekit.co`),
 *   pour absolutiser les liens relatifs — l'URL est la clé de déduplication du
 *   scanner, donc un lien relatif la rendrait inutilisable.
 * @param {string} [entreprise] - Nom à porter sur chaque offre.
 * @returns {Job[]}
 */
export function parseWelcomekitBoard(html, origine, entreprise = '') {
  const doc = String(html ?? '');
  // Découpage sur les frontières de `<li class='jobs-list-item'>`. Le premier
  // morceau est l'en-tête de page : il ne porte pas d'offre.
  const morceaux = doc.split(/<li[^>]*class=['"]jobs-list-item['"]/i);
  const offres = [];
  const vues = new Set();

  for (let i = 1; i < morceaux.length; i++) {
    const bloc = morceaux[i];
    const lien = bloc.match(/<a[^>]*class=['"]jobs-list-item-link['"][^>]*href=['"]([^'"]+)['"]/i)
      || bloc.match(/<a[^>]*href=['"]([^'"]+)['"][^>]*class=['"]jobs-list-item-link['"]/i);
    const titre = bloc.match(/<h3[^>]*class=['"]jobs-list-item-title['"][^>]*>([\s\S]*?)<\/h3>/i);
    if (!lien || !titre) continue;

    const title = texte(titre[1]);
    if (!title) continue;

    let url;
    try {
      url = new URL(decodeEntities(lien[1]), origine).toString();
    } catch {
      continue; // href inexploitable : une offre sans URL n'est pas dédupliquable
    }
    // Le même poste peut être listé sous deux départements : la clé de dédup du
    // scanner est l'URL, on l'applique donc déjà ici.
    if (vues.has(url)) continue;
    vues.add(url);

    offres.push({
      title,
      url,
      company: entreprise,
      location: detail(bloc, 'office'),
    });
  }

  return offres;
}

/**
 * L'origine du board pour une entrée, si elle est légitime.
 *
 * Épinglée sur `*.welcomekit.co` en https, comme chaque provider épingle son
 * hôte : `careers_url` n'est pas toujours écrit à la main (des entrées sont
 * créées depuis des URL d'offres venues de France Travail), donc l'hôte doit
 * être vérifié et non deviné.
 *
 * @param {{careers_url?: string, api?: string, provider?: string, name?: string}} entree
 * @returns {string|null}
 */
export function origineBoard(entree) {
  for (const brut of [entree?.api, entree?.careers_url]) {
    if (typeof brut !== 'string' || !brut) continue;
    let u;
    try {
      u = new URL(brut);
    } catch {
      continue;
    }
    if (u.protocol !== 'https:') continue;
    const h = u.hostname.toLowerCase();
    if (h.endsWith(HOST_SUFFIX) && h.length > HOST_SUFFIX.length) return `https://${h}/`;
  }
  return null;
}

/** @type {Provider} */
export default {
  id: 'welcomekit',

  detect(entry) {
    const url = origineBoard(entry);
    return url ? { url } : null;
  },

  async fetch(entry, ctx) {
    const url = origineBoard(entry);
    if (!url) throw new Error(`welcomekit: careers_url n'est pas un board *.welcomekit.co pour ${entry?.name ?? '(sans nom)'}`);
    const html = await ctx.fetchText(url);
    return parseWelcomekitBoard(html, url, typeof entry?.name === 'string' ? entry.name : '');
  },
};
