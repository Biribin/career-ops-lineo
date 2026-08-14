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
  fichesEnAttenteDepuis,
  lireFiches,
  lireJournal,
  lireJournalDetaille,
  porteDisparue,
  argsRefusTracker,
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

// ── Quand n8n N'ATTEND PLUS (404/410) ────────────────────────────────────────
//
// Le symptôme signalé par Linéo : une candidature refusée revenait. Cause : une
// fiche ne quittait la liste que si n8n ACCEPTAIT la décision. Or une exécution
// reprise, expirée ou un workflow rechargé rendent 404 — et le fichier de la
// fiche, lui, reste indéfiniment dans data-inbox. La fiche revenait donc à chaque
// chargement de page, et aucun clic ne pouvait plus rien y faire.

test("un REFUS que n8n n'attendait plus clôt quand même la candidature", () => {
  for (const code of [404, 410]) {
    const journal = [{ id: "r", decision: "refuser", raison: "salaire", at: "x", n8nStatus: code }];
    assert.equal(dejaClose(journal, "r"), true, `code ${code}`);
  }
});

test("un refus sur une panne PASSAGÈRE ne clôt rien : il doit rester réessayable", () => {
  // 502/503/timeout = n8n attend peut-être encore. Fermer ici ferait perdre la
  // seule occasion de débloquer réellement l'exécution.
  for (const status of [500, 502, 503, null]) {
    const journal = [{ id: "r", decision: "refuser", raison: "salaire", at: "x", n8nStatus: status }];
    assert.equal(dejaClose(journal, "r"), false, `statut ${String(status)}`);
  }
});

test("VALIDER sur une porte disparue ne clôt PAS : le mail n'est pas parti", () => {
  // L'asymétrie est le cœur du correctif. Faire disparaître une validation non
  // transmise ferait passer une candidature jamais envoyée pour envoyée.
  const journal = [{ id: "v", decision: "valider", at: "x", n8nStatus: 404 }];
  assert.equal(dejaClose(journal, "v"), false);
});

test("porteDisparue distingue « la porte n'existe plus » d'une panne", () => {
  assert.equal(porteDisparue(404), true);
  assert.equal(porteDisparue(410), true);
  assert.equal(porteDisparue(502), false);
  assert.equal(porteDisparue(200), false);
  assert.equal(porteDisparue(null), false);
  assert.equal(porteDisparue(undefined), false);
});

test("une fiche refusée sur un 404 disparaît de la liste « À valider »", () => {
  // Le test de bout en bout du symptôme : c'est fichesEnAttenteDepuis qui
  // alimente la page.
  const fiches = [{ schema: "career-ops-inbox/v2", id: "offre-1", statut: "en_attente" }];
  const journal = [{ id: "offre-1", decision: "refuser", raison: "salaire", at: "x", n8nStatus: 404 }];
  assert.deepEqual(fichesEnAttenteDepuis(fiches, journal), []);
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

test("lireJournalDetaille distingue « pas encore de journal » de « journal illisible »", () => {
  // Ce que ce test protège : la file « À déposer » (a-deposer.mjs) se construit
  // À PARTIR de ce journal. Sans lui, aucune candidature n'est « validée », la
  // file paraît vide et la page annoncerait « rien à déposer » alors qu'elle n'a
  // rien pu lire. Vide par panne doit être distinguable de vide par vérité.
  const { racine, journal } = bac([], []);
  try {
    // Fichier absent : aucune décision n'a encore été prise. PAS une panne — et
    // une file vide est alors la vérité.
    const absent = lireJournalDetaille(journal);
    assert.deepEqual(absent.journal, []);
    assert.equal(absent.erreur, null);
    assert.equal(absent.illisibles, 0);

    // Le chemin est un dossier : la lecture échoue vraiment. Doit remonter.
    mkdirSync(journal, { recursive: true });
    const casse = lireJournalDetaille(journal);
    assert.deepEqual(casse.journal, []);
    assert.ok(casse.erreur, "une panne de lecture doit remonter, pas rendre une liste vide muette");
    rmSync(journal, { recursive: true, force: true });

    // Lignes que le journal n'a pas su relire : comptées, plus perdues en silence.
    mkdirSync(join(racine, "data"), { recursive: true });
    writeFileSync(
      journal,
      [
        JSON.stringify({ id: "ok", decision: "valider", at: "x", n8nStatus: 200 }),
        "{ ligne tronquée par une écriture interrompue",
        JSON.stringify({ id: "decision-inconnue", decision: "envoyer", at: "x" }),
        "",
      ].join("\n"),
    );
    const lu = lireJournalDetaille(journal);
    assert.deepEqual(
      lu.journal.map((j) => j.id),
      ["ok"],
    );
    assert.equal(lu.erreur, null);
    assert.equal(lu.illisibles, 2);
    // Et l'ancienne signature n'a pas bougé : un seul lecteur pour les deux files.
    assert.deepEqual(lireJournal(journal), lu.journal);
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

// ── argsRefusTracker ────────────────────────────────────────────────────────
//
// Le defaut que ces tests verrouillent est reel : les 2026-08-07, trois refus
// ont ete enregistres avec leur raison dans le journal et en base, mais AUCUN
// n'a atteint data/applications.md — donc ni analyze-patterns.mjs, ni /stats,
// ni /analytics. set-status.mjs sortait sur « No tracker row with company
// matching "Capgemini" (pass --create --role "..." to add it) », parce qu'une
// candidature nee de n8n n'a pas de ligne au tracker.

test("un refus cree la ligne quand elle n'existe pas : --create et --role sont passes", () => {
  const r = argsRefusTracker({ scriptPath: "/app/set-status.mjs", entreprise: "Capgemini", poste: "Developpeur RPA", raison: "pas coherent" });
  assert.equal(r.ok, true);
  assert.equal(r.creation, true);
  assert.ok(r.args.includes("--create"));
  assert.deepEqual(r.args.slice(0, 3), ["/app/set-status.mjs", "Capgemini", "Discarded"]);
  assert.equal(r.args[r.args.indexOf("--role") + 1], "Developpeur RPA");
});

test("la note garde le format DISCARD: que analyze-patterns.mjs agrege", () => {
  const r = argsRefusTracker({ scriptPath: "s", entreprise: "Acme", poste: "Data Engineer", raison: "trop loin" });
  assert.equal(r.args[r.args.indexOf("--note") + 1], "DISCARD: trop loin");
  assert.ok(r.args.includes("--json"));
});

test("sans poste on NE cree RIEN : set-status --create refuse une ligne sans role", () => {
  const r = argsRefusTracker({ scriptPath: "s", entreprise: "Acme", poste: "   ", raison: "non" });
  assert.equal(r.ok, true);
  assert.equal(r.creation, false);
  assert.ok(!r.args.includes("--create"));
  assert.ok(!r.args.includes("--role"));
});

test("une entreprise purement numerique ne declenche pas --create", () => {
  // Un nombre nu designe une ligne existante, pas une entreprise : --create
  // sortirait en erreur d'usage.
  const r = argsRefusTracker({ scriptPath: "s", entreprise: "12345", poste: "Data Engineer", raison: "non" });
  assert.equal(r.creation, false);
  assert.ok(!r.args.includes("--create"));
});

test("sans entreprise on refuse, il n'y a rien a retrouver ni a creer", () => {
  const r = argsRefusTracker({ scriptPath: "s", entreprise: "  ", poste: "Data Engineer", raison: "non" });
  assert.equal(r.ok, false);
  assert.match(r.motif, /entreprise/);
});

test("pipes et sauts de ligne sont neutralises : ils casseraient la rangee du tableau", () => {
  const r = argsRefusTracker({ scriptPath: "s", entreprise: "Ac|me\nCorp", poste: "Dev | RPA", raison: "a\nb" });
  assert.equal(r.args[1], "Ac me Corp");
  assert.equal(r.args[r.args.indexOf("--role") + 1], "Dev RPA");
  assert.equal(r.args[r.args.indexOf("--note") + 1], "DISCARD: a b");
});
