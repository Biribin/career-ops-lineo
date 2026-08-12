import { test } from "node:test";
import assert from "node:assert/strict";
import { optionsReessai, peutReessayer } from "../../src/lib/job-retry.mjs";

// Ce que ces tests protègent : le bouton « Réessayer » de /jobs/[id] ne doit
// apparaître que là où relancer a un sens. Les deux refus qui comptent sont des
// DOUBLONS (un second agent sur la même entrée écrit la même ligne de suivi
// deux fois), pas des détails d'affichage.

const termine = {
  status: "done",
  title: "Recherche d'ATS · Acme",
  subtitle: "trouver la page carrières scannable",
  kind: "fix-portal",
  input: "Acme",
  page: "/portals",
};

test("un traitement terminé est rejouable, à l'identique", () => {
  assert.equal(peutReessayer(termine), true);
  assert.deepEqual(optionsReessai(termine), {
    title: "Recherche d'ATS · Acme",
    subtitle: "trouver la page carrières scannable",
    kind: "fix-portal",
    input: "Acme",
    page: "/portals",
  });
});

test("un traitement en erreur est rejouable — c'est même le cas principal", () => {
  assert.equal(peutReessayer({ ...termine, status: "error" }), true);
});

test("un traitement en cours ne l'est pas", () => {
  assert.equal(peutReessayer({ ...termine, status: "running" }), false);
  assert.equal(optionsReessai({ ...termine, status: "running" }), null);
});

test("un traitement détaché ne l'est pas non plus", () => {
  // L'onglet a été rechargé, mais l'agent tourne toujours côté serveur et écrira
  // son rapport. Relancer mettrait deux agents sur la même entrée — et l'écran
  // dit justement à l'utilisateur que c'est inutile.
  assert.equal(peutReessayer({ ...termine, status: "detached" }), false);
});

test("sans kind ni input, pas de bouton : /api/run n'aurait rien à exécuter", () => {
  // Cas réel : un traitement restauré du localStorage d'une version antérieure.
  const { kind: _kind, ...sansKind } = termine;
  const { input: _input, ...sansInput } = termine;
  assert.equal(peutReessayer(sansKind), false);
  assert.equal(peutReessayer(sansInput), false);
  assert.equal(peutReessayer({ ...termine, input: "" }), false);
});

test("le lot n'est pas repris par une relance manuelle", () => {
  // Un batchId groupe des traitements lancés ENSEMBLE. Le reprendre ferait
  // gonfler après coup la carte de lot de l'assistant.
  const opts = optionsReessai({ ...termine, batchId: "shortlist-1755000000000" });
  assert.ok(opts);
  assert.equal("batchId" in opts, false);
});

test("entrée absurde : on refuse au lieu de jeter", () => {
  assert.equal(peutReessayer(null), false);
  assert.equal(peutReessayer(undefined), false);
  assert.equal(peutReessayer({}), false);
  assert.equal(optionsReessai(null), null);
});

test("un titre manquant ne produit pas un traitement sans nom", () => {
  const opts = optionsReessai({ status: "done", kind: "fix-portal", input: "Acme" });
  assert.ok(opts);
  assert.equal(opts.title, "Nouvel essai");
});
