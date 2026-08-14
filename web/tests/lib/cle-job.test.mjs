// Tests de l'identité de poste (cle-job.mjs).
//
// Ce que ces tests protègent : « Écarter » doit tenir même quand France Travail
// republie l'annonce sous un autre identifiant, SANS jamais masquer une offre
// que Linéo n'a pas vue. Les deux erreurs ne se valent pas — un doublon coûte un
// clic, une offre masquée à tort ne se voit jamais — donc les cas de refus de
// clé sont testés aussi sévèrement que les cas de regroupement.
//
// Les exemples viennent de la tournée réelle du 2026-08-14.
//
// Run:  node --test tests/lib/cle-job.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleJob, jetonsTitre, normalise, normaliseVille } from "../../src/lib/cle-job.mjs";

test("deux publications du meme poste donnent la MEME cle malgre l ordre des mots", () => {
  // Cas reel : « Développeur IA - Metz (H/F) » et « Développeur IA (H/F) - Metz ».
  const a = cleJob({ company: "Atos", title: "Développeur IA  - Metz (H/F)", location: "57 - Metz" });
  const b = cleJob({ company: "atos", title: "Développeur IA (H/F) - Metz", location: "57 - METZ" });
  assert.equal(a, b);
  assert.ok(a);
});

test("le numero de departement ne change pas la ville", () => {
  assert.equal(normaliseVille("59 - LILLE"), "lille");
  assert.equal(normaliseVille("Lille"), "lille");
  assert.equal(
    cleJob({ company: "Wemanity Paris", title: "Ingénieur IA / Data (H/F)", location: "59 - LILLE" }),
    cleJob({ company: "Wemanity Paris", title: "Ingénieur IA / Data (H/F)", location: "59 - Lille" }),
  );
});

test("les marqueurs de genre et la ponctuation ne comptent pas", () => {
  // Cas reel : « DATA SCIENTIST IA H/F/NB (H/F) » et « DATA SCIENTIST IA H/F/NB ».
  assert.equal(
    cleJob({ company: "NRJ GROUP", title: "DATA SCIENTIST IA H/F/NB (H/F)", location: "75 - PARIS" }),
    cleJob({ company: "NRJ GROUP", title: "DATA SCIENTIST IA H/F/NB", location: "75 - PARIS" }),
  );
  // Cas reel : deux espaces avant « (H/F) » suffisaient a creer deux postes.
  assert.equal(
    cleJob({ company: "DCARTE ENGINEERING SA", title: "Analyste décisionnel - Business Intelligence (H/F)", location: "France" }),
    cleJob({ company: "DCARTE ENGINEERING SA", title: "Analyste décisionnel - Business Intelligence   (H/F)", location: "France" }),
  );
});

test("SANS EMPLOYEUR, pas de cle : on ne regroupe pas ce qu'on ne sait pas reconnaitre", () => {
  // 332 des 1 150 offres du 2026-08-14 n'avaient aucun nom d'entreprise. Les
  // regrouper sur le seul intitule collerait ensemble trois « Chef de projet IA »
  // de trois employeurs differents, et un refus en masquerait deux jamais vues.
  assert.equal(cleJob({ company: "", title: "Chef de projet IA (H/F)", location: "75 - PARIS" }), null);
  assert.equal(cleJob({ company: "   ", title: "Chef de projet IA (H/F)" }), null);
  assert.equal(cleJob({ title: "Chef de projet IA (H/F)" }), null);
});

test("sans intitule exploitable, pas de cle non plus", () => {
  assert.equal(cleJob({ company: "Acme", title: "" }), null);
  // Un intitule qui ne contient QUE des mots vides ne distingue rien.
  assert.equal(cleJob({ company: "Acme", title: "(H/F)" }), null);
  assert.equal(cleJob({ company: "Acme", title: "de la" }), null);
});

test("deux VILLES differentes restent deux postes differents", () => {
  // C'est le garde-fou principal : une agence d'interim publie le meme intitule
  // dans dix villes. Fusionner ferait disparaitre Paris parce que Lyon a ete
  // ecartee.
  const lyon = cleJob({ company: "Adecco France", title: "Technicien de Maintenance (H/F)", location: "69 - LYON" });
  const paris = cleJob({ company: "Adecco France", title: "Technicien de Maintenance (H/F)", location: "75 - PARIS" });
  assert.notEqual(lyon, paris);
});

test("deux EMPLOYEURS differents restent deux postes differents", () => {
  assert.notEqual(
    cleJob({ company: "Atos", title: "Développeur IA (H/F)", location: "57 - Metz" }),
    cleJob({ company: "Capgemini", title: "Développeur IA (H/F)", location: "57 - Metz" }),
  );
});

test("un lieu absent ne fait pas echouer la cle", () => {
  const c = cleJob({ company: "Acme", title: "Data Engineer (H/F)" });
  assert.ok(c);
  assert.equal(c, cleJob({ company: "Acme", title: "Data Engineer (H/F)", location: "" }));
});

test("jetonsTitre trie et dedoublonne, normalise met en minuscules sans accents", () => {
  assert.equal(jetonsTitre("Data Data Engineer"), "data engineer");
  assert.equal(jetonsTitre("Ingénieur Systèmes"), "ingenieur systemes");
  assert.equal(normalise("  Créscendo  LYON "), "crescendo lyon");
  assert.equal(normalise(null), "");
  assert.equal(jetonsTitre(undefined), "");
});
