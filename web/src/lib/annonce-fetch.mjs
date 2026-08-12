/**
 * annonce-fetch.mjs — lire le TEXTE d'une annonce, par le meilleur chemin.
 *
 * Extrait de api/pipeline/evaluate, qui n'était plus le seul appelant : générer
 * une candidature a besoin du même texte (le workflow n8n 2 refuse une offre
 * sans `title` ni `description`, et la lettre est rédigée à partir de là). Le
 * garde-fou d'URL ne doit surtout PAS exister en deux copies : c'est une
 * protection SSRF, et une copie dérive.
 *
 * `annonce-source.mjs` reste le module pur (quel ATS, quelle requête, quel
 * extrait) ; ici on ajoute le réseau et le refus des adresses internes.
 */

// Import RELATIF, comme les autres modules de lib/ : l'alias `@/` n'est résolu
// que par le bundler, pas par `node --test`, qui charge ces fichiers tels quels.
import { planAnnonce, texteDepuisHtml } from "./annonce-source.mjs";

const TAILLE_MAX = 800_000;
const DELAI_MS = 25_000;

/**
 * L'URL, si elle est sûre à récupérer.
 *
 * Même garde-fou que /api/contact-lookup : l'URL vient d'une annonce
 * extérieure, donc http(s) seulement et jamais vers une adresse interne.
 *
 * @param {string} brut
 * @returns {URL|null} null = à ne pas récupérer.
 */
export function urlSure(brut) {
  let u;
  try {
    u = new URL(brut);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h.endsWith(".local") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(h) ||
    h.startsWith("[")
  ) {
    return null;
  }
  return u;
}

/**
 * Un GET borné en temps, qui rend null sur tout ce qui n'est pas un 2xx.
 *
 * @param {URL} u
 * @param {string} accept
 * @returns {Promise<Response|null>}
 */
async function recupere(u, accept) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    const r = await fetch(u, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (career-ops pipeline-fit)", accept },
    });
    return r.ok ? r : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Le texte de l'annonce, par le meilleur chemin disponible.
 *
 * D'ABORD l'API publique du tableau ATS quand il est reconnu. Un
 * `jobs.ashbyhq.com` est une application React : récupérer sa page rend une
 * coquille vide, et l'évaluation échouait en « annonce illisible » — constaté en
 * production le 2026-08-07. La même offre est parfaitement lisible par
 * `api.ashbyhq.com`, que `providers/ashby.mjs` interroge déjà pour la découvrir.
 *
 * ENSUITE la page, pour tout le reste (forum, pages statiques). Le repli sert
 * aussi quand l'API d'un ATS reconnu ne rend rien : un tableau peut avoir retiré
 * l'offre alors que la page existe encore.
 *
 * @param {string} brut - L'URL de l'annonce.
 * @returns {Promise<{texte: string, via: string}>} `via` dit par où on est passé
 *   (affiché à l'écran : une évaluation doit pouvoir se justifier).
 */
export async function litAnnonce(brut) {
  const u = urlSure(brut);
  if (!u) return { texte: "", via: "url refusée" };

  const plan = planAnnonce(brut);
  if (plan) {
    const uApi = urlSure(plan.requete);
    const r = uApi ? await recupere(uApi, "application/json") : null;
    if (r) {
      try {
        const texte = texteDepuisHtml(plan.extrait(await r.json()));
        if (texte.length >= 200) return { texte, via: `api ${plan.ats}` };
      } catch {
        /* payload illisible : on retombe sur la page */
      }
    }
  }

  const r = await recupere(u, "text/html,*/*");
  if (!r) return { texte: "", via: plan ? `api ${plan.ats} muette, page injoignable` : "page injoignable" };
  const texte = texteDepuisHtml((await r.text()).slice(0, TAILLE_MAX));
  return { texte, via: plan ? `api ${plan.ats} muette, repli page` : "page" };
}
