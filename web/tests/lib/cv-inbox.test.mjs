// Tests de la source « API GitHub » des fiches n8n (cv-inbox.mjs).
//
// L'enjeu : career-ops tourne en conteneur sur le VPS, sans clone du repo cv.
// Si cette source ment — en renvoyant une liste vide alors qu'elle n'a pas pu
// lire — Linéo conclut « rien à valider » pendant qu'une exécution n8n reste
// parquée. On vérifie donc surtout la frontière entre « il n'y a rien » et
// « je n'ai pas réussi à lire », qui ne se ressemblent pas du tout.
//
// Run:  node --test tests/lib/cv-inbox.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { fichesDepuisGitHub, MAX_FICHES } from "../../src/lib/cv-inbox.mjs";

const FICHE = {
  schema: "career-ops-inbox/v2",
  id: "offre-1",
  statut: "A_VALIDER",
  cree_le: "2026-08-05T09:00:00.000Z",
  revision: 0,
  entreprise: "Acme",
  poste: "Ingénieur automatisation",
  decision_url: "https://n8n.balzac-info.online/webhook-waiting/42",
};

const b64 = (o) => Buffer.from(JSON.stringify(o, null, 2), "utf8").toString("base64");

/** fetch bouchonné : un listage, puis un contenu par fichier. */
function stub({ listage, statutListage = 200, contenus = {}, jette = false }) {
  const appels = [];
  const faux = async (url) => {
    appels.push(String(url));
    if (jette) throw new Error("ECONNREFUSED");
    if (!String(url).includes("/contents/data-inbox/")) {
      // le listage du dossier
      return {
        ok: statutListage >= 200 && statutListage < 300,
        status: statutListage,
        json: async () => listage,
      };
    }
    const nom = decodeURI(String(url)).split("/contents/data-inbox/")[1].split("?")[0];
    const c = contenus[nom];
    if (c === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ content: c, encoding: "base64" }) };
  };
  return { faux, appels };
}

const CONF = { owner: "Biribin", repo: "cv", branch: "main", token: "jeton-de-test" };

const fichier = (nom) => ({ name: nom, path: `data-inbox/${nom}`, type: "file" });

test("lit les fiches JSON et ignore le README, le .jsonl et les sous-dossiers", async () => {
  const { faux } = stub({
    listage: [
      fichier("offre-1.json"),
      fichier("README.md"),
      fichier("candidatures.jsonl"),
      { name: "relances", path: "data-inbox/relances", type: "dir" },
    ],
    contenus: { "offre-1.json": b64(FICHE) },
  });
  const r = await fichesDepuisGitHub({ fetch: faux, ...CONF });
  assert.equal(r.erreur, null);
  assert.deepEqual(r.fiches.map((f) => f.id), ["offre-1"]);
  assert.equal(r.tronquees, 0);
  assert.equal(r.illisibles, 0);
});

test("le sous-dossier relances/ n'est jamais lu : ce ne sont pas des candidatures à valider", async () => {
  const { faux, appels } = stub({
    listage: [{ name: "relances", path: "data-inbox/relances", type: "dir" }],
    contenus: {},
  });
  const r = await fichesDepuisGitHub({ fetch: faux, ...CONF });
  assert.deepEqual(r.fiches, []);
  assert.equal(appels.filter((u) => u.includes("relances")).length, 0);
});

test("dossier absent (404) = aucune candidature déposée, PAS une panne", async () => {
  const { faux } = stub({ listage: {}, statutListage: 404 });
  const r = await fichesDepuisGitHub({ fetch: faux, ...CONF });
  assert.deepEqual(r.fiches, []);
  assert.equal(r.erreur, null, "un 404 ne doit pas être signalé comme une erreur");
});

test("token refusé (401/403) remonte une erreur explicite, jamais une liste vide muette", async () => {
  for (const statut of [401, 403]) {
    const { faux } = stub({ listage: {}, statutListage: statut });
    const r = await fichesDepuisGitHub({ fetch: faux, ...CONF });
    assert.deepEqual(r.fiches, []);
    assert.match(r.erreur ?? "", /token/i, `HTTP ${statut} doit parler du token`);
    assert.match(r.erreur ?? "", /Biribin\/cv/, "et nommer le dépôt visé");
  }
});

test("réseau injoignable remonte une erreur, pas un silence", async () => {
  const { faux } = stub({ listage: [], jette: true });
  const r = await fichesDepuisGitHub({ fetch: faux, ...CONF });
  assert.deepEqual(r.fiches, []);
  assert.match(r.erreur ?? "", /injoignable/i);
});

test("configuration incomplète : on le dit sans appeler GitHub", async () => {
  const { faux, appels } = stub({ listage: [] });
  const r = await fichesDepuisGitHub({ fetch: faux, ...CONF, token: "" });
  assert.match(r.erreur ?? "", /configuration GitHub incomplète/);
  assert.equal(appels.length, 0, "aucun appel réseau sans token");
});

test("une fiche hors-schéma ou corrompue est comptée, sans faire disparaître les autres", async () => {
  const { faux } = stub({
    listage: [fichier("bonne.json"), fichier("bidon.json"), fichier("casse.json")],
    contenus: {
      "bonne.json": b64(FICHE),
      // pas de préfixe career-ops-inbox/ → rejetée par le même filtre qu'en local
      "bidon.json": b64({ id: "x", statut: "A_VALIDER" }),
      "casse.json": Buffer.from("{ ceci n'est pas du json", "utf8").toString("base64"),
    },
  });
  const r = await fichesDepuisGitHub({ fetch: faux, ...CONF });
  assert.deepEqual(r.fiches.map((f) => f.id), ["offre-1"]);
  assert.equal(r.illisibles, 2);
  assert.equal(r.erreur, null, "des fiches illisibles ne rendent pas la lecture globale invalide");
});

test("le plafond de lecture est annoncé, jamais silencieux", async () => {
  const noms = Array.from({ length: MAX_FICHES + 3 }, (_, i) => `offre-${i}.json`);
  const contenus = {};
  for (const [i, n] of noms.entries()) contenus[n] = b64({ ...FICHE, id: `offre-${i}` });
  const { faux } = stub({ listage: noms.map(fichier), contenus });
  const r = await fichesDepuisGitHub({ fetch: faux, ...CONF });
  assert.equal(r.fiches.length, MAX_FICHES);
  assert.equal(r.tronquees, 3);
});

test("un fichier illisible côté API ne fait pas échouer toute la lecture", async () => {
  const { faux } = stub({
    listage: [fichier("bonne.json"), fichier("absente.json")],
    contenus: { "bonne.json": b64(FICHE) }, // « absente.json » renverra 404
  });
  const r = await fichesDepuisGitHub({ fetch: faux, ...CONF });
  assert.deepEqual(r.fiches.map((f) => f.id), ["offre-1"]);
  assert.equal(r.erreur, null);
});

test("la branche demandée est bien celle interrogée", async () => {
  const { faux, appels } = stub({
    listage: [fichier("offre-1.json")],
    contenus: { "offre-1.json": b64(FICHE) },
  });
  await fichesDepuisGitHub({ fetch: faux, ...CONF, branch: "une-autre" });
  assert.ok(appels.every((u) => u.includes("ref=une-autre")), "toutes les requêtes doivent porter le ref");
});
