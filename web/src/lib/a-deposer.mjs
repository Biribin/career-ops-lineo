// La file « À déposer » : les candidatures que Linéo a validées, mais que
// PERSONNE n'a pu envoyer à sa place.
//
// LE TROU QUE ÇA BOUCHE
// ---------------------
// Le workflow 3 se sépare en deux sur « Courriel recruteur connu ? » :
//
//   courriel connu  → Gmail envoie au recruteur → « career-ops: tracker Applied »
//                     inscrit la ligne au tracker et arme la relance.
//   pas de courriel → « Portail: tout prêt à coller » envoie le dossier à Linéo,
//                     qui dépose lui-même sur l'ATS → et là, RIEN. Le nœud qui
//                     écrit au tracker est branché sur la seule sortie de Gmail.
//
// Constaté sur Nutripure le 2026-08-11 (exécution 973939, ATS welcomekit, aucune
// adresse dans l'annonce) : candidature validée, dossier reçu, déposée à la main,
// et pourtant zéro ligne au tracker. Donc invisible dans « Envoyées », et surtout
// AUCUNE relance armée — la tournée de relances lit le tracker, pas ce que n8n a
// envoyé.
//
// POURQUOI CETTE FILE NE STOCKE RIEN
// ----------------------------------
// Elle est DÉRIVÉE de trois sources qui existent déjà :
//
//   1. le journal local des décisions  → cette candidature a-t-elle été validée ?
//   2. la fiche déposée par n8n        → y avait-il un courriel de recruteur ?
//   3. le tracker (applications.md)    → le dépôt a-t-il déjà été enregistré ?
//
// Aucun quatrième état sur disque, donc aucune désynchronisation possible : le
// clic sur « c'est déposé » écrit la ligne du tracker par le chemin sanctionné
// (/api/tracker/set-status → set-status.mjs), et la fiche quitte la file parce
// que la ligne existe — pas parce qu'un drapeau a été posé quelque part.
//
// Ajouter un état canonique « à déposer » à templates/states.yml aurait été
// l'autre voie. Refusée : ce fichier est la source de vérité PARTAGÉE avec le
// moteur et le TUI, et l'attente d'un dépôt n'est pas un état de la candidature
// chez l'employeur — c'est un état de MA to-do list.
//
// LIMITE ASSUMÉE
// --------------
// La file ne couvre QUE le cas « dépôt manuel ». Une candidature réellement
// postée par Gmail dont l'écriture au tracker aurait échoué (3 tentatives, puis
// `neverError`) n'apparaît pas ici, et c'est voulu : lui demander « c'est
// déposé ? » ferait croire qu'il reste un geste à faire alors que le mail est
// parti. Ce trou-là se voit dans le courriel de confirmation du workflow 3, qui
// remonte l'échec d'écriture.

// Imports RELATIFS : ce module est chargé tel quel par `node --test`, qui ne
// connaît pas l'alias `@/` de Next (cf. cv-inbox.mjs).
import { jetonsTitre, normalise } from "./cle-job.mjs";
import { transmise } from "./n8n-decisions.mjs";

/**
 * @typedef {import("./n8n-decisions.mjs").Fiche} Fiche
 * @typedef {import("./n8n-decisions.mjs").Journal} Journal
 */

/**
 * @typedef {Object} LigneTracker
 * @property {string} [n]
 * @property {string} [company]
 * @property {string} [role]
 * @property {string} [status]
 */

/**
 * @typedef {Fiche & {valideeLe: string, numTracker: string|null, statutTracker: string|null}} FicheADeposer
 */

/**
 * L'identité d'une candidature pour rapprocher une fiche n8n d'une ligne du
 * tracker : `employeur | mots de l'intitulé`.
 *
 * Volontairement PLUS LARGE que `cleJob` (cle-job.mjs), qui inclut la ville :
 * le tracker n'a pas de colonne lieu, donc l'y faire entrer ne rapprocherait
 * jamais rien. Les mots de l'intitulé sont dédoublonnés et triés par
 * `jetonsTitre`, ce qui absorbe « (H/F) », la ponctuation et l'ordre — sans quoi
 * « Développeur intelligence artificielle (H/F) » et « Developpeur intelligence
 * artificielle » seraient deux candidatures différentes.
 *
 * `null` dès qu'il manque l'employeur ou l'intitulé : une clé partielle
 * rapprocherait des candidatures qu'on n'a aucun moyen de reconnaître comme
 * identiques, et ferait disparaître de la file un dépôt jamais fait.
 *
 * @param {{entreprise?: unknown, poste?: unknown}} c
 * @returns {string|null}
 */
export function cleSuivi(c) {
  const employeur = normalise(c?.entreprise);
  const intitule = jetonsTitre(c?.poste);
  if (!employeur || !intitule) return null;
  return `${employeur} | ${intitule}`;
}

/**
 * Vrai si ce statut de tracker atteste qu'on s'est déjà occupé de la
 * candidature — envoyée, ou sortie du jeu (refus, abandon).
 *
 * `canonise` est INJECTÉ (c'est `canonicalizeStatus` de lib/core/states.ts, qui
 * lit templates/states.yml en direct) : le vocabulaire des états ne doit exister
 * qu'à un seul endroit, et surtout pas être recopié ici où il dériverait au
 * premier état ajouté en amont. C'est aussi ce qui rend cette fonction testable
 * sans states.yml.
 *
 * SENS DE L'ÉCHEC : un statut vide, illisible ou hors vocabulaire n'atteste
 * RIEN, donc la fiche RESTE dans la file. C'est la doctrine de cle-job.mjs
 * appliquée ici — « un doublon de trop coûte un clic ; une offre masquée à tort
 * ne se voit jamais ». Un clic de trop sur « c'est déposé » est idempotent
 * (set-status.mjs retrouve la ligne et ne la duplique pas) ; un dépôt oublié ne
 * se rattrape jamais.
 *
 * `Evaluated` non plus n'atteste rien : c'est l'état d'une candidature évaluée
 * en local et pas encore envoyée.
 *
 * @param {string|null|undefined} statut
 * @param {(brut: string) => string|null} canonise
 * @returns {boolean}
 */
export function attesteUnTraitement(statut, canonise) {
  const brut = String(statut ?? "").trim();
  if (!brut) return false;
  const canon = canonise(brut);
  if (!canon) return false;
  return normalise(canon) !== "evaluated";
}

/**
 * Les candidatures validées qui attendent un dépôt manuel.
 *
 * Trois filtres, dans cet ordre :
 *
 *  1. une décision `valider` TRANSMISE à n8n existe au journal. Pas seulement
 *     enregistrée : transmise. Un `valider` dont le POST a échoué laisse
 *     l'exécution parquée, donc n8n n'a jamais préparé le dossier à déposer —
 *     la fiche est encore « à valider », pas « à déposer ».
 *  2. la fiche n'a PAS de courriel de recruteur. C'est le test qui distingue les
 *     deux branches du workflow 3 (cf. l'en-tête de ce fichier). Avec un
 *     courriel, le mail est parti tout seul : il n'y a rien à déposer.
 *  3. aucune ligne du tracker n'atteste d'un traitement. C'est ce filtre qui
 *     fait sortir la fiche de la file au clic sur « c'est déposé », et qui la
 *     garde silencieuse pour les candidatures rattrapées à la main.
 *
 * Les plus anciennement validées d'abord : ce sont celles qu'on risque le plus
 * d'avoir oubliées.
 *
 * @param {Fiche[]} fiches
 * @param {Journal[]} journal
 * @param {LigneTracker[]} lignes
 * @param {(brut: string) => string|null} canonise
 * @returns {FicheADeposer[]}
 */
export function fichesADeposerDepuis(fiches, journal, lignes, canonise) {
  // Date de la validation transmise la plus ANCIENNE : si Linéo a validé deux
  // fois (retouche puis validation), c'est la première qui dit depuis quand le
  // dossier dort.
  const valideeLe = new Map();
  for (const d of journal ?? []) {
    if (d?.decision !== "valider" || !transmise(d)) continue;
    const at = String(d.at ?? "");
    const vu = valideeLe.get(d.id);
    if (vu == null || at < vu) valideeLe.set(d.id, at);
  }

  // Indexé par clé de suivi, en gardant la ligne la PLUS AVANCÉE : une même
  // candidature peut avoir une ligne Evaluated (flux local) et une ligne
  // Applied (rattrapage) si les intitulés ont divergé au point de créer deux
  // rangées. Une seule qui atteste un traitement suffit à sortir de la file.
  const parCle = new Map();
  for (const l of lignes ?? []) {
    const cle = cleSuivi({ entreprise: l?.company, poste: l?.role });
    if (!cle) continue;
    const atteste = attesteUnTraitement(l?.status, canonise);
    const vu = parCle.get(cle);
    if (!vu || (atteste && !vu.atteste)) parCle.set(cle, { ligne: l, atteste });
  }

  const out = [];
  for (const f of fiches ?? []) {
    const validee = valideeLe.get(f?.id);
    if (validee == null) continue;
    if (String(f.courriel_contact ?? "").trim()) continue;

    const cle = cleSuivi(f);
    const suivi = cle ? parCle.get(cle) : undefined;
    if (suivi?.atteste) continue;

    out.push({
      ...f,
      valideeLe: validee,
      // Affichés tels quels : une fiche déjà évaluée en local a une ligne, et le
      // dire évite de croire que le clic va créer un doublon.
      numTracker: suivi?.ligne?.n ?? null,
      statutTracker: suivi?.ligne?.status ?? null,
    });
  }

  out.sort((a, b) => a.valideeLe.localeCompare(b.valideeLe));
  return out;
}
