// Tests de la redaction de lettre (letter.mjs).
//
// C'est la seule piece que lit un recruteur. Les trois garde-fous testes ici
// viennent de defauts REELS constates les 2026-08-05/06 :
//   - « depuis deux ans » dans la lettre de reference, alors que le poste actuel
//     a commence en mars 2026 (l'ancien prompt n'avait aucune regle d'anciennete) ;
//   - tirets cadratin et markdown, interdits et absents eux aussi de l'ancien prompt ;
//   - un plafond de quota rendu comme corps de lettre.
//
// Run:  node --test tests/lib/letter.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MOTS, dureeInventee, nettoieLettre, parseLettre, promptLettre, teletravailInvente } from "../../src/lib/letter.mjs";

const enveloppe = (corps, extra = {}) =>
  JSON.stringify({ email_subject: "Candidature", salutation: "Madame, Monsieur,", letter_body: corps, key_selling_points: ["a"], ...extra });

test("l'anciennete inventee est ramenee a la seule formulation vraie", () => {
  const r = parseLettre(enveloppe("Je fais cela en production depuis deux ans, et cela me motive."));
  assert.ok(!/deux ans/i.test(r.letter_body));
  assert.ok(/depuis mars 2026/.test(r.letter_body));
});

test("les tirets cadratin et le markdown sont retires", () => {
  const r = parseLettre(enveloppe("Mon profil — **n8n** et *API* — correspond a votre besoin."));
  assert.ok(!/[—–]/.test(r.letter_body));
  assert.ok(!/\*/.test(r.letter_body));
});

test("les balises HTML sont retirees", () => {
  const r = parseLettre(enveloppe("<p>Bonjour</p><br>Je vous ecris."));
  assert.ok(!/<[^>]+>/.test(r.letter_body));
});

test("une duree residuelle LEVE au lieu de partir chez un recruteur", () => {
  assert.throws(() => parseLettre(enveloppe("Une collaboration de deux ans avec ce client.")), /duree chiffree/i);
});

test("une lettre trop longue LEVE : le rendu une page casserait", () => {
  const long = "mot ".repeat(MAX_MOTS + 200);
  assert.throws(() => parseLettre(enveloppe(long)), /trop longue/i);
});

test("un corps vide apres nettoyage LEVE", () => {
  assert.throws(() => parseLettre(enveloppe("<br>")), /vide apres nettoyage/i);
});

test("une reponse hors format LEVE, jamais de lettre par defaut", () => {
  for (const mauvais of ["", "je n'ai pas compris", '{"autre":1}']) {
    assert.throws(() => parseLettre(mauvais), /vide|hors format|vide apres/i);
  }
});

test("un preambule et un bloc de code sont toleres", () => {
  const r = parseLettre("Voici :\n```json\n" + enveloppe("Un corps valide et suffisant.") + "\n```");
  assert.equal(r.letter_body, "Un corps valide et suffisant.");
});

test("les valeurs manquantes ont un repli sur, pas vide", () => {
  const r = parseLettre(JSON.stringify({ letter_body: "Un corps valide." }));
  assert.equal(r.email_subject, "Candidature");
  assert.equal(r.salutation, "Madame, Monsieur,");
  assert.deepEqual(r.key_selling_points, []);
});

test("le prompt porte les regles anti-invention et la contrainte une page", () => {
  const p = promptLettre({ offre: { title: "Dev IA", description: "n8n" }, profilCv: "profil" });
  assert.ok(/mars 2026/.test(p));
  assert.ok(/tiret cadratin/i.test(p));
  assert.ok(/markdown/i.test(p));
  assert.ok(new RegExp(String(MAX_MOTS)).test(p));
  assert.ok(!/undefined/.test(p), "aucun champ absent ne doit devenir « undefined »");
});

test("une consigne de retouche est annoncee comme prioritaire", () => {
  const p = promptLettre({ offre: { title: "x" }, profilCv: "p", consigne: "plus court" });
  assert.ok(/prioritaire/i.test(p) && /plus court/.test(p));
});

test("nettoieLettre ne casse pas une lettre deja propre", () => {
  const propre = "Madame, Monsieur,\n\nVotre annonce correspond a mon parcours.\n\nCordialement,";
  assert.equal(nettoieLettre(propre), propre);
  assert.equal(dureeInventee(propre), false);
});

// Defaut reel du 2026-08-11, candidature Nutripure : le modele a lu « full remote
// accepte » dans le profil et l'a rendu comme une pratique actuelle. Linéo n'a
// jamais travaille a distance, il est seulement disponible et pret a demenager.
test("affirmer un teletravail actuel LEVE : la phrase exacte du defaut Nutripure", () => {
  const defaut =
    "Le full remote que j'accepte deja dans mon activite actuelle me permettrait de rejoindre votre equipe sans contrainte de lieu.";
  assert.equal(teletravailInvente(defaut), true);
  assert.throws(() => parseLettre(enveloppe(defaut)), /teletravail actuel/i);
});

test("les autres formulations de teletravail actuel sont couvertes", () => {
  for (const phrase of [
    "Je travaille en full remote depuis mon domicile.",
    "Je suis a distance sur mon poste.",
    "Mon poste actuel est en teletravail complet.",
    "Aujourd'hui je collabore a distance avec mes equipes.",
  ]) {
    assert.equal(teletravailInvente(phrase), true, phrase);
  }
});

test("la disponibilite au remote et la mobilite restent dicibles", () => {
  for (const phrase of [
    "Le poste est base a Toulouse et je suis pret a demenager pour le rejoindre.",
    "Je suis disponible en full remote comme en presentiel.",
    "Une organisation en teletravail me conviendrait.",
    "Je suis mobile sur toute la France.",
  ]) {
    assert.equal(teletravailInvente(phrase), false, phrase);
  }
});

test("le prompt dit que le remote est une disponibilite, pas une pratique", () => {
  const p = promptLettre({ offre: { title: "Dev IA" }, profilCv: "profil" });
  assert.ok(/jamais travaille a distance/i.test(p));
  assert.ok(/demenager/i.test(p));
});
