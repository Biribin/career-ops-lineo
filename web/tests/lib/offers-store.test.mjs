// Tests du stockage des offres decouvertes (offers-store.mjs).
//
// Ce journal est ce que Lineo regarde pour decider quelles offres traiter. Deux
// erreurs y seraient couteuses : une offre affichee deux fois apres un rescan
// (il candidaterait deux fois), et une ligne sans identifiant (impossible a
// dedupliquer ni a valider ensuite).
//
// Run:  node --test tests/lib/offers-store.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { courrielContact, etatCourant, ligneDecision, lignesAAjouter, lignesNonRetenues, normaliseOffreRecue, offreComplete, parseJournal, STATUTS_CLASSANTS } from "../../src/lib/offers-store.mjs";

const T = "2026-08-06T12:00:00.000Z";
const T2 = "2026-08-07T12:00:00.000Z";

// -- NON_RETENUE : la memoire du bruit ----------------------------------------

test("une offre NON_RETENUE disparait de la file affichee", () => {
  // Sinon les 90 offres jugees et non gardees s'afficheraient comme des cartes a
  // decider, ce qui serait pire que l'etat de depart.
  assert.ok(STATUTS_CLASSANTS.includes("NON_RETENUE"));
  const journal = [
    { jobId: "BRUIT", statut: "A_DECIDER", vu_le: T },
    { jobId: "BRUIT", statut: "NON_RETENUE", vu_le: T2 },
    { jobId: "BONNE", statut: "A_DECIDER", vu_le: T },
  ];
  assert.deepEqual(
    etatCourant(journal).map((o) => o.jobId),
    ["BONNE"],
  );
});

test("NON_RETENUE se distingue de ECARTEE : la machine et Lineo ne disent pas la meme chose", () => {
  // On doit pouvoir revenir sur un verdict du modele sans effacer une decision
  // humaine, donc les deux statuts ne se confondent pas.
  const [l] = lignesNonRetenues([{ jobId: "A", title: "Data Scientist", score: 20 }], T);
  assert.equal(l.statut, "NON_RETENUE");
  assert.notEqual(l.statut, "ECARTEE");
});

test("les lignes non retenues portent de quoi comprendre, et bornent le score", () => {
  const lignes = lignesNonRetenues(
    [
      { jobId: "A", title: "Data Scientist", score: 20, raison: "score 20 sous le plancher 40" },
      { jobId: "B", title: "Autre", score: 250 },
      { jobId: "C" },
    ],
    T,
    { source: "n8n/decouverte", executionId: "42" },
  );
  assert.equal(lignes.length, 3);
  assert.equal(lignes[0].raison, "score 20 sous le plancher 40");
  assert.equal(lignes[1].score, 100, "le score reste borne a 0..100");
  assert.equal(lignes[2].score, null, "pas de score = null, pas 0");
  assert.equal(lignes[2].raison, "non gardee au tri", "une raison par defaut, jamais vide");
  assert.equal(lignes[0].source, "n8n/decouverte");
  assert.equal(lignes[0].execution_id, "42");
  assert.equal(lignes[0].vu_le, T, "horodatage injecte, pas Date.now()");
});

test("une non-retenue sans jobId est ignoree, et les doublons du lot fusionnes", () => {
  const lignes = lignesNonRetenues([{ title: "sans id" }, { jobId: "A" }, { jobId: "A" }], T);
  assert.deepEqual(
    lignes.map((l) => l.jobId),
    ["A"],
  );
});

test("une offre sans jobId est ecartee, pas stockee", () => {
  assert.equal(normaliseOffreRecue({ title: "sans id" }), null);
  const { lignes, ecartees } = lignesAAjouter({ jobs: [{ title: "x" }, { jobId: "A" }] }, T);
  assert.equal(lignes.length, 1);
  assert.equal(ecartees, 1);
});

test("le score est borne, et un score absent devient null", () => {
  assert.equal(normaliseOffreRecue({ jobId: "A", score: 250 }).score, 100);
  assert.equal(normaliseOffreRecue({ jobId: "A", score: -8 }).score, 0);
  assert.equal(normaliseOffreRecue({ jobId: "A" }).score, null);
  // `Number(null)` vaut 0 : sans garde explicite, un score null devenait 0 et
  // l'offre s'affichait « notee 0/100 » au lieu de « pas encore evaluee ».
  // Constate le 2026-08-10 sur une offre ajoutee a la main.
  assert.equal(normaliseOffreRecue({ jobId: "A", score: null }).score, null);
  assert.equal(normaliseOffreRecue({ jobId: "A", score: "" }).score, null);
  assert.equal(normaliseOffreRecue({ jobId: "A", score: 0 }).score, 0, "un vrai 0 reste un 0");
});

test("chaque ligne porte statut, horodatage et execution", () => {
  const { lignes } = lignesAAjouter({ jobs: [{ jobId: "A" }], source: "n8n/decouverte", executionId: "42" }, T);
  assert.equal(lignes[0].statut, "A_DECIDER");
  assert.equal(lignes[0].vu_le, T);
  assert.equal(lignes[0].source, "n8n/decouverte");
  assert.equal(lignes[0].execution_id, "42");
});

test("une offre revue lors d'une tournee suivante n'apparait QU'UNE fois", () => {
  // Sans ca, Lineo verrait deux fois la meme offre et pourrait candidater deux fois.
  const journal = [
    { jobId: "A", title: "ancien titre", score: 50, vu_le: "2026-08-01T00:00:00.000Z" },
    { jobId: "A", title: "titre a jour", score: 90, vu_le: "2026-08-06T00:00:00.000Z" },
  ];
  const etat = etatCourant(journal);
  assert.equal(etat.length, 1);
  assert.equal(etat[0].title, "titre a jour", "la ligne la plus recente fait foi");
});

test("les mieux notees sortent en premier", () => {
  const etat = etatCourant([
    { jobId: "A", score: 40, vu_le: T },
    { jobId: "B", score: 95, vu_le: T },
    { jobId: "C", score: null, vu_le: T },
  ]);
  assert.deepEqual(etat.map((o) => o.jobId), ["B", "A", "C"], "un score absent passe en dernier");
});

test("une ligne corrompue ne rend pas tout l historique illisible", () => {
  const brut = [
    JSON.stringify({ jobId: "A", score: 10 }),
    "{ ligne tronquee par une ecriture interrompue",
    JSON.stringify({ jobId: "B", score: 20 }),
    "",
  ].join("\n");
  assert.deepEqual(parseJournal(brut).map((l) => l.jobId), ["A", "B"]);
});

test("journal vide ou absent : etat vide, pas de crash", () => {
  assert.deepEqual(parseJournal(""), []);
  assert.deepEqual(parseJournal(null), []);
  assert.deepEqual(etatCourant([]), []);
  assert.deepEqual(etatCourant(null), []);
});

// ── Les decisions de Lineo, et leur caractere COLLANT ────────────────────────

test("une offre ecartee disparait de la file", () => {
  const etat = etatCourant([
    { jobId: "A", title: "a garder", score: 90, vu_le: T },
    { jobId: "B", title: "a jeter", score: 80, vu_le: T },
    ligneDecision("B", "ecarter", T2),
  ]);
  assert.deepEqual(etat.map((o) => o.jobId), ["A"]);
});

test("LE test qui compte : une offre ecartee ne revient PAS a la tournee suivante", () => {
  // Le journal est append-only et la ligne la plus recente fait foi. Sans le
  // balayage des statuts classants, le rescan du lendemain ressusciterait
  // l'offre et Lineo devrait l'ecarter tous les jours.
  const etat = etatCourant([
    { jobId: "B", title: "a jeter", score: 80, vu_le: T },
    ligneDecision("B", "ecarter", T),
    { jobId: "B", title: "a jeter", score: 80, vu_le: T2 }, // repostee par n8n, PLUS RECENTE
  ]);
  assert.deepEqual(etat, [], "l'ecart doit gagner contre une ligne de scan plus recente");
});

test("une offre partie en redaction ne revient pas non plus", () => {
  // Elle vit maintenant dans « A valider ». La revoir ici, c'est risquer de
  // candidater deux fois chez le meme employeur.
  const etat = etatCourant([
    { jobId: "C", title: "en cours", score: 70, vu_le: T },
    ligneDecision("C", "generer", T),
    { jobId: "C", title: "en cours", score: 70, vu_le: T2 },
  ]);
  assert.deepEqual(etat, []);
});

test("une offre a laquelle Lineo a postule LUI-MEME sort aussi de la file", () => {
  // Il a candidate sur France Travail. Rien a rediger, mais l'offre ne doit plus
  // encombrer la file — et surtout ne pas revenir a la tournee suivante.
  const etat = etatCourant([
    { jobId: "D", title: "postulee a la main", score: 60, vu_le: T },
    ligneDecision("D", "postuler", T),
    { jobId: "D", title: "postulee a la main", score: 60, vu_le: T2 },
  ]);
  assert.deepEqual(etat, []);
});

test("ligneDecision refuse ce qui n'est pas une decision", () => {
  assert.equal(ligneDecision("", "ecarter", T), null);
  assert.equal(ligneDecision("A", "supprimer-tout", T), null);
  assert.equal(ligneDecision("A", "", T), null);
  assert.deepEqual(ligneDecision("A", "generer", T), {
    jobId: "A",
    statut: "GENEREE",
    decide_le: T,
    vu_le: T,
  });
  assert.equal(ligneDecision("A", "postuler", T).statut, "POSTULEE");
});

test("offreComplete ignore les lignes de decision, qui n'ont pas de contenu", () => {
  // Sans ca on enverrait a n8n une offre vide, et il echouerait sur
  // « ni title ni description ».
  const journal = [
    { jobId: "A", title: "ancien titre", description: "vieux texte", vu_le: T },
    { jobId: "A", title: "titre a jour", description: "texte a jour", vu_le: T2 },
    ligneDecision("A", "generer", T2),
  ];
  const o = offreComplete(journal, "A");
  assert.equal(o.title, "titre a jour", "la derniere ligne AVEC du contenu fait foi");
  assert.equal(offreComplete(journal, "inconnu"), null);
  assert.equal(offreComplete(journal, ""), null);
});

// --- Adresse de contact de l'annonce (champ contact.courriel de France Travail) ---
//
// Elle finit comme DESTINATAIRE d'un vrai mail. Le principe est donc l'inverse
// de l'habituel : dans le doute on ne rend RIEN, pour que la candidature parte
// à une adresse devinée (comportement actuel) plutôt qu'à la mauvaise personne.

test("courrielContact accepte une adresse simple et la normalise", () => {
  assert.equal(courrielContact("  Recrutement@Acme.FR "), "recrutement@acme.fr");
});

test("courrielContact refuse tout ce qui n'est pas UNE adresse nue", () => {
  for (const douteux of [
    "Jean Dupont <jean@acme.fr>", // nom affiché : on ne découpe pas au jugé
    "a@acme.fr, b@acme.fr", // deux destinataires
    "a@acme.fr; b@acme.fr",
    "pas-une-adresse",
    "a@acme", // pas de domaine de premier niveau
    "@acme.fr",
    "a@.fr",
    "",
    null,
    undefined,
  ]) {
    assert.equal(courrielContact(douteux), "", `aurait dû être refusé : ${String(douteux)}`);
  }
});

test("courrielContact borne la longueur", () => {
  assert.equal(courrielContact("a".repeat(250) + "@acme.fr"), "");
});

test("normaliseOffreRecue porte le courriel, quel que soit son nom d'origine", () => {
  // Le nom du champ dépend du nœud n8n qui a construit le lot : on accepte les
  // trois plutôt que d'imposer un renommage en amont.
  for (const cle of ["contactEmail", "contact_email", "courriel"]) {
    const o = normaliseOffreRecue({ jobId: "1", [cle]: "rh@acme.fr" });
    assert.equal(o.contactEmail, "rh@acme.fr", `via ${cle}`);
  }
});

test("une offre sans courriel exploitable en ressort avec une chaîne vide", () => {
  // Et surtout PAS `undefined` : le workflow 2 teste la présence du champ, une
  // clé absente et une adresse invalide doivent se comporter pareil.
  assert.equal(normaliseOffreRecue({ jobId: "1" }).contactEmail, "");
  assert.equal(normaliseOffreRecue({ jobId: "1", contactEmail: "n'importe quoi" }).contactEmail, "");
});
