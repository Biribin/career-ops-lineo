// Tests du classement « meilleures offres » (scan-rank.mjs).
//
// L'enjeu n'est pas la valeur exacte d'un score — c'est l'ORDRE, et le fait que
// rien n'entre dans le classement qui ne vienne des fichiers de config de Linéo.
// Deux régressions coûteuses : un mot-clé qui matche à l'intérieur d'un autre mot
// (« AI » dans « travail ») noierait le classement dans du bruit, et une offre
// écartée par un filtre qui remonterait quand même serait un refus ignoré.
//
// Run:  node --test tests/lib/scan-rank.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cibleLaPlusProche,
  classerOffres,
  jetonsIntitule,
  joursEcoules,
  motsClesTitre,
  scorerOffre,
} from "../../src/lib/scan-rank.mjs";

/** Les vrais filtres de Linéo, en réduction (portals.yml + profile.yml). */
const CTX = {
  positifs: ["n8n", "AI", "ML", "Automation", "AI Automation", "Integration Engineer", "Platform Engineer", "Agent"],
  negatifs: [],
  lieuxOk: ["Remote", "Télétravail", "France", "Paris", "Île-de-France"],
  lieuxBloques: [],
  cibles: ["AI Automation Engineer", "Integration Engineer", "Automation Engineer", "Data Engineer"],
  aujourdhui: "2026-08-05",
};

function offre(extra = {}) {
  return {
    url: "https://boards.greenhouse.io/acme/jobs/1",
    company: "Acme",
    role: "Integration Engineer",
    location: "Paris, France",
    postedAt: "2026-08-04",
    done: false,
    ...extra,
  };
}

// ── Correspondance de mots-clés ─────────────────────────────────────

test("motsClesTitre: un sigle court ne matche pas à l'intérieur d'un mot", () => {
  // Le piège que le filtre par sous-chaîne du cœur laisse passer.
  assert.deepEqual(motsClesTitre("Chargé de travail social", CTX.positifs), []);
  assert.deepEqual(motsClesTitre("Technicien de maintenance", CTX.positifs), []);
});

test("motsClesTitre: le sigle matche quand il est vraiment là", () => {
  assert.deepEqual(motsClesTitre("AI Engineer", CTX.positifs), ["AI"]);
});

test("motsClesTitre: insensible aux accents et à la casse hors sigles", () => {
  assert.deepEqual(motsClesTitre("Ingénieur automation", ["Automation"]), ["Automation"]);
  assert.deepEqual(motsClesTitre("INGENIEUR AUTOMATISATION", ["Automatisation"]), ["Automatisation"]);
});

test("motsClesTitre: « n8n » est reconnu (chiffre au milieu)", () => {
  assert.deepEqual(motsClesTitre("Développeur n8n", CTX.positifs), ["n8n"]);
});

test("motsClesTitre: dédoublonne sans tenir compte de la casse", () => {
  assert.deepEqual(motsClesTitre("Automation Engineer", ["Automation", "automation", "AUTOMATION"]), ["Automation"]);
});

// ── Intitulé cible ──────────────────────────────────────────────────

test("cibleLaPlusProche: un intitulé exact atteint une couverture pleine", () => {
  const r = cibleLaPlusProche("Integration Engineer", CTX.cibles);
  assert.equal(r.cible, "Integration Engineer");
  assert.equal(r.couverture, 1);
});

test("cibleLaPlusProche: un seul jeton commun ne suffit pas", () => {
  // « Engineer » partagé avec « Data Engineer » ne fait pas une correspondance,
  // sinon toute offre d'ingénieur matcherait n'importe quelle cible.
  assert.equal(cibleLaPlusProche("Sales Engineer", CTX.cibles), null);
});

test("cibleLaPlusProche: l'habillage d'annonce est ignoré", () => {
  const r = cibleLaPlusProche("Integration Engineer (H/F) - CDI - Télétravail", CTX.cibles);
  assert.equal(r.cible, "Integration Engineer");
});

test("jetonsIntitule: articles et habillage écartés, technique gardé", () => {
  assert.deepEqual(jetonsIntitule("Ingénieur en automatisation (H/F) CDI"), ["ingenieur", "automatisation"]);
  assert.deepEqual(jetonsIntitule("Node.js / C++ Engineer"), ["node.js", "c++", "engineer"]);
});

// ── Fraîcheur ───────────────────────────────────────────────────────

test("joursEcoules: compte les jours, null si illisible", () => {
  assert.equal(joursEcoules("2026-08-01", "2026-08-05"), 4);
  assert.equal(joursEcoules("2026-08-05", "2026-08-05"), 0);
  assert.equal(joursEcoules("pas-une-date", "2026-08-05"), null);
});

// ── Score ───────────────────────────────────────────────────────────

test("scorerOffre: une offre idéale score haut et s'explique", () => {
  const r = scorerOffre(offre({ role: "AI Automation Engineer" }), CTX);
  assert.ok(r.pertinence >= 80, `attendu >= 80, obtenu ${r.pertinence}`);
  assert.equal(r.exclue, null);
  assert.ok(r.raisons.some((x) => /intitulé visé/.test(x)));
  // « Paris » et « France » matchent tous les deux : on veut le plus précis.
  assert.ok(r.raisons.some((x) => /lieu : Paris/.test(x)), `raisons: ${r.raisons.join(" | ")}`);
  assert.ok(r.raisons.some((x) => /publiée il y a 1 j/.test(x)));
});

test("scorerOffre: un intitulé cible bat un simple mot-clé", () => {
  const cible = scorerOffre(offre({ role: "Integration Engineer" }), CTX);
  const motCle = scorerOffre(offre({ role: "Agent de sécurité AI" }), CTX);
  assert.ok(
    cible.pertinence > motCle.pertinence,
    `intitulé ${cible.pertinence} devrait battre mot-clé ${motCle.pertinence}`,
  );
});

test("scorerOffre: une expression multi-mots pèse plus qu'un mot générique", () => {
  const precis = scorerOffre(offre({ role: "AI Automation Specialist", location: "" , postedAt: undefined }), CTX);
  const vague = scorerOffre(offre({ role: "AI Specialist", location: "", postedAt: undefined }), CTX);
  assert.ok(precis.pertinence > vague.pertinence);
});

test("scorerOffre: un mot-clé négatif exclut, il ne dégrade pas", () => {
  const r = scorerOffre(offre({ role: "Senior Integration Engineer" }), {
    ...CTX,
    negatifs: ["Senior"],
  });
  assert.equal(r.exclue, "mot-clé écarté : Senior");
});

test("scorerOffre: un lieu bloqué exclut", () => {
  const r = scorerOffre(offre({ location: "New York, USA" }), { ...CTX, lieuxBloques: ["USA"] });
  assert.equal(r.exclue, "lieu écarté : USA");
});

test("scorerOffre: un lieu absent n'est ni récompensé ni puni", () => {
  const sans = scorerOffre(offre({ location: "" }), CTX);
  const hors = scorerOffre(offre({ location: "Berlin, Allemagne" }), CTX);
  assert.equal(sans.pertinence, hors.pertinence);
  assert.ok(sans.raisons.includes("lieu inconnu"));
});

test("scorerOffre: la raison cite le lieu le plus précis, pas le plus long", () => {
  // « Paris » et « France » matchent tous deux « Paris, France ». Dire
  // « lieu : France » perdrait l'information utile — et « France » étant le plus
  // LONG des deux, un tri par longueur se tromperait.
  const r = scorerOffre(offre({ location: "Paris, Île-de-France, France" }), CTX);
  assert.ok(r.raisons.includes("lieu : Paris"), `raisons: ${r.raisons.join(" | ")}`);
});

test("scorerOffre: une offre ancienne ne gagne rien en fraîcheur", () => {
  const vieille = scorerOffre(offre({ postedAt: "2026-01-01" }), CTX);
  const fraiche = scorerOffre(offre({ postedAt: "2026-08-05" }), CTX);
  assert.ok(fraiche.pertinence > vieille.pertinence);
  assert.ok(vieille.pertinence > 0, "l'ancienneté ne doit pas annuler le reste du score");
});

test("scorerOffre: une date future ne fabrique pas de bonus", () => {
  // Un annuaire ATS peut estampiller demain ; le score ne doit pas dépasser 100
  // ni compter une fraîcheur négative comme un cadeau.
  const r = scorerOffre(offre({ postedAt: "2026-12-31" }), CTX);
  assert.ok(r.pertinence <= 100);
});

test("scorerOffre: sans config, il ne reste que la fraîcheur", () => {
  // Aucun mot-clé, aucune cible, aucun lieu autorisé : les trois signaux issus
  // de la config valent 0. Seule la date subsiste — c'est le seul signal qui ne
  // dépende pas de ce que Linéo a déclaré. La route le signale par
  // `classement_actif: false` pour qu'un ordre sans config ne passe pas pour un
  // classement.
  const vide = { positifs: [], negatifs: [], lieuxOk: [], lieuxBloques: [], cibles: [], aujourdhui: "2026-08-05" };
  assert.equal(scorerOffre(offre({ postedAt: undefined }), vide).pertinence, 0);
  assert.ok(scorerOffre(offre({ postedAt: "2026-08-05" }), vide).pertinence > 0);
});

// ── Classement ──────────────────────────────────────────────────────

test("classerOffres: trie par pertinence décroissante", () => {
  const { classees } = classerOffres(
    [
      offre({ url: "u1", role: "Agent de maîtrise", location: "", postedAt: undefined }),
      offre({ url: "u2", role: "AI Automation Engineer" }),
      offre({ url: "u3", role: "Platform Engineer", postedAt: "2026-07-01" }),
    ],
    CTX,
  );
  assert.deepEqual(
    classees.map((o) => o.url),
    ["u2", "u3", "u1"],
  );
});

test("classerOffres: les lignes déjà traitées sortent et sont comptées", () => {
  const { classees, dejaTraitees } = classerOffres(
    [offre({ url: "u1", done: true }), offre({ url: "u2" })],
    CTX,
  );
  assert.deepEqual(
    classees.map((o) => o.url),
    ["u2"],
  );
  assert.equal(dejaTraitees, 1);
});

test("classerOffres: les exclues sont comptées, pas silencieuses", () => {
  const { classees, exclues } = classerOffres([offre({ url: "u1", role: "Senior Dev" }), offre({ url: "u2" })], {
    ...CTX,
    negatifs: ["Senior"],
  });
  assert.equal(classees.length, 1);
  assert.equal(exclues, 1);
});

test("classerOffres: l'ordre est stable à égalité de score", () => {
  const a = offre({ url: "u1", company: "Zeta", role: "Integration Engineer" });
  const b = offre({ url: "u2", company: "Alpha", role: "Integration Engineer" });
  const un = classerOffres([a, b], CTX).classees.map((o) => o.url);
  const deux = classerOffres([b, a], CTX).classees.map((o) => o.url);
  assert.deepEqual(un, deux, "deux appels doivent rendre le même ordre");
  assert.deepEqual(un, ["u2", "u1"], "à égalité, l'entreprise tranche par ordre alphabétique");
});

test("classerOffres: une entrée non conforme est écartée, pas plantée", () => {
  // Une entrée sans URL n'est pas actionnable : elle ne doit pas occuper une
  // place du classement — surtout pas la première, à égalité de score 0.
  const { classees } = classerOffres([null, undefined, {}, { url: "  " }, offre()], CTX);
  assert.deepEqual(
    classees.map((o) => o.url),
    ["https://boards.greenhouse.io/acme/jobs/1"],
  );
});
