// Tests du contrat « relances dues » (followups-due.mjs).
//
// Ce qui est vérifié n'est pas cosmétique : renommer un champ ou laisser passer
// une entrée sans `num` casse la session n8n en aval, et rater une entrée
// `urgent` = une relance qui ne part jamais.
//
// Run:  node --test tests/lib/followups-due.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { courrielContact, estDue, relancesDues, versRelance } from "../../src/lib/followups-due.mjs";

/** Une entrée de cadence minimale, façon followup-cadence.mjs. */
function entree(extra = {}) {
  return {
    num: 12,
    company: "Acme",
    role: "Ingénieur automatisation",
    urgency: "overdue",
    status: "applied",
    daysSinceApplication: 9,
    contacts: [{ name: "Marie", email: "marie@acme.fr", channel: "Email" }],
    ...extra,
  };
}

test("estDue: overdue et urgent sont dus, waiting et cold ne le sont pas", () => {
  assert.equal(estDue(entree({ urgency: "overdue" })), true);
  assert.equal(estDue(entree({ urgency: "urgent" })), true);
  assert.equal(estDue(entree({ urgency: "waiting" })), false);
  assert.equal(estDue(entree({ urgency: "cold" })), false);
});

test("estDue: l'urgence portée par `status` est reconnue aussi", () => {
  // Filet pour un moteur plus ancien : c'est le comportement que la route avait
  // avant le contrat, et une relance ratée coûte plus qu'une ligne en trop.
  assert.equal(estDue({ urgency: "", status: "OVERDUE" }), true);
});

test("estDue: ne se laisse pas piéger par une sous-chaîne", () => {
  assert.equal(estDue({ urgency: "nonurgent" }), false);
  assert.equal(estDue({}), false);
  assert.equal(estDue(null), false);
});

test("courrielContact: premier contact QUI A une adresse, sinon null", () => {
  assert.equal(courrielContact(entree()), "marie@acme.fr");
  // Un contact nommé sans adresse n'est pas relançable par mail : on saute au
  // suivant au lieu de rendre "" que n8n prendrait pour un destinataire.
  assert.equal(
    courrielContact(entree({ contacts: [{ name: "Marie", email: null }, { name: "Jean", email: " jean@acme.fr " }] })),
    "jean@acme.fr",
  );
  assert.equal(courrielContact(entree({ contacts: [{ name: "Marie", email: null }] })), null);
  assert.equal(courrielContact(entree({ contacts: [] })), null);
  assert.equal(courrielContact({}), null);
});

test("versRelance: les cinq champs du contrat, et rien d'autre", () => {
  const r = versRelance(entree());
  assert.deepEqual(Object.keys(r).sort(), [
    "courriel_contact",
    "entreprise",
    "id",
    "jours_depuis_envoi",
    "poste",
  ]);
  assert.deepEqual(r, {
    id: "12",
    entreprise: "Acme",
    poste: "Ingénieur automatisation",
    courriel_contact: "marie@acme.fr",
    jours_depuis_envoi: 9,
  });
});

test("versRelance: `id` est une CHAÎNE (sélecteur set-status / appNum)", () => {
  assert.equal(versRelance(entree({ num: 7 })).id, "7");
  assert.equal(typeof versRelance(entree({ num: 7 })).id, "string");
});

test("versRelance: `jours_depuis_envoi` reste un nombre même sur entrée abîmée", () => {
  assert.equal(versRelance(entree({ daysSinceApplication: undefined })).jours_depuis_envoi, 0);
  assert.equal(versRelance(entree({ daysSinceApplication: "abc" })).jours_depuis_envoi, 0);
});

test("relancesDues: filtre, projette, et jette les entrées sans numéro", () => {
  const due = relancesDues([
    entree({ num: 1, urgency: "overdue" }),
    entree({ num: 2, urgency: "waiting" }),
    entree({ num: 3, urgency: "urgent" }),
    // Sans `num`, n8n ne peut ni journaliser la relance ni toucher le tracker.
    entree({ num: null, urgency: "overdue" }),
  ]);
  assert.deepEqual(
    due.map((r) => r.id),
    ["1", "3"],
  );
});

test("relancesDues: une entrée non tableau ne fait pas tomber la route", () => {
  assert.deepEqual(relancesDues(undefined), []);
  assert.deepEqual(relancesDues(null), []);
});
