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
  clesNormalisees,
  lieuLisible,
  normaliseOffre,
  parseRank,
  prepareLot,
  promptRank,
  scorePertinence,
  trieParPlancher,
} from "../../src/lib/rank.mjs";

// L'intitulé porte l'identifiant par DÉFAUT, et ce n'est pas cosmétique : depuis
// le filtre anti-jumeaux, deux annonces de même employeur, même intitulé et même
// ville SONT le même poste (cf. cle-job.mjs). Une fixture qui donnait le même
// intitulé à toutes les offres ne décrivait donc plus « N offres distinctes »
// mais « N republications d'une seule ». Les tests qui veulent des jumeaux
// passent un `intitule` identique explicitement.
const offreFT = (id, over = {}) => ({
  id,
  intitule: `Ingénieur automatisation ${id}`,
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

test("une offre déjà au journal ne repart JAMAIS au tri", () => {
  // Le symptôme que Linéo constatait : la tournée « ne rapporte rien ». Les
  // offres déjà tranchees remontaient de France Travail, mangeaient les places
  // du lot et l'appel LLM, puis etaient masquees a l'affichage par etatCourant.
  const brutes = [offreFT("VU-1"), offreFT("VU-2"), offreFT("NEUVE")];
  const lot = prepareLot(brutes, { dejaVus: new Set(["VU-1", "VU-2"]) });
  assert.deepEqual(
    lot.offres.map((o) => o.jobId),
    ["NEUVE"],
  );
  assert.equal(lot.dejaVues, 2, "le compte doit etre annonce, pas silencieux");
  assert.equal(lot.doublons, 0, "deja vue n'est pas un doublon de tournee");
});

// -- Le MEME poste sous un AUTRE identifiant France Travail -------------------
//
// Mesure de la tournee du 2026-08-14 : 1 650 reponses brutes, 1 150 identifiants
// uniques pour 783 postes identifiables. 35 identifiants en trop DANS la tournee,
// et 7 postes de la veille revenus sous un identifiant neuf. `dejaVus`, qui ne
// connait que l'identifiant, les laissait tous passer : ils occupaient une des
// 150 places et se faisaient rediger un whyMatch pour rien.

test("le meme poste republie sous un autre identifiant ne repart pas au tri", () => {
  const brutes = [
    offreFT("212GLHJ", { intitule: "Analyste décisionnel - Business Intelligence (H/F)", entreprise: { nom: "DCARTE ENGINEERING SA" }, lieuTravail: { libelle: "France" } }),
    offreFT("NEUVE"),
  ];
  const lot = prepareLot(brutes, {
    // L'offre a deja ete tranchee la veille sous l'identifiant 212GLHM.
    clesConnues: new Set(["dcarte engineering sa | analyste business decisionnel intelligence | france"]),
  });
  assert.deepEqual(lot.offres.map((o) => o.jobId), ["NEUVE"]);
  assert.equal(lot.dejaVues, 1, "compte annonce, pas silencieux");
});

test("deux jumeaux du MEME lot n'occupent qu'une place", () => {
  // Cas reel : « Développeur IA - Metz (H/F) » et « Développeur IA (H/F) - Metz ».
  const brutes = [
    offreFT("A1", { intitule: "Développeur IA  - Metz (H/F)", entreprise: { nom: "Atos" }, lieuTravail: { libelle: "57 - Metz" } }),
    offreFT("A2", { intitule: "Développeur IA (H/F) - Metz", entreprise: { nom: "ATOS" }, lieuTravail: { libelle: "57 - METZ" } }),
  ];
  const lot = prepareLot(brutes);
  assert.equal(lot.offres.length, 1);
  assert.equal(lot.jumeaux, 1);
  assert.equal(lot.doublons, 0, "un jumeau n'est pas un doublon d'identifiant");
  assert.equal(lot.dejaVues, 0, "ni une offre deja tranchee");
});

test("le filtre anti-jumeaux ne touche PAS ce qu'il ne sait pas identifier", () => {
  // Sans employeur, deux annonces de meme intitule restent deux offres : 332 des
  // 1 150 offres du 2026-08-14 n'avaient aucun nom d'entreprise, et les fusionner
  // masquerait des postes que Lineo n'a jamais vus.
  const brutes = [
    offreFT("X1", { intitule: "Chef de projet IA (H/F)", entreprise: {} }),
    offreFT("X2", { intitule: "Chef de projet IA (H/F)", entreprise: {} }),
  ];
  const lot = prepareLot(brutes);
  assert.equal(lot.offres.length, 2);
  assert.equal(lot.jumeaux, 0);
});

test("une ville differente chez le meme employeur reste un poste distinct", () => {
  const brutes = [
    offreFT("L1", { intitule: "Technicien de Maintenance (H/F)", entreprise: { nom: "Adecco France" }, lieuTravail: { libelle: "69 - LYON" } }),
    offreFT("P1", { intitule: "Technicien de Maintenance (H/F)", entreprise: { nom: "Adecco France" }, lieuTravail: { libelle: "75 - PARIS" } }),
  ];
  const lot = prepareLot(brutes);
  assert.equal(lot.offres.length, 2, "Paris ne doit pas disparaitre parce que Lyon existe");
});

test("clesConnues accepte un tableau autant qu'un Set, et son absence ne change rien", () => {
  const brutes = [offreFT("A", { intitule: "Data Engineer (H/F)", entreprise: { nom: "Acme" }, lieuTravail: { libelle: "75 - PARIS" } }), offreFT("B")];
  const avec = prepareLot(brutes, { clesConnues: ["acme | data engineer | paris"] });
  assert.deepEqual(avec.offres.map((o) => o.jobId), ["B"]);
  const sans = prepareLot(brutes);
  assert.equal(sans.offres.length, 2);
  assert.equal(sans.jumeaux, 0);
});

test("les comptes du lot restent coherents : rien ne se perd en silence", () => {
  const brutes = [
    offreFT("A1", { intitule: "Data Engineer (H/F)", entreprise: { nom: "Acme" }, lieuTravail: { libelle: "75 - PARIS" } }),
    offreFT("A2", { intitule: "Data Engineer (H/F)", entreprise: { nom: "Acme" }, lieuTravail: { libelle: "75 - PARIS" } }), // jumeau
    offreFT("A1", { intitule: "Data Engineer (H/F)", entreprise: { nom: "Acme" }, lieuTravail: { libelle: "75 - PARIS" } }), // doublon d'identifiant
    offreFT("VU"),
    offreFT("ALT", { intitule: "Alternance automatisation" }),
    { intitule: "sans id" },
    offreFT("NEUVE"),
  ];
  const lot = prepareLot(brutes, { dejaVus: ["VU"] });
  const total = brutes.length;
  assert.equal(lot.offres.length + lot.sansId + lot.dejaVues + lot.jumeaux + lot.alternances + lot.doublons, total);
  assert.equal(lot.jumeaux, 1);
  assert.equal(lot.doublons, 1);
  assert.equal(lot.dejaVues, 1);
  assert.equal(lot.alternances, 1);
  assert.equal(lot.sansId, 1);
});

test("parseRank transporte l'identite du poste, calculee sur l'offre D'ORIGINE", () => {
  // Le modele reformate parfois l'intitule. Recalculer la cle sur SA version la
  // ferait diverger de celle que la tournee suivante calcule sur les donnees
  // brutes de France Travail : le filtre anti-jumeaux raterait exactement les
  // offres pour lesquelles il existe.
  const source = normaliseOffre(offreFT("A", { intitule: "Data Engineer (H/F)", entreprise: { nom: "Acme" }, lieuTravail: { libelle: "75 - PARIS" } }));
  const { jobs } = parseRank(
    JSON.stringify({ jobs: [{ jobId: "A", title: "Data Engineer — Acme (reformate par le modele)", score: 70 }] }),
    { offresConnues: [source] },
  );
  assert.equal(jobs[0].cle, "acme | data engineer | paris");
});

test("les offres déjà vues ne mangent pas les places du plafond", () => {
  // Sans ce comportement, une file de 60 offres connues suffisait a evincer les
  // offres neuves : le plafond se remplissait avant de les atteindre.
  const connues = [...Array(MAX_OFFRES)].map((_, i) => `VU${i}`);
  const brutes = connues.map((id) => offreFT(id)).concat([...Array(3)].map((_, i) => offreFT(`N${i}`)));
  const lot = prepareLot(brutes, { dejaVus: new Set(connues) });
  assert.equal(lot.offres.length, 3);
  assert.equal(lot.tronquees, 0);
});

test("dejaVus accepte un tableau autant qu'un Set", () => {
  const lot = prepareLot([offreFT("A"), offreFT("B")], { dejaVus: ["A"] });
  assert.deepEqual(
    lot.offres.map((o) => o.jobId),
    ["B"],
  );
});

test("sans dejaVus, rien ne change pour les appelants existants", () => {
  const lot = prepareLot([offreFT("A"), offreFT("B")]);
  assert.equal(lot.offres.length, 2);
  assert.equal(lot.dejaVues, 0);
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

// -- Classement par pertinence avant troncature -------------------------------
//
// Le bug réel : en France entière, 1 161 offres distinctes arrivent, 150 partent
// au modèle, et ces 150 venaient d'UN SEUL mot-clé sur 33 parce que la troncature
// se faisait dans l'ordre d'arrivée. Les offres ciblées des requêtes suivantes
// n'atteignaient jamais le tri.

const CLES = ["automatisation", "n8n", "intelligence artificielle", "python"];

test("le titre qui porte un mot-clé passe AVANT celui qui ne l'a que dans la description", () => {
  const horsSujet = offreFT("BRUIT", {
    intitule: "Conducteur de ligne",
    description: "Atelier avec automatisation des convoyeurs.",
  });
  const cible = offreFT("CIBLE", { intitule: "Ingénieur automatisation", description: "Rien de plus." });
  // volontairement dans le MAUVAIS ordre d'arrivée
  const lot = prepareLot([horsSujet, cible], { maxOffres: 1, motsCles: CLES });
  assert.deepEqual(
    lot.offres.map((o) => o.jobId),
    ["CIBLE"],
    "la troncature doit garder l'offre du métier, pas la première arrivée",
  );
  assert.equal(lot.tronquees, 1);
});

test("les accents et la casse ne font pas rater un mot-clé", () => {
  const o = offreFT("A", { intitule: "INGENIEUR Intelligence Artificielle", description: "x" });
  assert.ok(scorePertinence(normaliseOffre(o), clesNormalisees(["Intelligence Artificielle"])) >= 4);
});

test("à score égal, l'ordre d'arrivée est conservé — la priorité du YAML survit", () => {
  // Les deux ont un mot-clé dans le titre : rien ne doit les réordonner, sinon la
  // priorité des mots-clés que Linéo a mis en tête de config serait perdue.
  const brutes = [
    offreFT("PREMIER", { intitule: "Ingénieur automatisation" }),
    offreFT("SECOND", { intitule: "Développeur automatisation" }),
  ];
  const lot = prepareLot(brutes, { motsCles: CLES });
  assert.deepEqual(
    lot.offres.map((o) => o.jobId),
    ["PREMIER", "SECOND"],
  );
});

test("sans motsCles, l'ordre d'arrivée est intact : les appelants existants ne changent pas", () => {
  const brutes = [offreFT("A", { intitule: "Conducteur de ligne" }), offreFT("B", { intitule: "Ingénieur n8n" })];
  const lot = prepareLot(brutes);
  assert.deepEqual(
    lot.offres.map((o) => o.jobId),
    ["A", "B"],
  );
});

test("l'alternance et le stage sont écartés AVANT le modèle, et comptés", () => {
  // Le prompt dit « JAMAIS, sans exception » : faire trancher le modèle coûtait
  // une place de lot et des tokens de sortie pour une réponse connue d'avance.
  const brutes = [
    offreFT("ALT", { intitule: "Alternance - Ingénieur automatisation (H/F)" }),
    offreFT("STAGE", { intitule: "Stage automatisation 6 mois" }),
    offreFT("DRAPEAU", { intitule: "Ingénieur automatisation", alternance: true }),
    offreFT("VRAIE", { intitule: "Ingénieur automatisation" }),
  ];
  const lot = prepareLot(brutes, { motsCles: CLES });
  assert.deepEqual(
    lot.offres.map((o) => o.jobId),
    ["VRAIE"],
  );
  assert.equal(lot.alternances, 3, "le compte doit être annoncé, pas silencieux");
  assert.equal(lot.doublons, 0, "une alternance n'est pas un doublon de tournée");
});

test("« stagiaire » ne doit pas attraper un mot qui le contient par hasard", () => {
  const lot = prepareLot([offreFT("OK", { intitule: "Ingénieur automatisation stagiairisation" })], {
    motsCles: CLES,
  });
  assert.equal(lot.offres.length, 1, "la frontière de mot doit être respectée");
});

test("cibleesGardees mesure ce que la troncature a réellement retenu", () => {
  // Intitulés distincts : trois annonces de même employeur, même intitulé et même
  // ville seraient désormais le même poste, et la mesure porterait sur 1 offre.
  const cibles = [...Array(3)].map((_, i) => offreFT(`C${i}`, { intitule: `Ingénieur automatisation niveau ${i}` }));
  const bruit = [...Array(5)].map((_, i) => offreFT(`B${i}`, { intitule: `Conducteur de ligne ${i}`, description: "x" }));
  const lot = prepareLot([...bruit, ...cibles], { maxOffres: 3, motsCles: CLES });
  assert.equal(lot.cibleesGardees, 3, "les 3 places doivent aller aux 3 offres ciblées");
});

// -- Plancher de score et memoire du bruit ------------------------------------
//
// Decision de Lineo : « s'il n'y a pas de bonne offre, pas obligé d'aller jusqu'à
// 60 ». Et : une offre deja jugee comme du bruit ne doit plus etre reexaminee.

test("le plafond de retenues n'est pas un quota, et le prompt le dit", () => {
  const p = promptRank({ offres: [normaliseOffre(offreFT("A"))], filtres: {}, maxRetenues: 60, scoreMin: 40 });
  assert.ok(/PLAFOND, pas un quota/.test(p));
  assert.ok(/Ne le remplis pas/.test(p));
  assert.ok(/en dessous de 40/.test(p), "le plancher doit etre annonce au modele");
});

test("une offre sous le plancher n'entre pas dans la file, et sort en nonRetenues", () => {
  const soumises = [normaliseOffre(offreFT("BON")), normaliseOffre(offreFT("FAIBLE"))];
  const jobs = [
    { jobId: "BON", title: "Ingénieur automatisation", score: 70 },
    { jobId: "FAIBLE", title: "Data Scientist", score: 20 },
  ];
  const { gardes, nonRetenues } = trieParPlancher({ soumises, jobs, scoreMin: 40 });
  assert.deepEqual(
    gardes.map((j) => j.jobId),
    ["BON"],
  );
  assert.equal(nonRetenues.length, 1);
  assert.equal(nonRetenues[0].jobId, "FAIBLE");
  assert.match(nonRetenues[0].raison, /sous le plancher 40/, "la raison doit etre lisible dans le journal");
});

test("les offres soumises que le modèle n'a PAS citées sont mémorisées aussi", () => {
  // Le vrai gisement de bruit : 90 offres sur 150 le 2026-08-10. Sans trace, elles
  // reviennent chaque jour se refaire juger a l'identique.
  const soumises = [normaliseOffre(offreFT("A")), normaliseOffre(offreFT("B")), normaliseOffre(offreFT("C"))];
  const jobs = [{ jobId: "A", title: "x", score: 80 }];
  const { gardes, nonRetenues } = trieParPlancher({ soumises, jobs, scoreMin: 40 });
  assert.equal(gardes.length, 1);
  assert.deepEqual(nonRetenues.map((o) => o.jobId).sort(), ["B", "C"]);
  for (const o of nonRetenues) {
    assert.equal(o.score, null, "une offre non citee n'a PAS de score, et null le dit");
    assert.match(o.raison, /non citee/);
  }
});

test("un score ABSENT ne vaut pas un score bas : l'offre est gardée", () => {
  // Jeter par defaut ferait disparaitre l'offre en silence — la perte qu'on ne
  // voit qu'en relisant le journal six semaines plus tard.
  const soumises = [normaliseOffre(offreFT("A"))];
  const { gardes, nonRetenues } = trieParPlancher({ soumises, jobs: [{ jobId: "A", score: null }], scoreMin: 40 });
  assert.equal(gardes.length, 1);
  assert.equal(nonRetenues.length, 0);
});

test("un plancher à 0 laisse tout passer : le mécanisme est débrayable", () => {
  const soumises = [normaliseOffre(offreFT("A"))];
  const { gardes } = trieParPlancher({ soumises, jobs: [{ jobId: "A", score: 5 }], scoreMin: 0 });
  assert.equal(gardes.length, 1);
});

test("aucune offre au-dessus du plancher : file vide, et TOUT est mémorisé", () => {
  // Le cas que Lineo a demande : une tournee peut legitimement ne rien rapporter.
  const soumises = [normaliseOffre(offreFT("A")), normaliseOffre(offreFT("B"))];
  const jobs = [
    { jobId: "A", score: 25 },
    { jobId: "B", score: 30 },
  ];
  const { gardes, nonRetenues } = trieParPlancher({ soumises, jobs, scoreMin: 40 });
  assert.equal(gardes.length, 0, "mieux vaut zero offre qu'une mauvaise");
  assert.equal(nonRetenues.length, 2, "et les deux doivent etre memorisees");
});

test("le champ interne de classement ne fuit JAMAIS vers le prompt", () => {
  const lot = prepareLot([offreFT("A", { intitule: "Ingénieur automatisation" })], { motsCles: CLES });
  assert.ok(!("_pertinence" in lot.offres[0]), "_pertinence est un détail de tri, pas une donnée d'offre");
  const p = promptRank({ offres: lot.offres, filtres: {} });
  assert.ok(!p.includes("_pertinence"), "le modèle ne doit pas voir notre pré-classement");
});

test("le score mesure l ADEQUATION au profil, pas la presence de mots-cles", () => {
  // Le defaut trouve le 2026-08-06 : trois postes UiPath notes 80+ alors que le CV
  // n'en contient pas une ligne, parce que le profil n'etait pas transmis. Le
  // prompt doit maintenant dire explicitement ce que mesure le score.
  const p = promptRank({
    offres: [normaliseOffre(offreFT("A"))],
    filtres: { positive: ["RPA", "UiPath"] },
    profil: "n8n, API REST, PostgreSQL. Aucun outil RPA.",
  });
  assert.ok(/PROFIL REEL/.test(p), "le profil doit etre annonce comme source de verite");
  assert.ok(/ADEQUATION/.test(p));
  assert.ok(/score BAS/.test(p), "une offre exigeant un outil absent du profil doit etre penalisee");
  assert.ok(/ce qu'il CHERCHE, pas ce qu'il SAIT faire/.test(p), "les mots-cles ne sont pas des competences");
});

test("sans profil, le prompt le DIT au lieu de faire semblant", () => {
  const p = promptRank({ offres: [normaliseOffre(offreFT("A"))], filtres: { positive: ["RPA"] } });
  assert.ok(/non fourni/.test(p));
  assert.ok(/dis-le dans whyMatch/.test(p), "l absence de profil doit etre visible dans le resultat");
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

// --- Adresse de contact de l'annonce ---

test("normaliseOffre porte le courriel publié par France Travail", () => {
  const o = normaliseOffre({ id: "1", intitule: "Dev", contact: { courriel: "RH@Acme.fr" } });
  assert.equal(o.contactEmail, "RH@Acme.fr");
});

test("le prompt ne contient JAMAIS l'adresse de contact", () => {
  // Le modèle juge la pertinence d'une offre : il n'a aucune raison de lire une
  // adresse personnelle pour ça. C'est aussi une donnée de moins envoyée dehors.
  const lot = [
    normaliseOffre({ id: "1", intitule: "Dev", contact: { courriel: "rh@acme.fr" } }),
  ];
  const prompt = promptRank({ offres: lot, profil: "profil de test", maxRetenues: 5 });
  assert.equal(prompt.includes("rh@acme.fr"), false);
});

test("le courriel du job final vient de la source, jamais du modèle", () => {
  // LE point de sécurité de ce champ : une adresse inventée ferait partir une
  // vraie candidature chez un inconnu. Ici le modèle en propose une autre —
  // elle doit être ignorée, contrairement à title/company où il fait secours.
  const connues = [
    { jobId: "1", title: "Dev", company: "Acme", url: "https://x.test/1", location: "Paris", description: "", contactEmail: "vrai@acme.fr" },
  ];
  const { jobs } = parseRank(
    JSON.stringify({ jobs: [{ jobId: "1", score: 80, whyMatch: "ok", contactEmail: "invente@ailleurs.test" }] }),
    { offresConnues: connues },
  );
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].contactEmail, "vrai@acme.fr");
});

test("une offre sans contact ressort avec une chaîne vide", () => {
  const connues = [{ jobId: "1", title: "Dev", company: "Acme", url: "https://x.test/1", location: "", description: "" }];
  const { jobs } = parseRank(JSON.stringify({ jobs: [{ jobId: "1", score: 50, whyMatch: "ok" }] }), {
    offresConnues: connues,
  });
  assert.equal(jobs[0].contactEmail, "");
});
