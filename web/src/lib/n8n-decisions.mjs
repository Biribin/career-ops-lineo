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
 * Lit toutes les fiches déposées par n8n. Un fichier illisible ou hors-schéma
 * est ignoré : le dossier est aussi un dossier git (README, .jsonl…), et une
 * fiche corrompue ne doit pas faire disparaître les autres de l'écran.
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
    try {
      const f = JSON.parse(brut);
      // Le schéma est le contrat : sans lui, ce n'est pas une fiche n8n.
      if (!f || typeof f !== "object") continue;
      if (!String(f.schema ?? "").startsWith("career-ops-inbox/")) continue;
      if (!f.id || typeof f.id !== "string") continue;
      out.push(f);
    } catch {
      continue;
    }
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
  const journal = lireJournal(journalPath);
  const parId = new Map();
  for (const j of journal) {
    const liste = parId.get(j.id) ?? [];
    liste.push(j);
    parId.set(j.id, liste);
  }

  const out = [];
  for (const f of lireFiches(inboxDir)) {
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
