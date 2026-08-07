// Tests du stockage des offres decouvertes (offers-store.mjs).
//
// Ce journal est ce que Lineo regarde pour decider quelles offres traiter. Deux
// erreurs y seraient couteuses : une offre affichee deux fois apres un rescan
// (il candidaterait deux fois), et une ligne sans identifiant (impossible a
// dedupliquer ni a valider ensuite).
//
// Run:  node --test tests/lib/offers-store.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  etatCourant,
  lignesAAjouter,
  ligneDecision,
  normaliseOffreRecue,
  offreComplete,
  parseJournal,
} from "../../src/lib/offers-store.mjs";

const T = "2026-08-06T12:00:00.000Z";
const T2 = "2026-08-07T12:00:00.000Z";

test("une offre sans jobId est ecartee, pas stockee", () => {
  assert.equal(normaliseOffreRecue({ title: "sans id" }), null);
  const { lignes, ecartees } = lignesAAjouter({ jobs: [{ title: "x" }, { jobId: "A" }] }, T);
  assert.equal(lignes.length, 1);
  assert.equal(ecartees, 1);
});

test("le score est borne, et un score absent devient null", () => {
  assert.equal(normaliseOffreRecue({ jobId: "A", score: 250 }).score, 100);
  assert.equal(normaliseOffreRecue({ jobId: "A", score: -8 }).score, 0);
  assert.equal(normaliseOffreRecue({ jobId: "A" }).score, null);
});

test("chaque ligne porte statut, horodatage et execution", () => {
  const { lignes } = lignesAAjouter({ jobs: [{ jobId: "A" }], source: "n8n/decouverte", executionId: "42" }, T);
  assert.equal(lignes[0].statut, "A_DECIDER");
  assert.equal(lignes[0].vu_le, T);
  assert.equal(lignes[0].source, "n8n/decouverte");
  assert.equal(lignes[0].execution_id, "42");
});

test("une offre revue lors d'une tournee suivante n'apparait QU'UNE fois", () => {
  // Sans ca, Lineo verrait deux fois la meme offre et pourrait candidater deux fois.
  const journal = [
    { jobId: "A", title: "ancien titre", score: 50, vu_le: "2026-08-01T00:00:00.000Z" },
    { jobId: "A", title: "titre a jour", score: 90, vu_le: "2026-08-06T00:00:00.000Z" },
  ];
  const etat = etatCourant(journal);
  assert.equal(etat.length, 1);
  assert.equal(etat[0].title, "titre a jour", "la ligne la plus recente fait foi");
});

test("les mieux notees sortent en premier", () => {
  const etat = etatCourant([
    { jobId: "A", score: 40, vu_le: T },
    { jobId: "B", score: 95, vu_le: T },
    { jobId: "C", score: null, vu_le: T },
  ]);
  assert.deepEqual(etat.map((o) => o.jobId), ["B", "A", "C"], "un score absent passe en dernier");
});

test("une ligne corrompue ne rend pas tout l historique illisible", () => {
  const brut = [
    JSON.stringify({ jobId: "A", score: 10 }),
    "{ ligne tronquee par une ecriture interrompue",
    JSON.stringify({ jobId: "B", score: 20 }),
    "",
  ].join("\n");
  assert.deepEqual(parseJournal(brut).map((l) => l.jobId), ["A", "B"]);
});

test("journal vide ou absent : etat vide, pas de crash", () => {
  assert.deepEqual(parseJournal(""), []);
  assert.deepEqual(parseJournal(null), []);
  assert.deepEqual(etatCourant([]), []);
  assert.deepEqual(etatCourant(null), []);
});

// ── Les decisions de Lineo, et leur caractere COLLANT ────────────────────────

test("une offre ecartee disparait de la file", () => {
  const etat = etatCourant([
    { jobId: "A", title: "a garder", score: 90, vu_le: T },
    { jobId: "B", title: "a jeter", score: 80, vu_le: T },
    ligneDecision("B", "ecarter", T2),
  ]);
  assert.deepEqual(etat.map((o) => o.jobId), ["A"]);
});

test("LE test qui compte : une offre ecartee ne revient PAS a la tournee suivante", () => {
  // Le journal est append-only et la ligne la plus recente fait foi. Sans le
  // balayage des statuts classants, le rescan du lendemain ressusciterait
  // l'offre et Lineo devrait l'ecarter tous les jours.
  const etat = etatCourant([
    { jobId: "B", title: "a jeter", score: 80, vu_le: T },
    ligneDecision("B", "ecarter", T),
    { jobId: "B", title: "a jeter", score: 80, vu_le: T2 }, // repostee par n8n, PLUS RECENTE
  ]);
  assert.deepEqual(etat, [], "l'ecart doit gagner contre une ligne de scan plus recente");
});

test("une offre partie en redaction ne revient pas non plus", () => {
  // Elle vit maintenant dans « A valider ». La revoir ici, c'est risquer de
  // candidater deux fois chez le meme employeur.
  const etat = etatCourant([
    { jobId: "C", title: "en cours", score: 70, vu_le: T },
    ligneDecision("C", "generer", T),
    { jobId: "C", title: "en cours", score: 70, vu_le: T2 },
  ]);
  assert.deepEqual(etat, []);
});

test("ligneDecision refuse ce qui n'est pas une decision", () => {
  assert.equal(ligneDecision("", "ecarter", T), null);
  assert.equal(ligneDecision("A", "supprimer-tout", T), null);
  assert.equal(ligneDecision("A", "", T), null);
  assert.deepEqual(ligneDecision("A", "generer", T), {
    jobId: "A",
    statut: "GENEREE",
    decide_le: T,
    vu_le: T,
  });
});

test("offreComplete ignore les lignes de decision, qui n'ont pas de contenu", () => {
  // Sans ca on enverrait a n8n une offre vide, et il echouerait sur
  // « ni title ni description ».
  const journal = [
    { jobId: "A", title: "ancien titre", description: "vieux texte", vu_le: T },
    { jobId: "A", title: "titre a jour", description: "texte a jour", vu_le: T2 },
    ligneDecision("A", "generer", T2),
  ];
  const o = offreComplete(journal, "A");
  assert.equal(o.title, "titre a jour", "la derniere ligne AVEC du contenu fait foi");
  assert.equal(offreComplete(journal, "inconnu"), null);
  assert.equal(offreComplete(journal, ""), null);
});
