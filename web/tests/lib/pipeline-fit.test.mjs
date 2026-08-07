import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_ANNONCE, nettoieTexteFit, parseFit, promptFit, VERDICTS } from "../../src/lib/pipeline-fit.mjs";

// Le contrat que ces tests protègent : un bloquant non cité depuis l'annonce ne
// peut pas écarter une offre. Le classement du scan ne lit pas le corps de
// l'annonce ; ce module le lit, mais il ne doit pas se mettre à inventer.

const ANNONCE = [
  "Customer Solutions Engineer, AI Agents.",
  "Nous recherchons un profil avec 3 a 5 ans d'experience en avant-vente technique.",
  "Vous travaillerez avec nos equipes produit sur des agents IA.",
  "La maitrise de Python est appreciee.",
].join(" ");

test("promptFit: l'annonce et le profil entrent dans le prompt, tronqués", () => {
  const p = promptFit({
    offre: { role: "Solutions Engineer", company: "1mind", url: "https://x.test/1" },
    texteAnnonce: ANNONCE,
    profilCv: "Responsable SI depuis mars 2026",
  });
  assert.match(p, /Solutions Engineer/);
  assert.match(p, /1mind/);
  assert.match(p, /3 a 5 ans/);
  assert.match(p, /Responsable SI/);
  // Les deux regles qui font tout le travail doivent etre presentes.
  assert.match(p, /CITE depuis l'annonce/);
  assert.match(p, /N'invente AUCUNE anciennete/);
});

test("promptFit: une annonce géante est coupée, le prompt ne l'est pas par surprise", () => {
  const p = promptFit({ texteAnnonce: "x".repeat(MAX_ANNONCE + 5000) });
  assert.ok(p.length < MAX_ANNONCE + 4000, "l'annonce doit etre tronquee a MAX_ANNONCE");
});

test("promptFit: une annonce vide est signalée, pas passée sous silence", () => {
  assert.match(promptFit({ texteAnnonce: "" }), /annonce vide ou illisible/);
});

test("parseFit: un bloquant cité depuis l'annonce est retenu et écarte l'offre", () => {
  const brut = JSON.stringify({
    verdict: "hors_cible",
    resume: "Poste trop senior",
    bloquants: [{ quoi: "3 a 5 ans d'experience requis", citation: "3 a 5 ans d'experience en avant-vente technique" }],
    atouts: ["agents IA"],
    ecarts: ["avant-vente"],
  });
  const r = parseFit(brut, ANNONCE);
  assert.equal(r.verdict, "hors_cible");
  assert.equal(r.bloquants.length, 1);
  assert.deepEqual(r.bloquantsNonVerifies, []);
});

test("parseFit: un bloquant INVENTÉ ne peut pas écarter l'offre", () => {
  const brut = JSON.stringify({
    verdict: "hors_cible",
    resume: "Trop senior",
    bloquants: [{ quoi: "10 ans d'experience exiges", citation: "nous exigeons 10 ans d'experience minimum" }],
  });
  const r = parseFit(brut, ANNONCE);
  assert.equal(r.bloquants.length, 0);
  assert.deepEqual(r.bloquantsNonVerifies, ["10 ans d'experience exiges"]);
  // Le verdict est redescendu : on ne jette pas une offre sur une intuition.
  assert.equal(r.verdict, "a_regarder");
});

test("parseFit: une citation trop courte ne prouve rien", () => {
  const brut = JSON.stringify({
    verdict: "hors_cible",
    bloquants: [{ quoi: "senior", citation: "ans" }],
  });
  const r = parseFit(brut, ANNONCE);
  assert.equal(r.bloquants.length, 0);
  assert.equal(r.verdict, "a_regarder");
});

test("parseFit: la citation se retrouve malgré accents, casse et ponctuation", () => {
  const annonce = "Nous demandons 3 à 5 ans d'expérience, minimum.";
  const brut = JSON.stringify({
    verdict: "hors_cible",
    bloquants: [{ quoi: "anciennete", citation: "3 a 5 ans d experience" }],
  });
  const r = parseFit(brut, annonce);
  assert.equal(r.bloquants.length, 1);
  assert.equal(r.verdict, "hors_cible");
});

test("parseFit: un verdict inconnu retombe sur une valeur canonique", () => {
  const r = parseFit(JSON.stringify({ verdict: "peut_etre", bloquants: [] }), ANNONCE);
  assert.ok(VERDICTS.includes(r.verdict));
  assert.equal(r.verdict, "a_regarder");
});

test("parseFit: hors_cible sans aucun bloquant n'est pas tenable", () => {
  const r = parseFit(JSON.stringify({ verdict: "hors_cible", bloquants: [] }), ANNONCE);
  assert.equal(r.verdict, "a_regarder");
});

test("parseFit: a_postuler est respecté tel quel", () => {
  const r = parseFit(JSON.stringify({ verdict: "a_postuler", resume: "Bon fit", bloquants: [] }), ANNONCE);
  assert.equal(r.verdict, "a_postuler");
  assert.equal(r.resume, "Bon fit");
});

test("parseFit: du markdown ou un tiret cadratin sont nettoyés", () => {
  const r = parseFit(
    JSON.stringify({ verdict: "a_regarder", resume: "**Poste** — avant-vente", atouts: ["## IA"] }),
    ANNONCE,
  );
  assert.equal(r.resume, "Poste, avant-vente");
  assert.equal(r.atouts[0], "IA");
});

test("parseFit: une réponse vide ou hors format jette au lieu d'inventer", () => {
  assert.throws(() => parseFit("", ANNONCE), /reponse vide/);
  assert.throws(() => parseFit("je ne sais pas", ANNONCE), /hors format/);
});

test("parseFit: du texte autour du JSON ne gêne pas", () => {
  const r = parseFit('Voici mon analyse :\n{"verdict":"a_postuler","bloquants":[]}\nVoila.', ANNONCE);
  assert.equal(r.verdict, "a_postuler");
});

test("nettoieTexteFit: aplatit les sauts de ligne et coupe les balises", () => {
  assert.equal(nettoieTexteFit("a\n\nb <b>c</b>"), "a b c");
  assert.equal(nettoieTexteFit(null), "");
});
