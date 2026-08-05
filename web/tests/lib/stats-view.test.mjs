// Tests de la projection des statistiques (stats-view.mjs).
//
// Deux régressions que ces tests existent pour empêcher :
//   1. Afficher 0 là où il n'y a PAS DE DONNÉE. Un tracker absent doit rendre
//      null (« — » à l'écran), pas zéro : quatre zéros se lisent comme « le
//      système tourne et ne produit rien », ce qui est faux et décourageant.
//   2. Compter les « envoyées » avec byStatus.Applied, qui baisse à chaque refus.
//      Le bon chiffre est funnel.everApplied.
//
// Run:  node --test tests/lib/stats-view.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chiffresCles,
  entonnoir,
  repartitionStatuts,
  sourcesManquantes,
} from "../../src/lib/stats-view.mjs";

/** La forme que `node stats.mjs` rend quand aucune donnée n'existe — l'état réel
 *  d'une installation neuve, vérifié en vrai le 2026-08-05. */
const VIDE = {
  metadata: {
    generatedAt: "2026-08-05",
    sources: { tracker: false, scanHistory: false, followups: false, portals: true, scanRuns: false, portalHealth: false },
  },
  tracker: null,
  funnel: null,
  scan: null,
  portals: { configuredCompanies: 115, configuredBoards: 12 },
  followups: null,
  runs: null,
};

/** Un pipeline en cours : 12 envois, 3 réponses, 1 entretien, 4 refus. */
const REMPLI = {
  metadata: { generatedAt: "2026-08-05", sources: { tracker: true, scanHistory: true, followups: true, portals: true, scanRuns: true, portalHealth: true } },
  tracker: {
    total: 15,
    byStatus: { Evaluated: 3, Applied: 6, Responded: 1, Interview: 1, Offer: 0, Hired: 0, Rejected: 4, Discarded: 0, SKIP: 0, Unknown: 0 },
    activeApps: 8,
    activeAppsLive: 6,
    activeAppsCold: 2,
    avgScore: 4.1,
  },
  funnel: {
    everApplied: 12,
    everResponded: 2,
    everInterview: 1,
    everOffer: 0,
    responseRate: 16.7,
    interviewRate: 8.3,
    offerRate: 0,
    smallSample: false,
  },
};

// ── Chiffres de tête ────────────────────────────────────────────────

test("chiffresCles: aucune donnée => null partout, jamais 0", () => {
  const c = chiffresCles(VIDE);
  assert.equal(c.aDesDonnees, false);
  assert.equal(c.envoyees, null);
  assert.equal(c.enAttente, null);
  assert.equal(c.refus, null);
  assert.equal(c.tauxReponse, null);
});

test("chiffresCles: null en entrée ne plante pas", () => {
  const c = chiffresCles(null);
  assert.equal(c.aDesDonnees, false);
  assert.equal(c.envoyees, null);
  assert.equal(c.genereLe, null);
});

test("chiffresCles: « envoyées » vient de l'entonnoir, pas du statut courant", () => {
  const c = chiffresCles(REMPLI);
  // byStatus.Applied vaut 6 (celles qui attendent encore) ; everApplied vaut 12
  // (toutes celles qui sont parties, refus compris). C'est 12 qu'on affiche.
  assert.equal(c.envoyees, 12);
});

test("chiffresCles: « en attente » préfère le compte hors froides", () => {
  const c = chiffresCles(REMPLI);
  assert.equal(c.enAttente, 6, "activeAppsLive (6), pas activeApps (8)");
  assert.equal(c.enAttenteFroides, 2);
});

test("chiffresCles: sans activeAppsLive, on retombe sur activeApps", () => {
  // stats.mjs n'ajoute activeAppsLive que s'il a pu croiser les relances.
  const sansRelances = { ...REMPLI, tracker: { ...REMPLI.tracker, activeAppsLive: undefined, activeAppsCold: undefined } };
  assert.equal(chiffresCles(sansRelances).enAttente, 8);
});

test("chiffresCles: refus et taux de réponse", () => {
  const c = chiffresCles(REMPLI);
  assert.equal(c.refus, 4);
  assert.equal(c.tauxReponse, 17, "arrondi de 16,7 %");
  assert.equal(c.reponses, 2);
});

test("chiffresCles: 0 envoi => pas de taux (et non 0 %)", () => {
  const rien = {
    metadata: { generatedAt: "2026-08-05", sources: { tracker: true } },
    tracker: { total: 2, byStatus: { Evaluated: 2, Applied: 0, Rejected: 0 }, activeApps: 0 },
    funnel: { everApplied: 0, everResponded: 0, responseRate: 0, smallSample: true },
  };
  const c = chiffresCles(rien);
  assert.equal(c.envoyees, 0);
  assert.equal(c.tauxReponse, null, "0 réponse sur 0 envoi n'est pas un taux de 0 %");
  assert.equal(c.refus, 0, "un tracker présent avec zéro refus vaut bien 0, pas null");
});

test("chiffresCles: l'échantillon faible est relayé", () => {
  const petit = { ...REMPLI, funnel: { ...REMPLI.funnel, everApplied: 3, smallSample: true } };
  assert.equal(chiffresCles(petit).echantillonFaible, true);
  assert.equal(chiffresCles(REMPLI).echantillonFaible, false);
});

// ── Entonnoir ───────────────────────────────────────────────────────

test("entonnoir: parts relatives aux envoyées", () => {
  const e = entonnoir(REMPLI);
  assert.deepEqual(
    e.map((x) => [x.libelle, x.valeur, x.part]),
    [
      ["Envoyées", 12, 100],
      ["Réponse reçue", 2, 17],
      ["Entretien", 1, 8],
      ["Proposition", 0, 0],
    ],
  );
});

test("entonnoir: pas d'entonnoir sans données", () => {
  assert.deepEqual(entonnoir(VIDE), []);
  assert.deepEqual(entonnoir(null), []);
});

test("entonnoir: zéro envoi ne divise pas par zéro", () => {
  const e = entonnoir({ funnel: { everApplied: 0, everResponded: 0, everInterview: 0, everOffer: 0 } });
  assert.ok(e.every((x) => x.part === 0));
});

// ── Répartition par statut ──────────────────────────────────────────

test("repartitionStatuts: les statuts vides sont masqués", () => {
  const r = repartitionStatuts(REMPLI);
  assert.deepEqual(
    r.map((s) => s.cle),
    ["Evaluated", "Applied", "Responded", "Interview", "Rejected"],
  );
});

test("repartitionStatuts: un statut non reconnu reste visible", () => {
  // stats.mjs range là les statuts qu'il n'a pas su lire : les cacher masquerait
  // une faute de frappe dans le tracker.
  const avecInconnu = { tracker: { byStatus: { Applied: 1, Unknown: 2 } } };
  const r = repartitionStatuts(avecInconnu);
  assert.ok(r.some((s) => s.cle === "Unknown" && s.valeur === 2));
});

test("repartitionStatuts: rien sans tracker", () => {
  assert.deepEqual(repartitionStatuts(VIDE), []);
});

// ── Sources manquantes ──────────────────────────────────────────────

test("sourcesManquantes: nomme les fichiers absents, tait les présents", () => {
  const m = sourcesManquantes(VIDE);
  assert.ok(m.some((x) => x.includes("data/applications.md")));
  assert.ok(m.some((x) => x.includes("data/scan-history.tsv")));
  assert.ok(!m.some((x) => x.includes("portals.yml")), "portals.yml est présent, ne pas le lister");
});

test("sourcesManquantes: rien à signaler quand tout est là", () => {
  assert.deepEqual(sourcesManquantes(REMPLI), []);
  assert.deepEqual(sourcesManquantes(null), []);
});
