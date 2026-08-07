// Tests de la conservation des criteres d'Explorer.
//
// LE BUG D'ORIGINE : ajouter « sales » aux exclusions puis recharger la page le
// perdait en silence. Les criteres ne survivaient que si on lancait une
// decouverte, qui les ecrit dans l'URL.
//
// Ce qui se joue ici, c'est la RELECTURE. Un contenu corrompu ou une forme plus
// ancienne ne doit jamais rendre un objet a moitie valide : le formulaire
// casserait sans qu'on comprenne pourquoi. On retombe sur la graine portals.yml.
//
// Run:  node --test tests/lib/explore-filtres.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseFiltresSauves } from "../../src/lib/explore-filtres.mjs";

const GRAINE = {
  positive: ["n8n", "automation engineer"],
  negative: ["commercial"],
  allow: [],
  block: [],
  alwaysAllow: [],
  sinceDays: 30,
  ats: ["greenhouse", "lever"],
  limitPerAts: 40,
};

test("LE cas du bug : une exclusion ajoutee est bien relue", () => {
  const relu = normaliseFiltresSauves(
    { ...GRAINE, negative: ["commercial", "sale", "senior", "sales"] },
    GRAINE,
  );
  assert.deepEqual(relu.negative, ["commercial", "sale", "senior", "sales"]);
  assert.deepEqual(relu.positive, GRAINE.positive, "le reste ne bouge pas");
});

test("une liste videe volontairement reste vide", () => {
  // Sans ca, retirer un mot pose par portals.yml serait impossible : il
  // reviendrait a chaque chargement.
  assert.deepEqual(normaliseFiltresSauves({ ...GRAINE, negative: [] }, GRAINE).negative, []);
});

test("un contenu qui n'est pas un objet ne casse rien", () => {
  assert.equal(normaliseFiltresSauves(null, GRAINE), null);
  assert.equal(normaliseFiltresSauves("une chaine", GRAINE), null);
  assert.equal(normaliseFiltresSauves(["un", "tableau"], GRAINE), null);
  assert.equal(normaliseFiltresSauves(42, GRAINE), null);
});

test("un champ absent ou du mauvais type est comble par la graine", () => {
  // Reglage enregistre avant l'ajout d'un critere, ou partiellement corrompu.
  const relu = normaliseFiltresSauves(
    { negative: ["sales"], sinceDays: "trente", ats: [], positive: [1, 2] },
    GRAINE,
  );
  assert.deepEqual(relu.negative, ["sales"], "ce qui est valide est garde");
  assert.equal(relu.sinceDays, 30, "sinceDays non numerique -> graine");
  assert.deepEqual(relu.ats, GRAINE.ats, "aucune source cochee -> graine, sinon on ne scanne rien");
  assert.deepEqual(relu.positive, GRAINE.positive, "liste non textuelle -> graine");
  assert.equal(relu.limitPerAts, GRAINE.limitPerAts, "champ absent -> graine");
});

test("les valeurs numeriques aberrantes retombent sur la graine", () => {
  const relu = normaliseFiltresSauves({ sinceDays: 0, limitPerAts: -5 }, GRAINE);
  assert.equal(relu.sinceDays, 30);
  assert.equal(relu.limitPerAts, 40);
});
