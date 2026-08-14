// Tests de la lecture des compteurs de tournée (scan-runs.mjs).
//
// Ce que ces tests protègent : afficher les chiffres d'une tournée qui n'est pas
// la sienne. Le fichier `data/scan-runs.tsv` est partagé — le CLI de Linéo, un
// cron, une session parallèle y écrivent aussi. Des chiffres plausibles mais
// venus d'ailleurs sont une erreur qu'on ne voit jamais.
//
// Run:  node --test tests/lib/scan-runs.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { compteur, derniereLigneRun } from "../../src/lib/scan-runs.mjs";

// L'en-tête réel écrit par scan.mjs (SCAN_RUNS_HEADER), colonnes dans l'ordre.
const ENTETE =
  "timestamp\tstatus\tcompanies\tboards\tfound\tfiltered_title\tfiltered_tier\tfiltered_location\tfiltered_posting_age\tfiltered_salary\tfiltered_content\tfiltered_cooldown\tdupes\tnew_added\terrors\tfiltered_blacklist\tfiltered_visa\tfiltered_posted_date\tfiltered_country_eligibility";

const ligne = (ts, over = {}) => {
  const base = {
    timestamp: ts,
    status: "completed",
    companies: "0",
    boards: "5",
    found: "1276",
    filtered_title: "994",
    filtered_tier: "0",
    filtered_location: "233",
    filtered_posting_age: "0",
    filtered_salary: "0",
    filtered_content: "0",
    filtered_cooldown: "0",
    dupes: "0",
    new_added: "49",
    errors: "1",
    filtered_blacklist: "0",
    filtered_visa: "0",
    filtered_posted_date: "0",
    filtered_country_eligibility: "0",
    ...over,
  };
  return ENTETE.split("\t").map((c) => base[c] ?? "").join("\t");
};

const T0 = Date.parse("2026-08-14T10:00:00.000Z");

test("la derniere ligne est lue par NOM de colonne, pas par position", () => {
  // Le coeur a ajoute des colonnes au fil du temps (filtered_visa,
  // filtered_posted_date, filtered_country_eligibility...). Un lecteur
  // positionnel afficherait la mauvaise colonne au prochain ajout.
  const tsv = [ENTETE, ligne("2026-08-14T10:00:05.000Z")].join("\n");
  const l = derniereLigneRun(tsv, T0);
  assert.equal(l.boards, "5");
  assert.equal(l.found, "1276");
  assert.equal(l.new_added, "49");
  assert.equal(l.filtered_title, "994");
});

test("LE test qui compte : une ligne ecrite AVANT notre lancement est refusee", () => {
  // Sinon on afficherait la tournee du CLI de Lineo comme etant la notre.
  const tsv = [ENTETE, ligne("2026-08-14T09:59:59.000Z")].join("\n");
  assert.equal(derniereLigneRun(tsv, T0), null);
});

test("une ligne ecrite dans la MEME milliseconde que le lancement est la notre", () => {
  // Un balayage assez rapide pour s'inscrire sur la meme milliseconde a bien
  // tourne : l'exclure ferait perdre les compteurs d'une tournee reussie.
  const tsv = [ENTETE, ligne("2026-08-14T10:00:00.000Z")].join("\n");
  assert.ok(derniereLigneRun(tsv, T0));
});

test("c'est la DERNIERE ligne qui fait foi, pas la premiere trouvee", () => {
  const tsv = [ENTETE, ligne("2026-08-14T10:00:01.000Z", { boards: "1" }), ligne("2026-08-14T10:00:09.000Z", { boards: "5" })].join("\n");
  assert.equal(derniereLigneRun(tsv, T0).boards, "5");
});

test("fichier absent, en-tete seul ou horodatage illisible : null, jamais des zeros", () => {
  assert.equal(derniereLigneRun("", T0), null);
  assert.equal(derniereLigneRun(null, T0), null);
  assert.equal(derniereLigneRun(ENTETE, T0), null, "en-tete seul = aucune tournee enregistree");
  assert.equal(derniereLigneRun([ENTETE, ligne("pas une date")].join("\n"), T0), null);
});

test("une ligne tronquee ne fait pas exploser la lecture", () => {
  // Ecriture interrompue : les colonnes manquantes valent "", et compteur() les
  // rendra null plutot que 0.
  const tronquee = "2026-08-14T10:00:05.000Z\tcompleted\t0\t5";
  const l = derniereLigneRun([ENTETE, tronquee].join("\n"), T0);
  assert.equal(l.boards, "5");
  assert.equal(l.found, "");
  assert.equal(compteur(l.found), null, "colonne absente = inconnue, pas zero");
});

test("les lignes vides de fin de fichier sont ignorees", () => {
  const tsv = [ENTETE, ligne("2026-08-14T10:00:05.000Z"), "", ""].join("\n");
  assert.equal(derniereLigneRun(tsv, T0).boards, "5");
});

test("compteur distingue « rien mesure » de « zero mesure »", () => {
  // C'est toute la raison de cette fonction : « 0 offre trouvee » ne doit jamais
  // s'afficher quand on n'a rien mesure.
  assert.equal(compteur("49"), 49);
  assert.equal(compteur("0"), 0, "un vrai 0 reste un 0");
  assert.equal(compteur(""), null);
  assert.equal(compteur(undefined), null);
  assert.equal(compteur("   "), null);
  assert.equal(compteur("beaucoup"), null);
});
