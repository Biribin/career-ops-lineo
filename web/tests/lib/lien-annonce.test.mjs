// Tests de la resolution du lien d'annonce (lien-annonce.mjs).
//
// Le tracker n'a pas de colonne URL : les cartes « A valider » n'avaient donc
// aucun lien. On la retrouve depuis l'inbox, mais la regle qui compte est
// NEGATIVE : ne JAMAIS rendre une URL incertaine. Envoyer Lineo lire la mauvaise
// annonce avant de decider est pire que ne rien lui donner.
//
// Run:  node --test tests/lib/lien-annonce.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { lienRecherche, resoudreLien } from "../../src/lib/lien-annonce.mjs";

const c = (company, role, url) => ({ company, role, url });

test("entreprise + poste identiques : lien exact", () => {
  const r = resoudreLien({ company: "ACME", role: "Ingenieur automatisation" }, [
    c("ACME", "Ingenieur automatisation", "https://x.test/1"),
    c("Autre", "Autre poste", "https://x.test/2"),
  ]);
  assert.equal(r.url, "https://x.test/1");
  assert.equal(r.certitude, "exacte");
});

test("les accents, la casse et les mentions H/F ne cassent pas la correspondance", () => {
  const r = resoudreLien({ company: "Enedis", role: "Développeur RPA (H/F)" }, [
    c("ENEDIS", "developpeur rpa h/f", "https://x.test/1"),
  ]);
  assert.equal(r.certitude, "exacte", "la normalisation doit absorber ces variations");
});

test("meme entreprise, un seul poste connu : on accepte", () => {
  const r = resoudreLien({ company: "ACME", role: "Intitule different" }, [
    c("ACME", "Ingenieur automatisation", "https://x.test/1"),
  ]);
  assert.equal(r.url, "https://x.test/1");
  assert.equal(r.certitude, "exacte");
});

test("meme entreprise, DEUX postes : on REFUSE de deviner", () => {
  // Le cas dangereux : renvoyer l'une des deux enverrait Lineo lire la mauvaise
  // annonce avant de decider.
  const r = resoudreLien({ company: "ACME", role: "Intitule inconnu" }, [
    c("ACME", "Poste A", "https://x.test/1"),
    c("ACME", "Poste B", "https://x.test/2"),
  ]);
  assert.equal(r.certitude, "recherche");
  assert.equal(r.ambigu, true);
  assert.equal(r.nbCandidats, 2);
});

test("la meme URL vue deux fois n'est PAS une ambiguite", () => {
  const r = resoudreLien({ company: "ACME", role: "Poste A" }, [
    c("ACME", "Poste A", "https://x.test/1"),
    c("ACME", "Poste A", "https://x.test/1"),
  ]);
  assert.equal(r.certitude, "exacte");
  assert.equal(r.ambigu, false);
});

test("aucune candidate : lien de recherche, jamais d URL inventee", () => {
  const r = resoudreLien({ company: "Inconnue", role: "Poste" }, []);
  assert.equal(r.certitude, "recherche");
  assert.equal(r.ambigu, false);
  assert.ok(r.url.startsWith("https://duckduckgo.com/?q="));
  assert.ok(/Inconnue/.test(decodeURIComponent(r.url)));
});

test("une candidate sans url est ignoree", () => {
  const r = resoudreLien({ company: "ACME", role: "Poste A" }, [c("ACME", "Poste A", "")]);
  assert.equal(r.certitude, "recherche");
});

test("ligne vide : pas de lien du tout, pas de recherche vide", () => {
  assert.equal(lienRecherche({}), "");
  assert.equal(resoudreLien({}, []).url, "");
});
