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
 * Les réponses qui disent que la PORTE N'EXISTE PLUS : l'exécution n8n a été
 * reprise, a expiré, ou le workflow a été rechargé. Ce n'est pas une panne
 * passagère — re-POSTer n'y changera jamais rien.
 *
 * Distinguer ces deux cas est ce qui répare le symptôme signalé par Linéo (« les
 * offres que je rejette reviennent ») : un refus qui tombait sur un 404 restait
 * non transmis, donc la fiche restait affichée, à chaque chargement de page, pour
 * toujours — et le fichier de la fiche, lui, ne quitte jamais data-inbox.
 */
const PORTE_DISPARUE = new Set([404, 410]);

/**
 * Vrai si un REFUS a bien été enregistré ici alors que n8n n'attendait plus.
 *
 * Réservé au refus, volontairement. Un refus n'envoie rien à personne : le
 * tracker est écrit, la raison est au journal, la décision de Linéo est prise et
 * complète — la garder à l'écran ne lui demande rien qu'il puisse faire.
 *
 * `valider` sur une porte disparue est l'inverse : le mail N'EST PAS parti. La
 * fiche doit rester visible, même si aucun re-POST ne la débloquera, parce que la
 * faire disparaître ferait passer une candidature approuvée mais jamais envoyée
 * pour une candidature envoyée.
 *
 * @param {Journal} d
 */
function closEnLocal(d) {
  return d.decision === "refuser" && d.n8nStatus != null && PORTE_DISPARUE.has(d.n8nStatus);
}

/**
 * @param {unknown} v
 * @returns {v is Decision}
 */
export function estDecision(v) {
  return typeof v === "string" && DECISIONS.includes(v);
}

/**
 * Un POST qui a réellement rouvert la porte chez n8n.
 *
 * Exporté pour la file « À déposer » (a-deposer.mjs), qui doit distinguer une
 * validation TRANSMISE — n8n est reparti, le dossier à déposer a été préparé —
 * d'une validation seulement enregistrée au journal, qui laisse l'exécution
 * parquée et n'a donc rien préparé du tout. Une seule définition, sinon les deux
 * files ne parleraient pas du même « validé ».
 *
 * @param {Journal} d
 */
export function transmise(d) {
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
 * Lit le journal local des décisions ET rapporte ce qui n'a pas pu être relu.
 *
 * POURQUOI CE DÉTAIL EXISTE. `lireJournal` rend une liste vide sur n'importe
 * quelle panne de lecture. Pour la file « À valider » c'est sans danger — une
 * fiche dont on ne connaît pas la décision reste AFFICHÉE, donc l'échec se voit.
 * Pour la file « À déposer » (a-deposer.mjs) c'est l'inverse : sans journal,
 * aucune candidature n'est « validée », la file paraît vide et la page annonce
 * « rien à déposer » alors qu'elle n'a rien pu lire. C'est le mensonge que le
 * reste de ce fichier s'applique à éviter.
 *
 * Fichier ABSENT ≠ panne : c'est l'état d'une installation où aucune décision
 * n'a encore été prise (`ajouterAuJournal` crée le fichier au premier clic), et
 * une file vide est alors la vérité. Tout le reste — droits, chemin qui est un
 * dossier, disque — remonte dans `erreur`.
 *
 * Une ligne corrompue reste non-fatale (le journal est append-only, une écriture
 * interrompue ne doit pas rendre tout l'historique illisible), mais elle est
 * maintenant COMPTÉE au lieu d'être perdue en silence.
 *
 * @param {string} journalPath
 * @returns {{journal: Journal[], erreur: string|null, illisibles: number}}
 */
export function lireJournalDetaille(journalPath) {
  let brut;
  try {
    brut = fs.readFileSync(journalPath, "utf8");
  } catch (e) {
    const absent = e && typeof e === "object" && e.code === "ENOENT";
    return {
      journal: [],
      erreur: absent ? null : (e instanceof Error ? e.message : "lecture du journal impossible"),
      illisibles: 0,
    };
  }
  const out = [];
  let illisibles = 0;
  for (const ligne of brut.split("\n")) {
    const t = ligne.trim();
    if (!t) continue;
    let j;
    try {
      j = JSON.parse(t);
    } catch {
      illisibles++;
      continue;
    }
    // Une ligne JSON valide mais qui n'est pas une décision reconnue est tout
    // aussi perdue pour la suite : elle compte, sinon un `decision` mal écrit
    // par une future version de n8n disparaîtrait sans un mot.
    if (j && typeof j.id === "string" && estDecision(j.decision)) out.push(j);
    else illisibles++;
  }
  return { journal: out, erreur: null, illisibles };
}

/**
 * Le journal seul — la forme qu'attendent `fichesEnAttente` et /api/decisions.
 * Un seul lecteur (`lireJournalDetaille`), pour que les deux files ne puissent
 * pas relire le journal différemment.
 *
 * @param {string} journalPath
 * @returns {Journal[]}
 */
export function lireJournal(journalPath) {
  return lireJournalDetaille(journalPath).journal;
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
 * Vrai si cette candidature est TRANCHÉE — le garde anti-double-clic côté
 * serveur, et le filtre de la liste « À valider ».
 *
 * Deux façons de l'être, et la seconde n'est pas une tolérance : soit n8n a
 * accepté une décision terminale, soit c'était un refus et n8n n'attendait plus
 * (cf. closEnLocal). Sans ce second cas, un refus arrivé après l'expiration de
 * l'exécution laissait la fiche à l'écran indéfiniment : Linéo la refusait, elle
 * revenait, et aucun clic ne pouvait plus rien y faire.
 *
 * @param {Journal[]} journal
 * @param {string} id
 */
export function dejaClose(journal, id) {
  return journal.some((j) => j.id === id && ((TERMINALES.has(j.decision) && transmise(j)) || closEnLocal(j)));
}

/**
 * Vrai si n8n a fait savoir qu'il n'attendait plus cette décision. Exporté pour
 * que la route puisse répondre « enregistré ici » plutôt que « échec », sans
 * réécrire le test des codes.
 *
 * @param {number|null|undefined} n8nStatus
 */
export function porteDisparue(n8nStatus) {
  return n8nStatus != null && PORTE_DISPARUE.has(n8nStatus);
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
