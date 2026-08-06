// Tests du skill « adapter le CV YAML » (cv-adapt.mjs).
//
// Les quatre refus testés ici ne sont pas théoriques : ce sont les défauts
// réellement constatés les 2026-08-05/06 quand l'adaptation vivait dans un
// prompt d'agent LangChain à l'intérieur de n8n, sans aucun test.
//   - clé `keywords` supprimée   -> section ATS absente du PDF (run 958225) ;
//   - `summary` aplati en une ligne avec un « : » -> YAML invalide, Action en
//     échec, zéro PDF (run 958225) ;
//   - « depuis deux ans » alors que le poste a commencé en mars 2026 ;
//   - tirets cadratin / markdown dans un document candidat.
//
// Run:  node --test tests/lib/cv-adapt.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  cheminsCvYaml,
  clesTopNiveau,
  contexteCvYaml,
  dureeInventee,
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
