// Tests de la resolution des telechargements de candidature.
//
// Le besoin vient d'un constat du 2026-08-11 : les liens `cv_url` / `lettre_url`
// de la fiche pointent vers `github.com/Biribin/cv/blob/<branche>/…` et sont
// inutilisables pour Lineo — `/blob/` est une page et non un fichier, le depot est
// prive, et la branche `cv/devoteam-…` contient une barre oblique qui rend l'URL
// ambigue. Le telechargement passe donc par l'app.
//
// Run:  node --test tests/lib/candidature-fichier.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOM_CV,
  NOM_LETTRE,
  enteteTelechargement,
  resoudFichierCandidature,
  urlContenuGitHub,
} from "../../src/lib/candidature-fichier.mjs";

const FICHE = {
  id: "8813531",
  branche_github: "cv/devoteam-lead-ia-agentic-h-f-senior-973677",
  cv_pdf: "dist/pdf/cv-fr-ats.pdf",
  lettre_docx: "dist/docx/lettre-fr.docx",
};

test("le CV se telecharge sous le nom attendu par Lineo", () => {
  const r = resoudFichierCandidature({ fiche: FICHE, type: "cv" });
  assert.equal(r.ok, true);
  assert.equal(r.chemin, "dist/pdf/cv-fr-ats.pdf");
  assert.equal(r.nom, "BIRIBIN Lineo.pdf");
  assert.equal(r.mime, "application/pdf");
});

test("la lettre est servie en docx, pas en pdf", () => {
  const r = resoudFichierCandidature({ fiche: FICHE, type: "lettre" });
  assert.equal(r.ok, true);
  assert.equal(r.nom, NOM_LETTRE);
  assert.match(r.mime, /wordprocessingml\.document$/);
});

test("le type est tolerant a la casse et aux espaces, mais pas invente", () => {
  assert.equal(resoudFichierCandidature({ fiche: FICHE, type: " CV " }).ok, true);
  const r = resoudFichierCandidature({ fiche: FICHE, type: "photo" });
  assert.equal(r.ok, false);
  assert.equal(r.statut, 400);
});

test("REFUS : une fiche sans branche ne peut rien servir", () => {
  // C'est le cas des fiches dont la branche a ete supprimee, ou d'un rendu qui
  // n'a jamais abouti. Dire POURQUOI compte : Lineo doit savoir qu'il faut
  // regenerer, pas reessayer.
  const r = resoudFichierCandidature({ fiche: { ...FICHE, branche_github: "" }, type: "cv" });
  assert.equal(r.ok, false);
  assert.equal(r.statut, 409);
  assert.match(r.motif, /aucune branche/);
});

test("REFUS : fiche introuvable", () => {
  const r = resoudFichierCandidature({ fiche: null, type: "cv" });
  assert.equal(r.ok, false);
  assert.equal(r.statut, 404);
});

test("REFUS : un chemin qui tenterait de sortir du depot", () => {
  for (const mauvais of ["../../etc/passwd", "/etc/passwd", "dist/../../secret"]) {
    const r = resoudFichierCandidature({ fiche: { ...FICHE, cv_pdf: mauvais }, type: "cv" });
    assert.equal(r.ok, false, `aurait du refuser : ${mauvais}`);
    assert.equal(r.statut, 400);
  }
});

test("une fiche ancienne sans chemin retombe sur le defaut", () => {
  const r = resoudFichierCandidature({ fiche: { branche_github: "cv/x" }, type: "cv" });
  assert.equal(r.ok, true);
  assert.equal(r.chemin, "dist/pdf/cv-fr-ats.pdf");
});

test("la barre oblique de la branche est encodee, c'est tout l'enjeu", () => {
  const u = urlContenuGitHub({
    owner: "Biribin",
    repo: "cv",
    chemin: "dist/pdf/cv-fr-ats.pdf",
    branche: "cv/devoteam-lead-ia-agentic-h-f-senior-973677",
  });
  assert.match(u, /\?ref=cv%2Fdevoteam-lead-ia-agentic-h-f-senior-973677$/);
  // Les separateurs du CHEMIN, eux, doivent rester des vraies barres obliques.
  assert.match(u, /\/contents\/dist\/pdf\/cv-fr-ats\.pdf\?/);
});

test("l'entete de telechargement porte le nom, en clair et en UTF-8", () => {
  const h = enteteTelechargement(NOM_CV);
  assert.match(h, /^attachment; filename="BIRIBIN Lineo\.pdf"/);
  assert.match(h, /filename\*=UTF-8''BIRIBIN%20Lineo\.pdf$/);
});

test("un nom hostile ne peut pas casser l'entete", () => {
  const h = enteteTelechargement('ev"il\\.pdf');
  assert.ok(!/filename="[^"]*"[^;]/.test(h), "aucun guillemet ne doit rester dans le nom cite");
  assert.match(h, /filename="evil\.pdf"/);
});
