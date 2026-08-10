// Tests du skill « adapter le CV YAML » (cv-adapt.mjs).
//
// Les refus testés ici ne sont pas théoriques : ce sont les défauts réellement
// constatés en production.
//
// 2026-08-05/06, quand l'adaptation vivait dans un prompt d'agent LangChain à
// l'intérieur de n8n, sans aucun test :
//   - clé `keywords` supprimée   -> section ATS absente du PDF (run 958225) ;
//   - `summary` aplati en une ligne avec un « : » -> YAML invalide, Action en
//     échec, zéro PDF (run 958225) ;
//   - « depuis deux ans » alors que le poste a commencé en mars 2026 ;
//   - tirets cadratin / markdown dans un document candidat.
//
// 2026-08-10, première candidature réelle (Devoteam, run n8n 971972) :
//   - le CV adapté débordait sur une deuxième page et rien ne le vérifiait ici,
//     alors que la consigne donnée à l'agent lui interdisait de couper ;
//   - « accompagnes pendant un an », vrai et déjà présent dans le CV de base,
//     était compté comme une ancienneté inventée -> tout CV gardant cette puce
//     était refusé, puis n8n retombait en silence sur le réservoir de 2 pages.
//
// Run:  node --test tests/lib/cv-adapt.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  BUDGET_CAR_RENDUS,
  carRendus,
  cheminsCvYaml,
  clesTopNiveau,
  contexteCvYaml,
  dureeInventee,
  dureesAnnees,
  nettoieYamlAdapte,
  periodes,
  promptCvYaml,
  verifieCvAdapte,
} from "../../src/lib/cv-adapt.mjs";

const ORIGINAL = `meta:
  locale: fr

basics:
  name: Lineo Biribin
  title: Ingenieur en automatisation

summary: >-
  Je concois et mets en production des systemes d'information metier.
  Ma methode : remplacer chaque processus manuel par un flux auditable.

keywords: []

experience:
  - role: Responsable SI
    org: Groupe aeroportuaire
    period: Depuis mars 2026
    highlights:
      - >-
        Conception et mise en production de la chaine SI du groupe.
      - >-
        Moteur de paie interne calibre a moins de 1 pour cent d'ecart.

education:
  - degree: Cycle Master
    org: EFREI
    period: 2019 - 2024
`;

/** Une adaptation plausible : le titre bouge, les dates et les clés ne bougent pas. */
const adapteBien = (extra = "") =>
  ORIGINAL.replace("title: Ingenieur en automatisation", "title: Ingenieur integration API et IA").replace(
    "keywords: []",
    'keywords: ["n8n", "API REST"]',
  ) + extra;

// ── nettoyage ───────────────────────────────────────────────────────────────

test("la cloture markdown que le modele ajoute est retiree", () => {
  const t = nettoieYamlAdapte("```yaml\nmeta:\n  locale: fr\n```");
  assert.equal(t, "meta:\n  locale: fr\n");
});

test("tirets cadratin et gras markdown sont nettoyes, l'indentation est intacte", () => {
  const t = nettoieYamlAdapte("summary: >-\n  Un **socle** metier — fiable — et auditable.\n");
  assert.match(t, /Un socle metier, fiable, et auditable\./);
  assert.match(t, /^summary: >-\n {2}Un/);
  assert.ok(!t.includes("—"));
});

test("les marqueurs de bloc et les commentaires ne sont pas touches", () => {
  const src = "# un commentaire\nsummary: >-\n  texte\nbloc: |\n  litteral\n";
  assert.equal(nettoieYamlAdapte(src), src);
});

// ── lecture sans parseur ────────────────────────────────────────────────────

test("les cles de premier niveau sont lues dans l'ordre, sans doublon", () => {
  assert.deepEqual(clesTopNiveau(ORIGINAL), ["meta", "basics", "summary", "keywords", "experience", "education"]);
});

test("les periodes sont lues, guillemets retires", () => {
  assert.deepEqual(periodes(ORIGINAL), ["Depuis mars 2026", "2019 - 2024"]);
  assert.deepEqual(periodes('  - period: "2019 - 2024"\n'), ["2019 - 2024"]);
});

test("une duree chiffree en annees est detectee, un nombre ordinaire non", () => {
  assert.ok(dureeInventee("deux ans d'experience"));
  assert.ok(dureeInventee("3 ans sur le sujet"));
  assert.ok(!dureeInventee("900 salaries et 12 716 vacations"));
});

test("les durees sont listees et normalisees, pas seulement detectees", () => {
  assert.deepEqual(dureesAnnees("Deux ans ici, puis  un   an la"), ["deux ans", "un an"]);
  assert.deepEqual(dureesAnnees("900 salaries"), []);
});

test("une duree DEJA dans le CV de base n'est pas une invention", () => {
  // L'incident du 2026-08-10 : `locales/fr.yml` dit « accompagnes pendant un an »,
  // c'est vrai, et tout CV adapte qui gardait cette puce etait refuse.
  const base = ORIGINAL.replace(
    "        Conception et mise en production de la chaine SI du groupe.\n",
    "        Deux eleves de terminale accompagnes pendant un an, preparation au baccalaureat.\n",
  );
  const r = verifieCvAdapte({ original: base, adapte: base.replace("keywords: []", 'keywords: ["n8n"]') });
  assert.equal(r.ok, true, r.motif);
});

test("REFUS : la meme duree dupliquee ailleurs reste une invention", () => {
  // Un comptage, pas un ensemble : « un an » vrai une fois ne rend pas vrai un
  // second « un an » ajouté sur une autre expérience.
  const base = ORIGINAL.replace(
    "        Conception et mise en production de la chaine SI du groupe.\n",
    "        Deux eleves accompagnes pendant un an.\n",
  );
  const r = verifieCvAdapte({
    original: base,
    adapte: base.replace(
      "        Moteur de paie interne calibre a moins de 1 pour cent d'ecart.\n",
      "        Moteur de paie interne, un an de production.\n",
    ),
  });
  assert.equal(r.ok, false);
  assert.match(r.motif, /anciennete|ancienneté/);
});

// ── verdict ─────────────────────────────────────────────────────────────────

test("une adaptation propre passe et rend le YAML nettoye", () => {
  const r = verifieCvAdapte({ original: ORIGINAL, adapte: adapteBien() });
  assert.equal(r.ok, true);
  assert.match(r.adaptedYaml, /title: Ingenieur integration API et IA/);
  assert.deepEqual(r.avertissements, []);
});

test("REFUS : une cle de premier niveau supprimee (le defaut keywords du run 958225)", () => {
  const sans = ORIGINAL.replace("keywords: []\n\n", "");
  const r = verifieCvAdapte({ original: ORIGINAL, adapte: sans });
  assert.equal(r.ok, false);
  assert.match(r.motif, /keywords/);
});

test("REFUS : une date reecrite", () => {
  const r = verifieCvAdapte({
    original: ORIGINAL,
    adapte: adapteBien().replace("period: Depuis mars 2026", "period: Depuis 2024"),
  });
  assert.equal(r.ok, false);
  assert.match(r.motif, /dates ont ete modifiees|dates ont été modifiées/);
});

test("REFUS : une anciennete inventee, meme apres nettoyage", () => {
  const r = verifieCvAdapte({
    original: ORIGINAL,
    adapte: adapteBien().replace("Ma methode :", "Avec deux ans de recul, ma methode :"),
  });
  assert.equal(r.ok, false);
  assert.match(r.motif, /anciennete|ancienneté/);
});

test("REFUS : un CV tronque, et un CV gonfle", () => {
  // Toutes les cles et toutes les dates sont la : SEUL le volume trahit le CV
  // vide de sa substance (les puces ont disparu).
  const tronque = verifieCvAdapte({
    original: ORIGINAL,
    adapte:
      "meta:\n  locale: fr\nbasics:\n  name: L\nsummary: a\nkeywords: []\nexperience:\n  - period: Depuis mars 2026\neducation:\n  - period: 2019 - 2024\n",
  });
  assert.equal(tronque.ok, false);
  assert.match(tronque.motif, /volume anormal/);

  const gonfle = verifieCvAdapte({ original: ORIGINAL, adapte: adapteBien("\n# " + "x".repeat(ORIGINAL.length)) });
  assert.equal(gonfle.ok, false);
  assert.match(gonfle.motif, /volume anormal/);
});

test("REFUS : une sortie vide", () => {
  assert.equal(verifieCvAdapte({ original: ORIGINAL, adapte: "   " }).ok, false);
});

test("un CV rendu a l'identique passe, mais le dit", () => {
  const r = verifieCvAdapte({ original: ORIGINAL, adapte: ORIGINAL });
  assert.equal(r.ok, true);
  assert.equal(r.avertissements.length, 1);
  assert.match(r.avertissements[0], /identique/);
});

// ── tenue sur une page ──────────────────────────────────────────────────────
//
// Incident du 2026-08-10, première candidature réelle (Devoteam, run n8n 971972) :
// l'agent n'a retouché que `keywords`, le CV a rendu deux pages et l'Action
// GitHub 31392068671 a bloqué l'envoi. La consigne disait alors « longueurs
// équivalentes », donc l'agent avait raison de ne rien couper.

test("carRendus ne compte que ce qui s'imprime", () => {
  // Clés, indentation, commentaires et marqueurs de bloc ne partent pas chez le
  // recruteur : seules les valeurs comptent.
  assert.equal(carRendus("# un commentaire tres long qui ne se rend jamais\n"), 0);
  assert.equal(carRendus("summary: >-\n"), 0, "un marqueur de bloc seul n'imprime rien");
  assert.equal(carRendus("basics:\n  name: Lineo\n"), "Lineo".length + 1);
  assert.equal(carRendus('  - period: "2019 - 2024"\n'), "2019 - 2024".length + 1, "guillemets retires");
  // Une clé sans valeur (juste un conteneur) n'imprime rien par elle-même.
  assert.equal(carRendus("experience:\n"), 0);
});

test("carRendus ignore les commentaires, qui sont la vraie fausse piste", () => {
  const avec = "# " + "x".repeat(4000) + "\nbasics:\n  name: Lineo\n";
  assert.equal(carRendus(avec), carRendus("basics:\n  name: Lineo\n"));
});

/**
 * Le CV de base tel qu'il est vraiment : un réservoir exhaustif, très au-dessus
 * du budget une page. C'est la situation de départ de toute candidature, et le
 * fixture doit la refléter — un original minuscule ferait tirer le garde-fou de
 * ratio avant le budget, et le test ne prouverait rien.
 */
const RESERVOIR = ORIGINAL.replace(
  "        Moteur de paie interne calibre a moins de 1 pour cent d'ecart.\n",
  "        Moteur de paie interne calibre a moins de 1 pour cent d'ecart.\n" +
    Array.from(
      { length: 70 },
      (_, i) => `      - >-\n        Puce numero ${i} : vraie, verifiable, et sans le moindre rapport avec l'offre visee.\n`,
    ).join(""),
);

test("le reservoir de depart depasse bien le budget une page", () => {
  assert.ok(carRendus(RESERVOIR) > BUDGET_CAR_RENDUS, "fixture inutile si le reservoir tient deja sur une page");
});

test("REFUS : un CV adapte qui deborde sur une deuxieme page", () => {
  // L'incident du 2026-08-10, à l'identique : l'agent remplit `keywords` et ne
  // retire rien. Toutes les clés sont là, les dates sont intactes, rien n'est
  // inventé, le volume est dans le ratio (il n'a quasiment pas bougé) : SEUL le
  // budget une page trahit le CV que l'agent n'a pas su couper.
  const commeLIncident = RESERVOIR.replace("keywords: []", 'keywords: ["IA", "LLM"]');
  const r = verifieCvAdapte({ original: RESERVOIR, adapte: commeLIncident });
  assert.equal(r.ok, false);
  assert.match(r.motif, /ne tient pas sur une page/);
  assert.match(r.motif, /SÉLECTIONNER/);
  // Le motif doit dire COMBIEN retirer : c'est ce qui le rend exploitable.
  assert.match(r.motif, new RegExp(`${BUDGET_CAR_RENDUS} au budget`));
  assert.match(r.motif, /\d+ à retirer/);
});

test("un CV reellement selectionne dans le reservoir passe", () => {
  // Même réservoir, mais l'agent a fait son travail : il retire les puces hors
  // sujet JUSQU'A TENIR, il ne vide pas le CV. C'est la nuance qui compte, et
  // c'est pour ça que RATIO_MIN et le budget peuvent cohabiter : couper pour
  // tenir sur une page reste très loin d'une troncature.
  const HORS_SUJET =
    /      - >-\n        Puce numero \d+ : vraie, verifiable, et sans le moindre rapport avec l'offre visee\.\n/;
  let selectionne = RESERVOIR;
  while (carRendus(selectionne) > BUDGET_CAR_RENDUS) {
    const avant = selectionne;
    selectionne = selectionne.replace(HORS_SUJET, "");
    if (selectionne === avant) break; // plus rien à couper : le test échouerait plus bas
  }
  selectionne = selectionne.replace("keywords: []", 'keywords: ["IA", "LLM"]');

  const r = verifieCvAdapte({ original: RESERVOIR, adapte: selectionne });
  assert.equal(r.ok, true, r.motif);
  assert.ok(carRendus(r.adaptedYaml) <= BUDGET_CAR_RENDUS);
  assert.match(r.adaptedYaml, /Moteur de paie interne/, "les puces pertinentes doivent survivre");
});

test("le budget laisse passer un CV effectivement selectionne", () => {
  const r = verifieCvAdapte({ original: ORIGINAL, adapte: adapteBien() });
  assert.equal(r.ok, true);
  assert.ok(carRendus(r.adaptedYaml) <= BUDGET_CAR_RENDUS);
});

test("le budget une page et le garde-fou anti-troncature ne se contredisent pas", () => {
  // Le mandat de coupe ne doit pas pousser un CV légitime sous RATIO_MIN. Mesuré
  // sur le vrai locales/fr.yml : le pire cas donne 0.59, au-dessus de 0.50.
  // Ce test fige le raisonnement pour que baisser le budget ne le casse pas en
  // silence.
  assert.ok(BUDGET_CAR_RENDUS > 0);
  const rendusOrigineReelle = 8250; // locales/fr.yml sur main, 2026-08-10
  const coupeMax = rendusOrigineReelle - BUDGET_CAR_RENDUS;
  const totalOrigineReelle = 12535;
  const commentaires = 2425;
  const ratioPireCas = (totalOrigineReelle - commentaires - coupeMax) / totalOrigineReelle;
  assert.ok(ratioPireCas > 0.5, `le pire cas ${ratioPireCas.toFixed(2)} tomberait sous RATIO_MIN`);
});

// ── chemins de travail ──────────────────────────────────────────────────────

test("les chemins sont imposes par le backend, sous .career-ops-web", () => {
  const r = cheminsCvYaml("acme-data-engineer-12345678", "/racine");
  assert.equal(r.ok, true);
  assert.equal(r.chemins.dir, path.join("/racine", ".career-ops-web", "cv-yaml-tmp"));
  assert.ok(r.chemins.sortie.endsWith("acme-data-engineer-12345678.adapte.yml"));
});

test("une cle de run qui tenterait de sortir du dossier est refusee", () => {
  for (const mauvais of ["../../etc/passwd", "a/b", "", "  ", "x".repeat(81), "-debut-par-tiret"]) {
    assert.equal(cheminsCvYaml(mauvais, "/racine").ok, false, `aurait du refuser : ${JSON.stringify(mauvais)}`);
  }
});

// ── contexte + prompt ───────────────────────────────────────────────────────

test("le contexte borne la description et plafonne les mots-cles a 12", () => {
  const c = contexteCvYaml({
    offre: { title: "Data Engineer", company: "Acme", description: "x".repeat(9000) },
    motsCles: Array.from({ length: 20 }, (_, i) => `mot${i}`),
  });
  assert.equal(c.offre.description.length, 8000);
  assert.equal(c.mots_cles_ats_imposes.length, 12);
  assert.equal(c.offre.entreprise, "Acme");
});

test("les mots-cles vides laissent la regle ATS de modes/pdf.md decider", () => {
  assert.deepEqual(contexteCvYaml({ motsCles: ["", "  ", null] }).mots_cles_ats_imposes, []);
});

test("le prompt envoie l'agent lire modes/pdf.md et impose le chemin de sortie", () => {
  const { chemins } = cheminsCvYaml("run1", "/racine");
  const p = promptCvYaml({ chemins });
  assert.match(p, /modes\/pdf\.md/);
  assert.ok(p.includes(chemins.sortie));
  assert.ok(p.includes(chemins.original));
  assert.match(p, /NE SUPPRIME AUCUNE CLE/);
  assert.match(p, /NE MODIFIE JAMAIS un champ period/);
});

test("le prompt mandate la selection et chiffre le budget une page", () => {
  const { chemins } = cheminsCvYaml("run1", "/racine");
  const p = promptCvYaml({ chemins });
  assert.match(p, /SELECTION/);
  assert.ok(p.includes(String(BUDGET_CAR_RENDUS)), "le budget doit etre chiffre dans le prompt");
  assert.match(p, /RETIRER/);
  // La consigne qui a causé l'incident du 2026-08-10 ne doit jamais revenir :
  // elle demandait des longueurs équivalentes, donc interdisait de couper.
  assert.ok(!/Longueurs equivalentes/i.test(p), "l'ancienne consigne anti-coupe est revenue");
  assert.ok(!/plus ou moins 15 pour cent/i.test(p));
});
