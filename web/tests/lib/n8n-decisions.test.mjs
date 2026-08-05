// Tests du pont n8n ↔ career-ops (n8n-decisions.mjs).
//
// L'enjeu vérifié ici n'est pas cosmétique : une fiche qui disparaît trop tôt de
// la liste « À valider » = une exécution n8n parquée pour toujours ; une fiche
// qui reste décidable pendant un aller-retour de retouche = un POST dans le vide.
//
// Run:  node --test tests/lib/n8n-decisions.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DECISIONS,
  ajouterAuJournal,
  dejaClose,
  estDecision,
  fichesEnAttente,
  lireFiches,
  lireJournal,
} from "../../src/lib/n8n-decisions.mjs";

const FICHE = {
  schema: "career-ops-inbox/v2",
  id: "offre-1",
  statut: "A_VALIDER",
  cree_le: "2026-08-04T09:00:00.000Z",
  revision: 0,
  poste: "Ingénieur automatisation",
  entreprise: "Acme",
  decision_url: "https://n8n.balzac-info.online/webhook-waiting/42",
};

// Un bac à sable : un dossier inbox façon repo cv + un chemin de journal.
function bac(fiches = [FICHE], lignesJournal = []) {
  const racine = mkdtempSync(join(tmpdir(), "co-n8n-"));
  const inbox = join(racine, "data-inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(join(inbox, "README.md"), "pas une fiche\n");
  for (const f of fiches) writeFileSync(join(inbox, `${f.id}.json`), JSON.stringify(f, null, 2));
  const journal = join(racine, "data", "n8n-decisions.jsonl");
  if (lignesJournal.length) {
    mkdirSync(join(racine, "data"), { recursive: true });
    writeFileSync(journal, lignesJournal.map((l) => JSON.stringify(l)).join("\n") + "\n");
  }
  return { racine, inbox, journal };
}

test("estDecision n'accepte que les 4 décisions que n8n sait router", () => {
  for (const d of DECISIONS) assert.equal(estDecision(d), true);
  for (const mauvais of ["", "VALIDER", "envoyer", "valider ", null, undefined, 42, {}]) {
    assert.equal(estDecision(mauvais), false, `${JSON.stringify(mauvais)} ne doit pas passer`);
  }
});

test("lireFiches ignore le README et tout ce qui n'a pas le schéma attendu", () => {
  const { racine, inbox } = bac();
  try {
    writeFileSync(join(inbox, "bidon.json"), JSON.stringify({ id: "x", statut: "A_VALIDER" }));
    writeFileSync(join(inbox, "casse.json"), "{ ceci n'est pas du json");
    const fiches = lireFiches(inbox);
    assert.deepEqual(
      fiches.map((f) => f.id),
      ["offre-1"],
    );
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("lireFiches renvoie une liste vide quand le repo cv est absent", () => {
  assert.deepEqual(lireFiches(join(tmpdir(), "repo-cv-qui-nexiste-pas-12345")), []);
});

test("une fiche sans décision est en attente et décidable", () => {
  const { racine, inbox, journal } = bac();
  try {
    const [f] = fichesEnAttente(inbox, journal);
    assert.equal(f.id, "offre-1");
    assert.equal(f.decidable, true);
    assert.equal(f.retouches, 0);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("une décision terminale TRANSMISE retire la fiche de la liste", () => {
  const { racine, inbox, journal } = bac([FICHE], [
    { id: "offre-1", decision: "valider", at: "2026-08-04T10:00:00Z", n8nStatus: 200 },
  ]);
  try {
    assert.deepEqual(fichesEnAttente(inbox, journal), []);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("un POST en ÉCHEC ne retire pas la fiche : l'exécution n8n est encore parquée", () => {
  // Le cas dangereux : si on retirait la fiche ici, la candidature resterait
  // bloquée chez n8n sans plus aucune surface pour la débloquer.
  for (const echec of [{ n8nStatus: 404 }, { n8nStatus: 500 }, { n8nStatus: null, n8nError: "ECONNREFUSED" }]) {
    const { racine, inbox, journal } = bac([FICHE], [
      { id: "offre-1", decision: "valider", at: "2026-08-04T10:00:00Z", ...echec },
    ]);
    try {
      const restantes = fichesEnAttente(inbox, journal);
      assert.equal(restantes.length, 1, `statut ${JSON.stringify(echec)} doit garder la fiche visible`);
      assert.equal(restantes[0].decidable, true);
    } finally {
      rmSync(racine, { recursive: true, force: true });
    }
  }
});

test("une retouche transmise rend la fiche NON décidable jusqu'à ce que n8n la redépose", () => {
  const { racine, inbox, journal } = bac([FICHE], [
    { id: "offre-1", decision: "retoucher_lettre", consigne: "plus court", at: "2026-08-04T10:00:00Z", n8nStatus: 200 },
  ]);
  try {
    const [f] = fichesEnAttente(inbox, journal);
    assert.equal(f.retouches, 1);
    // revision (0) < retouches (1) → l'aller-retour est encore en vol.
    assert.equal(f.decidable, false);
    assert.equal(f.derniereConsigne, "plus court");
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("quand n8n redépose la fiche avec revision incrémentée, elle redevient décidable", () => {
  const { racine, inbox, journal } = bac([{ ...FICHE, revision: 1 }], [
    { id: "offre-1", decision: "retoucher_lettre", consigne: "plus court", at: "2026-08-04T10:00:00Z", n8nStatus: 200 },
  ]);
  try {
    const [f] = fichesEnAttente(inbox, journal);
    assert.equal(f.decidable, true);
    assert.equal(f.retouches, 1);
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("dejaClose est le garde anti-double-clic, et ne se déclenche pas sur une retouche", () => {
  const journal = [
    { id: "a", decision: "valider", at: "x", n8nStatus: 200 },
    { id: "b", decision: "refuser", at: "x", n8nStatus: 200 },
    { id: "c", decision: "retoucher_cv", at: "x", n8nStatus: 200 },
    { id: "d", decision: "valider", at: "x", n8nStatus: 502 },
  ];
  assert.equal(dejaClose(journal, "a"), true);
  assert.equal(dejaClose(journal, "b"), true);
  assert.equal(dejaClose(journal, "c"), false, "une retouche ne clôt pas la candidature");
  assert.equal(dejaClose(journal, "d"), false, "un POST en échec ne clôt rien");
  assert.equal(dejaClose(journal, "inconnu"), false);
});

test("le journal survit à une ligne corrompue et à un fichier absent", () => {
  const { racine, journal } = bac([], []);
  try {
    assert.deepEqual(lireJournal(journal), []); // fichier absent
    mkdirSync(join(racine, "data"), { recursive: true });
    writeFileSync(
      journal,
      [
        JSON.stringify({ id: "ok", decision: "valider", at: "x", n8nStatus: 200 }),
        "{ ligne tronquée par une écriture interrompue",
        JSON.stringify({ id: "sans-decision-valide", decision: "envoyer", at: "x" }),
        "",
      ].join("\n"),
    );
    const lu = lireJournal(journal);
    assert.deepEqual(
      lu.map((j) => j.id),
      ["ok"],
    );
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("ajouterAuJournal crée le dossier et écrit en append", () => {
  const { racine, journal } = bac([], []);
  try {
    ajouterAuJournal(journal, { id: "a", decision: "valider", at: "1", n8nStatus: 200 });
    ajouterAuJournal(journal, { id: "b", decision: "refuser", raison: "salaire", at: "2", n8nStatus: 200 });
    const lu = lireJournal(journal);
    assert.equal(lu.length, 2);
    assert.equal(lu[1].raison, "salaire");
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});

test("les fiches les plus anciennes sortent en premier — elles bloquent n8n depuis plus longtemps", () => {
  const { racine, inbox, journal } = bac([
    { ...FICHE, id: "recente", cree_le: "2026-08-04T12:00:00Z" },
    { ...FICHE, id: "ancienne", cree_le: "2026-08-01T08:00:00Z" },
  ]);
  try {
    assert.deepEqual(
      fichesEnAttente(inbox, journal).map((f) => f.id),
      ["ancienne", "recente"],
    );
  } finally {
    rmSync(racine, { recursive: true, force: true });
  }
});
