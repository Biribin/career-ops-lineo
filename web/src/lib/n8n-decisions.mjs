// Logique pure du pont n8n ↔ career-ops. Les chemins sont INJECTÉS (comme
// resolvePdfPaths) pour que les tests n'aient jamais besoin d'un vrai repo cv
// ni du tracker de Linéo.
//
// n8n (VPS) prépare une candidature complète puis s'ARRÊTE sur un nœud Wait en
// reprise-par-webhook. Avant de s'arrêter il dépose une « fiche » JSON dans le
// repo cv (data-inbox/<id>.json) portant la decision_url de cette exécution.
//
// Le VPS ne peut pas joindre le PC de Linéo (NAT), l'inverse marche. D'où
// l'asymétrie assumée : la DEMANDE descend par GitHub (git pull), la DÉCISION
// remonte par HTTP (POST). Aucun démon — le clic de Linéo EST le déclencheur.

import fs from "node:fs";
import path from "node:path";

/**
 * @typedef {Object} Fiche
 * @property {string} schema
 * @property {string} id
 * @property {string} statut
 * @property {string} [source]
 * @property {string} [cree_le]
 * @property {string} [execution_id]
 * @property {string} [decision_url]
 * @property {string[]} [decisions_acceptees]
 * @property {number} [revision]
 * @property {string} [poste]
 * @property {string} [entreprise]
 * @property {string|null} [lieu]
 * @property {string} [url_offre]
 * @property {string} [courriel_contact]
 * @property {string} [pourquoi_ca_matche]
 * @property {string} [objet_mail]
 * @property {string} [salutation]
 * @property {string} [apercu_lettre]
 * @property {string[]|string} [arguments_cles]
 * @property {string} [branche_github]
 * @property {string} [cv_pdf]
 * @property {string} [lettre_docx]
 * @property {string} [cv_url]
 * @property {string} [lettre_url]
 */

/**
 * @typedef {"valider"|"retoucher_lettre"|"retoucher_cv"|"refuser"} Decision
 */

/**
 * @typedef {Object} Journal
 * @property {string} id
 * @property {Decision} decision
 * @property {string} [consigne]
 * @property {string} [raison]
 * @property {string} at
 * @property {string} [execution_id]
 * @property {number|null} [n8nStatus]
 * @property {string|null} [n8nError]
 * @property {boolean} [trackerApplique]
 * @property {string|null} [trackerErreur]
 */

/**
 * @typedef {Fiche & {decidable: boolean, retouches: number, derniereConsigne?: string}} FicheEnAttente
 */

/** Les 4 décisions que n8n sait router. Toute autre valeur part en alerte. */
export const DECISIONS = ["valider", "retoucher_lettre", "retoucher_cv", "refuser"];

/**
 * Les arguments de `set-status.mjs` pour inscrire un refus au tracker.
 *
 * POURQUOI `--create`. Une candidature préparée par n8n n'a AUCUNE ligne au
 * tracker : les lignes naissent du flux d'évaluation local. Sans `--create`, le
 * script sortait en erreur (« No tracker row with company matching … ») et la
 * raison du refus n'atteignait jamais `data/applications.md` — donc jamais
 * `analyze-patterns.mjs`, ni `/stats`, ni `/analytics`. Constaté le 2026-08-07
 * sur trois refus réels : raison enregistrée dans le journal et en base, absente
 * des statistiques. Or capturer ce motif est la SEULE raison pour laquelle une
 * raison est rendue obligatoire à la saisie.
 *
 * Symétrique de ce que `/api/tracker/set-status` fait déjà pour l'envoi.
 *
 * Le rôle n'est pas décoratif : `set-status.mjs --create` l'exige, parce qu'une
 * ligne sans rôle ne peut plus être départagée ensuite. Sans rôle exploitable on
 * ne crée donc RIEN, et on le dit — plutôt que de miner une ligne muette.
 *
 * @param {{scriptPath: string, entreprise?: string, poste?: string, raison?: string}} args
 * @returns {{ok: true, args: string[], creation: boolean} | {ok: false, motif: string}}
 */
export function argsRefusTracker({ scriptPath, entreprise = "", poste = "", raison = "" }) {
  // Le pipe et les sauts de ligne casseraient la rangée du tableau markdown.
  const propre = (v) => String(v ?? "").replace(/[|\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  const societe = propre(entreprise);
  const role = propre(poste);
  const motif = propre(raison);

  if (!societe) return { ok: false, motif: "fiche sans entreprise : rien à retrouver ni à créer dans le tracker" };

  const args = [scriptPath, societe, "Discarded", "--note", `DISCARD: ${motif}`, "--json"];
  if (role) args.push("--role", role);

  // `--create` refuse un sélecteur purement numérique : un nombre nu désigne une
  // ligne existante, pas une entreprise. Une raison de plus de ne pas l'ajouter
  // à l'aveugle.
  const creation = Boolean(role) && !/^\d+$/.test(societe);
  if (creation) args.push("--create");

  return { ok: true, args, creation };
}

/** `valider` et `refuser` closent la candidature ; les retouches font un aller-retour. */
const TERMINALES = new Set(["valider", "refuser"]);

/**
 * @param {unknown} v
 * @returns {v is Decision}
 */
export function estDecision(v) {
  return typeof v === "string" && DECISIONS.includes(v);
}

/** Un POST qui a réellement rouvert la porte chez n8n. */
function transmise(d) {
  return d.n8nStatus != null && d.n8nStatus < 400;
}

/**
 * Valide UN texte JSON comme fiche n8n. Le schéma est le contrat : sans lui,
 * ce n'est pas une fiche. Renvoie null au lieu de jeter, parce qu'une fiche
 * corrompue ne doit pas faire disparaître les autres de l'écran.
 *
 * Extrait de `lireFiches` pour être réutilisé par la source GitHub
 * (cv-inbox.mjs) : les deux sources doivent appliquer EXACTEMENT le même filtre,
 * sinon une fiche visible en local serait invisible sur le VPS, ou l'inverse.
 *
 * @param {string} brut
 * @returns {Fiche|null}
 */
export function parseFiche(brut) {
  let f;
  try {
    f = JSON.parse(brut);
  } catch {
    return null;
  }
  if (!f || typeof f !== "object") return null;
  if (!String(f.schema ?? "").startsWith("career-ops-inbox/")) return null;
  if (!f.id || typeof f.id !== "string") return null;
  return f;
}

/**
 * Lit toutes les fiches déposées par n8n dans un clone local du repo cv. Un
 * fichier illisible ou hors-schéma est ignoré : le dossier est aussi un dossier
 * git (README, .jsonl…).
 *
 * @param {string} inboxDir
 * @returns {Fiche[]}
 */
export function lireFiches(inboxDir) {
  let noms;
  try {
    noms = fs.readdirSync(inboxDir);
  } catch {
    return [];
  }
  const out = [];
  for (const nom of noms) {
    if (!nom.endsWith(".json")) continue;
    let brut;
    try {
      brut = fs.readFileSync(path.join(inboxDir, nom), "utf8");
    } catch {
      continue;
    }
    const f = parseFiche(brut);
    if (f) out.push(f);
  }
  return out;
}

/**
 * Lit le journal local des décisions. Une ligne corrompue est ignorée, pas
 * fatale : le journal est append-only et une écriture interrompue ne doit pas
 * rendre tout l'historique illisible.
 *
 * @param {string} journalPath
 * @returns {Journal[]}
 */
export function lireJournal(journalPath) {
  let brut;
  try {
    brut = fs.readFileSync(journalPath, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const ligne of brut.split("\n")) {
    const t = ligne.trim();
    if (!t) continue;
    try {
      const j = JSON.parse(t);
      if (j && typeof j.id === "string" && estDecision(j.decision)) out.push(j);
    } catch {
      continue;
    }
  }
  return out;
}

/**
 * Ajoute une ligne au journal (append-only, crée le dossier au besoin).
 *
 * @param {string} journalPath
 * @param {Journal} entree
 */
export function ajouterAuJournal(journalPath, entree) {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.appendFileSync(journalPath, JSON.stringify(entree) + "\n", "utf8");
}

/**
 * Vrai si une décision terminale a déjà été transmise pour cet id — le garde
 * anti-double-clic côté serveur.
 *
 * @param {Journal[]} journal
 * @param {string} id
 */
export function dejaClose(journal, id) {
  return journal.some((j) => j.id === id && TERMINALES.has(j.decision) && transmise(j));
}

/**
 * Les candidatures qui attendent réellement une décision.
 *
 * Une fiche disparaît dès qu'une décision terminale est TRANSMISE (POST accepté
 * par n8n). C'est le journal local qui fait foi, pas `statut` : n8n ne réécrit
 * pas la fiche après coup — il n'a pas besoin de le savoir, et un aller-retour
 * GitHub de plus serait un point de panne supplémentaire sur le chemin critique.
 * Un POST en échec laisse l'exécution parkée, donc la fiche reste visible.
 *
 * Une retouche ne clôt rien : n8n revient à la porte et redépose la fiche avec
 * `revision` incrémentée. Tant que `revision` n'a pas rattrapé le nombre de
 * retouches transmises, l'aller-retour est encore en vol et la fiche est
 * marquée non-décidable — re-POSTer tomberait sur une URL qui n'attend plus.
 *
 * @param {string} inboxDir
 * @param {string} journalPath
 * @returns {FicheEnAttente[]}
 */
export function fichesEnAttente(inboxDir, journalPath) {
  return fichesEnAttenteDepuis(lireFiches(inboxDir), lireJournal(journalPath));
}

/**
 * Même logique que `fichesEnAttente`, mais sur des fiches DÉJÀ lues. C'est le
 * cœur pur : il ne connaît ni le disque ni le réseau, donc il est partagé par la
 * source « clone local » et la source « API GitHub » (cf. cv-inbox.mjs).
 *
 * @param {Fiche[]} toutesLesFiches
 * @param {Journal[]} journal
 * @returns {FicheEnAttente[]}
 */
export function fichesEnAttenteDepuis(toutesLesFiches, journal) {
  const parId = new Map();
  for (const j of journal) {
    const liste = parId.get(j.id) ?? [];
    liste.push(j);
    parId.set(j.id, liste);
  }

  const out = [];
  for (const f of toutesLesFiches) {
    const decisions = parId.get(f.id) ?? [];
    if (dejaClose(decisions, f.id)) continue;

    const retouches = decisions.filter((d) => !TERMINALES.has(d.decision) && transmise(d)).length;
    const derniere = [...decisions].reverse().find((d) => !TERMINALES.has(d.decision));

    out.push({
      ...f,
      retouches,
      decidable: Number(f.revision ?? 0) >= retouches,
      derniereConsigne: derniere?.consigne || undefined,
    });
  }

  // Les plus anciennes d'abord : elles bloquent une exécution n8n depuis le plus longtemps.
  out.sort((a, b) => String(a.cree_le ?? "").localeCompare(String(b.cree_le ?? "")));
  return out;
}
