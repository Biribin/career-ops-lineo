/**
 * annonce-source.mjs — retrouver le TEXTE d'une annonce à partir de son URL.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `/api/pipeline/evaluate` doit lire l'annonce pour repérer les exigences
 * bloquantes. Sa première version faisait un `fetch` de la page et détourait le
 * HTML. Ça marche sur une page statique, et pas du tout sur un ATS moderne :
 * `jobs.ashbyhq.com` est une application React, la page brute ne contient aucun
 * texte d'offre. Constaté en production le 2026-08-07 sur
 * `andromeda / Forward Deployed Engineer - SRE` : « annonce illisible ».
 *
 * Or ces annonces sont parfaitement lisibles — par l'API publique du tableau,
 * celle-là même que `providers/ashby.mjs` et `providers/greenhouse.mjs`
 * interrogent déjà pour DÉCOUVRIR l'offre. Le scanner sait donc en parler ; il
 * ne rapportait simplement pas la description.
 *
 * On ne relance pas un navigateur sans tête pour ça : c'est lent, lourd, et
 * inutile quand une API JSON publique donne le texte propre. Le rendu de page
 * reste le repli, pour tout ce qui n'est pas un ATS connu.
 *
 * Module pur : il ne fait aucun accès réseau lui-même. Il dit QUOI aller
 * chercher, et sait lire la réponse. L'appelant fournit le `fetch` — c'est ce
 * qui le rend testable sans réseau.
 */

/** Ashby : `https://jobs.ashbyhq.com/<slug>/<id>` */
const ASHBY_RE = /^https?:\/\/jobs\.ashbyhq\.com\/([^/?#]+)\/([^/?#]+)/i;

/** Greenhouse : `https://job-boards(.eu).greenhouse.io/<org>/jobs/<id>` */
const GREENHOUSE_RE = /^https?:\/\/job-boards(?:\.eu)?\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i;

/** Lever : `https://jobs.lever.co/<org>/<id>` */
const LEVER_RE = /^https?:\/\/jobs\.lever\.co\/([^/?#]+)\/([^/?#]+)/i;

/**
 * Le plan de lecture pour une URL : quelle requête faire, et comment en tirer
 * le texte. `null` = aucun ATS reconnu, l'appelant retombe sur la page.
 *
 * @param {string} url
 * @returns {{ats: string, requete: string, extrait: (payload: unknown) => string}|null}
 */
export function planAnnonce(url) {
  const u = String(url ?? "").trim();

  const ashby = u.match(ASHBY_RE);
  if (ashby) {
    const [, slug, id] = ashby;
    return {
      ats: "ashby",
      // L'API ne sert que le tableau entier : il n'y a pas d'endpoint par offre.
      requete: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
      extrait: (payload) => {
        const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        // On apparie par l'id present dans jobUrl : `id` seul n'est pas toujours
        // celui de l'URL publique selon les tableaux.
        const j =
          jobs.find((x) => String(x?.jobUrl ?? "").includes(id)) ??
          jobs.find((x) => String(x?.id ?? "") === id) ??
          null;
        return j ? String(j.descriptionPlain ?? "") : "";
      },
    };
  }

  const gh = u.match(GREENHOUSE_RE);
  if (gh) {
    const [, org, id] = gh;
    return {
      ats: "greenhouse",
      requete: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(org)}/jobs/${id}?content=true`,
      // `content` est du HTML avec des entites echappees : le detourage est
      // fait par l'appelant, qui a deja la fonction pour la page brute.
      extrait: (payload) => String(payload?.content ?? ""),
    };
  }

  const lever = u.match(LEVER_RE);
  if (lever) {
    const [, org, id] = lever;
    return {
      ats: "lever",
      requete: `https://api.lever.co/v0/postings/${encodeURIComponent(org)}?mode=json`,
      extrait: (payload) => {
        const jobs = Array.isArray(payload) ? payload : [];
        const j = jobs.find((x) => String(x?.id ?? "") === id) ?? null;
        return j ? String(j.descriptionPlain ?? j.description ?? "") : "";
      },
    };
  }

  return null;
}

/**
 * Décode les entités HTML les plus courantes et retire les balises.
 *
 * Partagé entre le repli « page brute » et le `content` de Greenhouse, qui est
 * du HTML échappé : sans ça, l'annonce arrive au modèle pleine de `&lt;p&gt;`
 * et il évalue un balisage au lieu d'un texte.
 */
export function texteDepuisHtml(html) {
  const sansBalises = (s) =>
    s
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");

  const decode = (s) =>
    s
      .replace(/&(?:nbsp|#160);/gi, " ")
      .replace(/&(?:lt|#60);/gi, "<")
      .replace(/&(?:gt|#62);/gi, ">")
      .replace(/&(?:quot|#34);/gi, '"')
      .replace(/&(?:#39|apos|rsquo|#8217);/gi, "'")
      // `&amp;` en DERNIER : le decoder avant transformerait `&amp;lt;` en `<`,
      // c'est-a-dire une balise la ou l'annonce ecrivait litteralement `&lt;`.
      .replace(/&(?:amp|#38);/gi, "&");

  // DEUX passes, et l'ordre est le sujet : le `content` de Greenhouse est du
  // HTML ECHAPPE (`&lt;p&gt;`). Retirer les balises d'abord n'y touche pas, le
  // decodage revele alors de vraies balises, d'ou la seconde passe. Faire
  // l'inverse (decoder puis retirer) casserait une page brute qui cite du HTML
  // dans son texte : le fragment cite deviendrait une balise et emporterait le
  // texte jusqu'au `>` suivant.
  return sansBalises(decode(sansBalises(String(html ?? ""))))
    .replace(/\s+/g, " ")
    .trim();
}
