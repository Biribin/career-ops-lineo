// Source « API GitHub » des fiches n8n, alternative au clone local du repo cv.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Le pont n8n ↔ career-ops a été écrit pour le PC de Linéo, où `career-ops/` et
// `cv/` sont voisins : la demande descend par `git pull`, la décision remonte par
// HTTP. Depuis que career-ops tourne dans un conteneur sur le VPS, il n'y a plus
// ni clone de `cv`, ni credential git pour un dépôt privé : la page « À valider »
// affichait « clone introuvable à /cv » et le bouton de récupération ne faisait
// rien (le `git pull` est gardé par la présence du clone, donc il était sauté).
//
// Ici on lit les fiches directement par l'API contents de GitHub. Pas de clone,
// pas de git, pas de volume à monter — et c'est déjà exactement ce que n8n
// utilise pour les y déposer.
//
// `fetch` est INJECTÉ, comme les chemins le sont dans n8n-decisions.mjs : les
// tests n'ont besoin ni de réseau, ni de token, ni de dépôt.

import { parseFiche } from "./n8n-decisions.mjs";

/** Plafond de fiches lues par appel. Au-delà on le DIT plutôt que de tronquer en silence. */
export const MAX_FICHES = 50;

const ENTETES = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "career-ops-web",
};

/**
 * @typedef {Object} ResultatInbox
 * @property {import("./n8n-decisions.mjs").Fiche[]} fiches
 * @property {string|null} erreur   Message lisible, null si tout va bien.
 * @property {number} tronquees     Nombre de fiches ignorées à cause du plafond.
 * @property {number} illisibles    Fiches présentes mais hors-schéma ou corrompues.
 */

/**
 * Lit `data-inbox/*.json` d'un dépôt GitHub via l'API contents.
 *
 * Un 404 sur le dossier n'est PAS une erreur : ça veut dire qu'aucune
 * candidature n'a encore été déposée. Distinguer les deux compte, parce que
 * « rien à valider » et « je n'arrive pas à lire » demandent des réactions
 * opposées de la part de Linéo.
 *
 * @param {Object} o
 * @param {typeof globalThis.fetch} o.fetch
 * @param {string} o.owner
 * @param {string} o.repo
 * @param {string} o.branch
 * @param {string} o.token
 * @param {string} [o.dossier]
 * @param {number} [o.max]
 * @param {number} [o.timeoutMs]
 * @returns {Promise<ResultatInbox>}
 */
export async function fichesDepuisGitHub({
  fetch,
  owner,
  repo,
  branch,
  token,
  dossier = "data-inbox",
  max = MAX_FICHES,
  timeoutMs = 20_000,
}) {
  const vide = { fiches: [], erreur: null, tronquees: 0, illisibles: 0 };

  if (!owner || !repo || !token) {
    return { ...vide, erreur: "configuration GitHub incomplète (owner, repo ou token manquant)" };
  }

  const base = `https://api.github.com/repos/${owner}/${repo}/contents`;
  const auth = { ...ENTETES, Authorization: `Bearer ${token}` };
  const signal = () => AbortSignal.timeout(timeoutMs);

  let listage;
  try {
    listage = await fetch(`${base}/${dossier}?ref=${encodeURIComponent(branch)}`, {
      headers: auth,
      signal: signal(),
      cache: "no-store",
    });
  } catch (e) {
    return { ...vide, erreur: `API GitHub injoignable : ${e instanceof Error ? e.message : String(e)}` };
  }

  // Dossier absent = aucune candidature déposée. État normal, pas une panne.
  if (listage.status === 404) return vide;
  if (listage.status === 401 || listage.status === 403) {
    return { ...vide, erreur: `GitHub a refusé le token (HTTP ${listage.status}) : vérifie CV_GITHUB_TOKEN et ses droits sur ${owner}/${repo}` };
  }
  if (!listage.ok) {
    return { ...vide, erreur: `GitHub a répondu ${listage.status} en listant ${dossier}` };
  }

  let entrees;
  try {
    entrees = await listage.json();
  } catch {
    return { ...vide, erreur: "réponse GitHub illisible en listant l'inbox" };
  }
  if (!Array.isArray(entrees)) {
    return { ...vide, erreur: `${dossier} n'est pas un dossier dans ${owner}/${repo}@${branch}` };
  }

  // Sous-dossiers écartés : `data-inbox/relances/` est l'historique des relances
  // automatiques, ce ne sont pas des candidatures à valider.
  const candidates = entrees.filter(
    (e) => e && e.type === "file" && typeof e.name === "string" && e.name.endsWith(".json"),
  );
  const retenues = candidates.slice(0, max);
  const tronquees = candidates.length - retenues.length;

  const lues = await Promise.all(
    retenues.map(async (e) => {
      try {
        const rep = await fetch(`${base}/${encodeURI(e.path)}?ref=${encodeURIComponent(branch)}`, {
          headers: auth,
          signal: signal(),
          cache: "no-store",
        });
        if (!rep.ok) return null;
        const corps = await rep.json();
        if (!corps || typeof corps.content !== "string") return null;
        const texte = Buffer.from(corps.content.replace(/\n/g, ""), "base64").toString("utf8");
        return parseFiche(texte);
      } catch {
        return null;
      }
    }),
  );

  const fiches = lues.filter(Boolean);
  return {
    fiches,
    erreur: null,
    tronquees,
    illisibles: retenues.length - fiches.length,
  };
}
