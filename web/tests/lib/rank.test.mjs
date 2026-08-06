// Tests du tri des offres (rank.mjs), consommé par POST /api/rank.
//
// Deux risques dominent, et ce sont eux qu'on teste :
//   1. la TAILLE du prompt. France Travail rend jusqu'à 150 offres par requête
//      avec des descriptions de plusieurs milliers de caractères ; douze requêtes
//      brutes, c'est un prompt que le CLI refuse ou tronque au milieu d'une
//      offre, en « oubliant » silencieusement la moitié du lot ;
//   2. l'INVENTION. Un modèle qui renvoie un jobId inexistant ferait candidater
//      sur une offre fantôme. On ne garde que ce qu'on a réellement envoyé.
//
// Run:  node --test tests/lib/rank.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DESCRIPTION,
  MAX_OFFRES,
  lieuLisible,
  normaliseOffre,
  parseRank,
  prepareLot,
  promptRank,
} from "../../src/lib/rank.mjs";

const offreFT = (id, over = {}) => ({
  id,
  intitule: "Ingénieur automatisation",
  description: "n8n, API REST, PostgreSQL. ".repeat(50),
  entreprise: { nom: "ACME" },
  lieuTravail: { libelle: "75 - Paris" },
  typeContratLibelle: "CDI",
  origineOffre: { urlOrigine: `https://candidat.francetravail.fr/offres/${id}` },
  dateCreation: "2026-08-01T09:00:00.000Z",
  ...over,
});

test("le lieu objet de France Travail devient une chaîne lisible", () => {
  assert.equal(lieuLisible({ libelle: "92 - Nanterre" }), "92 - Nanterre");
  assert.equal(lieuLisible("Paris"), "Paris");
  assert.equal(lieuLisible({ codePostal: "75001", commune: "Paris" }), "75001, Paris");
  assert.equal(lieuLisible(null), "");
  // le vrai bug historique : sans coercition, l'app affichait « [object Object] »
  assert.ok(!lieuLisible({ libelle: "x" }).includes("object"));
});

test("la description est bornée : c'est ce qui empêche un prompt ingérable", () => {
  const o = normaliseOffre(offreFT("1"));
  assert.ok(o.description.length <= MAX_DESCRIPTION, `${o.description.length} > ${MAX_DESCRIPTION}`);
});

test("aucun champ absent ne devient le mot « undefined » dans le prompt", () => {
  const o = normaliseOffre({ id: "1" });
  for (const [k, v] of Object.entries(o)) {
    assert.equal(typeof v, "string", `${k} doit être une chaîne`);
    assert.ok(!v.includes("undefined"), `${k} contient « undefined »`);
  }
  const p = promptRank({ offres: [o], filtres: {} });
  assert.ok(!p.includes("undefined"), "le prompt ne doit jamais contenir « undefined »");
});

test("la déduplication passe AVANT le plafond", () => {
  // Le cas réel : « n8n » et « automatisation » ramènent largement les mêmes
  // annonces. Sans dédup préalable, les 60 places seraient mangées par des
  // doublons et les offres uniques disparaîtraient.
  const brutes = [...Array(80)].map(() => offreFT("MEME-ID")).concat([...Array(5)].map((_, i) => offreFT(`U${i}`)));
  const lot = prepareLot(brutes);
  assert.equal(lot.offres.length, 6, "1 unique dédupliquée + 5 uniques");
  assert.equal(lot.tronquees, 0);
  assert.ok(lot.doublons > 0);
});

test("le plafond d'offres est appliqué ET annoncé", () => {
  const brutes = [...Array(MAX_OFFRES + 12)].map((_, i) => offreFT(`ID${i}`));
  const lot = prepareLot(brutes);
  assert.equal(lot.offres.length, MAX_OFFRES);
  assert.equal(lot.tronquees, 12, "on doit savoir combien d'offres n'ont pas été jugées");
});

test("une offre sans identifiant est écartée et comptée", () => {
  const lot = prepareLot([offreFT("A"), { intitule: "sans id" }]);
  assert.equal(lot.offres.length, 1);
  assert.equal(lot.sansId, 1);
});

test("le prompt porte les critères de portals.yml, pas les siens", () => {
  const p = promptRank({
    offres: [normaliseOffre(offreFT("A"))],
    filtres: { positive: ["n8n", "RPA"], allow: ["France"], alwaysAllow: ["Remote"], block: ["Marseille"] },
  });
  assert.ok(p.includes("n8n, RPA"), "les mots-clés doivent venir des filtres");
  assert.ok(p.includes("Remote, France"));
  assert.ok(p.includes("Marseille"));
  assert.ok(/alternance/i.test(p), "l'exclusion alternance/stage est une règle explicite");
  assert.ok(/tiret cadratin/i.test(p), "la contrainte typographique est dans le prompt");
});

test("parseRank tolère un préambule et un bloc de code", () => {
  const connues = [normaliseOffre(offreFT("A"))];
  for (const brut of [
    '{"jobs":[{"jobId":"A","whyMatch":"ok","score":80}]}',
    'Voici le tri :\n```json\n{"jobs":[{"jobId":"A","whyMatch":"ok","score":80}]}\n```',
    'Analyse faite.\n{"jobs":[{"jobId":"A","whyMatch":"ok","score":80}]}\nFin.',
  ]) {
    const r = parseRank(brut, { offresConnues: connues });
    assert.equal(r.jobs.length, 1, `echec sur : ${brut.slice(0, 40)}`);
    assert.equal(r.jobs[0].jobId, "A");
  }
});

test("un jobId INVENTÉ est écarté et signalé", () => {
  const connues = [normaliseOffre(offreFT("A"))];
  const r = parseRank('{"jobs":[{"jobId":"A","score":90},{"jobId":"FANTOME","score":95}]}', {
    offresConnues: connues,
  });
  assert.deepEqual(r.jobs.map((j) => j.jobId), ["A"]);
  assert.deepEqual(r.inventes, ["FANTOME"], "candidater sur une offre fantôme serait pire qu'en manquer une");
});

test("les FAITS viennent de l'offre d'origine, le JUGEMENT du modèle", () => {
  const connues = [normaliseOffre(offreFT("A", { intitule: "Vrai intitulé" }))];
  const r = parseRank(
    '{"jobs":[{"jobId":"A","title":"","company":"","url":"","location":"","whyMatch":"pertinent","score":70}]}',
    { offresConnues: connues },
  );
  assert.equal(r.jobs[0].title, "Vrai intitulé", "un titre vide est repris de l'offre, pas laissé vide");
  assert.equal(r.jobs[0].company, "ACME");
  assert.equal(r.jobs[0].whyMatch, "pertinent");
});

test("le score est borné à 0..100 et un score absent devient null", () => {
  const connues = [normaliseOffre(offreFT("A")), normaliseOffre(offreFT("B")), normaliseOffre(offreFT("C"))];
  const r = parseRank('{"jobs":[{"jobId":"A","score":150},{"jobId":"B","score":-4},{"jobId":"C"}]}', {
    offresConnues: connues,
  });
  assert.equal(r.jobs[0].score, 100);
  assert.equal(r.jobs[1].score, 0);
  assert.equal(r.jobs[2].score, null, "pas de score inventé");
});

test("whyMatch est nettoyé du markdown et des tirets cadratin", () => {
  const connues = [normaliseOffre(offreFT("A"))];
  const r = parseRank('{"jobs":[{"jobId":"A","whyMatch":"**n8n** — en production","score":80}]}', {
    offresConnues: connues,
  });
  assert.equal(r.jobs[0].whyMatch, "n8n, en production");
});

test("une réponse illisible LÈVE au lieu de rendre une liste vide", () => {
  // Distinction vitale : une liste vide voudrait dire « aucune offre ne
  // correspondait », ce qui est une information fausse et silencieuse.
  for (const mauvais of ["", "   ", "je n'ai pas compris", '{"resultat":[]}', "{ tronqu"]) {
    assert.throws(() => parseRank(mauvais, { offresConnues: [] }), /vide|hors format/i, `doit lever sur ${JSON.stringify(mauvais)}`);
  }
});

test("une liste jobs vide EXPLICITE est acceptée", () => {
  const r = parseRank('{"jobs":[]}', { offresConnues: [] });
  assert.deepEqual(r.jobs, []);
});
