// Tests de la redaction de relance (followup-draft.mjs).
//
// Le garde-fou central est propre a la relance : une relance automatique qui
// ecrit « comme convenu lors de notre echange » alors que PERSONNE n'a repondu
// fait plus de degats que pas de relance du tout. Les autres reprennent ceux de
// letter.mjs, parce que ce sont les memes interdits sur les documents candidat.
//
// Run:  node --test tests/lib/followup-draft.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_MOTS,
  MAX_OBJET,
  dureeInventee,
  echangeInvente,
  nettoieRelance,
  parseRelance,
  promptRelance,
} from "../../src/lib/followup-draft.mjs";

const enveloppe = (corps, objet = "Candidature Data Engineer") => JSON.stringify({ objet, corps });

test("une relance normale passe et rend objet, corps et nombre de mots", () => {
  const r = parseRelance(enveloppe("Bonjour, je me permets de revenir vers vous au sujet du poste. Bien cordialement, Lineo Biribin"));
  assert.equal(r.objet, "Candidature Data Engineer");
  assert.match(r.corps, /^Bonjour, je me permets/);
  assert.equal(r.mots, 16);
});

test("REFUS : un echange invente, sous toutes ses formulations", () => {
  for (const phrase of [
    "Comme convenu, je reviens vers vous.",
    "Suite a notre echange de la semaine derniere, je reviens vers vous.",
    "Suite à notre entretien, je reste disponible.",
    "Lors de notre echange, vous evoquiez un retour rapide.",
    "Nous nous sommes parlé le mois dernier au sujet du poste.",
    "Comme indique au telephone, je reste interesse.",
  ]) {
    assert.throws(() => parseRelance(enveloppe(phrase)), /echange qui n'a jamais eu lieu/, phrase);
  }
});

test("une relance qui ne pretend a aucun echange passe", () => {
  const r = parseRelance(enveloppe("Je vous ai adresse ma candidature il y a dix jours et n'ai pas encore eu de retour."));
  assert.ok(r.corps.length > 0);
});

test("REFUS : une anciennete chiffree", () => {
  assert.throws(() => parseRelance(enveloppe("Fort de deux ans d'experience, je reste motive.")), /duree chiffree/);
});

test("REFUS : un corps vide, et une reponse hors format", () => {
  assert.throws(() => parseRelance(enveloppe("   ")), /corps vide/);
  assert.throws(() => parseRelance("je ne sais pas repondre en JSON"), /hors format/);
  assert.throws(() => parseRelance(""), /vide/);
});

test("REFUS : un objet vide", () => {
  assert.throws(() => parseRelance(enveloppe("Un corps valide et courtois.", "   ")), /objet vide/);
});

test("REFUS : une relance qui vire a la seconde lettre de motivation", () => {
  const trop = Array.from({ length: MAX_MOTS + 60 }, (_, i) => "mot" + i).join(" ");
  assert.throws(() => parseRelance(enveloppe(trop)), /trop longue/);
});

test("tirets cadratin et markdown sont nettoyes, pas refuses", () => {
  const r = parseRelance(enveloppe("Bonjour, **je reviens** vers vous — sans insistance — au sujet du poste."));
  assert.ok(!r.corps.includes("—"));
  assert.ok(!r.corps.includes("**"));
  assert.match(r.corps, /je reviens vers vous, sans insistance, au sujet du poste/);
});

test("l'objet perd ses prefixes et est borne", () => {
  assert.equal(parseRelance(enveloppe("Un corps.", "Relance : Data Engineer")).objet, "Data Engineer");
  assert.equal(parseRelance(enveloppe("Un corps.", "Re: Data Engineer")).objet, "Data Engineer");
  assert.equal(parseRelance(enveloppe("Un corps.", "x".repeat(120))).objet.length, MAX_OBJET);
});

test("les detecteurs sont utilisables seuls", () => {
  assert.ok(dureeInventee("trois ans"));
  assert.ok(!dureeInventee("30 jours"));
  assert.ok(echangeInvente("comme convenu"));
  assert.ok(!echangeInvente("comme indique dans ma candidature"));
  assert.equal(nettoieRelance("a — b"), "a, b");
});

test("le prompt porte le contexte reel et interdit d'inventer un echange", () => {
  const p = promptRelance({
    relance: { entreprise: "Acme", poste: "Data Engineer", joursDepuisEnvoi: 9, rang: 2, relanceMax: 2, candidat: "Lineo Biribin" },
    profilCv: "CV du candidat",
  });
  assert.match(p, /Entreprise : Acme/);
  assert.match(p, /envoyee il y a : 9 jours/);
  assert.match(p, /Numero de cette relance : 2 sur 2/);
  assert.match(p, /N'invente AUCUN echange passe/);
  assert.match(p, /mars 2026/);
});

test("une duree inconnue est dite inconnue, jamais devinee", () => {
  const p = promptRelance({ relance: { entreprise: "Acme" } });
  assert.match(p, /envoyee il y a : duree inconnue/);
});

test("la consigne de retouche prend le pas et est portee au prompt", () => {
  const p = promptRelance({ relance: { entreprise: "Acme" }, consigne: "plus court et plus direct" });
  assert.match(p, /CONSIGNE DE RETOUCHE \(prioritaire sur le reste\)\nplus court et plus direct/);
});
