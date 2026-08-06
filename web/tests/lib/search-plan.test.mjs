// Tests du plan de recherche France Travail (search-plan.mjs).
//
// Ce module remplace deux agents LLM du workflow n8n. Il doit donc être au moins
// aussi bon qu'eux sur le seul critère qui compte : produire des requêtes qui
// ramènent des offres françaises pertinentes. D'où les tests sur la projection
// ATS → France Travail, qui est l'endroit où une fusion naïve détruirait le
// résultat.
//
// Run:  node --test tests/lib/search-plan.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BASE_FT,
  motsClesFranceTravail,
  planRecherche,
  urlsFranceTravail,
} from "../../src/lib/search-plan.mjs";

// Les 42 vrais mots-clés de Linéo, tels qu'ils sont dans portals.yml.
const POSITIVE_REEL = [
  "n8n", "Automation", "Automatisation", "Workflow", "Workflow Automation",
  "Process Automation", "Business Automation", "Hyperautomation", "RPA", "UiPath",
  "Low-Code", "No-Code", "AI", "ML", "LLM", "Agent", "Agentic", "GenAI",
  "Generative AI", "AI Engineer", "AI Automation", "AI Workflow", "LLM Engineer",
  "LangChain", "LangGraph", "CrewAI", "AutoGen", "Intelligence Artificielle",
  "Ingenieur IA", "Ingénieur IA", "Developpeur IA", "Développeur IA",
  "Ingenieur Automatisation", "Ingénieur Automatisation", "Solutions Engineer",
  "Solutions Architect", "Technical Consultant", "Integration Engineer",
  "Forward Deployed", "Deployed Engineer", "Customer Engineer", "Platform Engineer",
];

test("le jargon ATS américain est écarté, pas envoyé à France Travail", () => {
  const { retenus, ecartes } = motsClesFranceTravail(POSITIVE_REEL);
  const bas = retenus.map((r) => r.toLowerCase());
  for (const inutile of ["forward deployed", "deployed engineer", "customer engineer", "hyperautomation"]) {
    assert.ok(!bas.includes(inutile), `${inutile} ne doit pas partir sur France Travail`);
  }
  assert.ok(ecartes.length > 0, "et on doit pouvoir dire lesquels ont été écartés");
});

test("les termes trop génériques seuls sont écartés (ils ramènent du bruit)", () => {
  const { retenus } = motsClesFranceTravail(POSITIVE_REEL);
  const bas = retenus.map((r) => r.toLowerCase());
  for (const gen of ["ai", "ml", "agent", "workflow"]) {
    assert.ok(!bas.includes(gen), `« ${gen} » seul ne doit pas être une requête`);
  }
  // mais les expressions qui les contiennent restent
  assert.ok(bas.some((r) => r.includes("automatisation")), "les expressions composées restent");
});

test("l'anglais traduisible est traduit, et la traduction est traçable", () => {
  const { retenus, traduits } = motsClesFranceTravail(["AI Engineer", "Integration Engineer"]);
  assert.deepEqual(retenus, ["ingénieur intelligence artificielle", "ingénieur intégration"]);
  assert.deepEqual(traduits, [
    { de: "AI Engineer", vers: "ingénieur intelligence artificielle" },
    { de: "Integration Engineer", vers: "ingénieur intégration" },
  ]);
});

test("les termes qui marchent dans les deux langues passent tels quels", () => {
  const { retenus } = motsClesFranceTravail(["n8n", "RPA", "UiPath", "Intelligence Artificielle"]);
  assert.deepEqual(retenus, ["n8n", "RPA", "UiPath", "Intelligence Artificielle"]);
});

test("les doublons accent/casse sont fusionnés — sinon on paye deux fois la même requête", () => {
  const { retenus } = motsClesFranceTravail(["Ingenieur IA", "Ingénieur IA", "ingenieur ia"]);
  assert.equal(retenus.length, 1, `attendu 1, obtenu ${JSON.stringify(retenus)}`);
});

test("les requêtes écrites à la main dans la config passent en TÊTE", () => {
  const { retenus } = motsClesFranceTravail(POSITIVE_REEL, ["ingénieur automatisation IA"]);
  assert.equal(retenus[0], "ingénieur automatisation IA", "la config de Linéo doit survivre au plafond");
});

test("une requête de config qui double un mot-clé ne le duplique pas", () => {
  const { retenus } = motsClesFranceTravail(["n8n", "RPA"], ["n8n"]);
  assert.equal(retenus.filter((r) => r.toLowerCase() === "n8n").length, 1);
  assert.equal(retenus[0], "n8n");
});

test("les URLs ont le format exact que le workflow consommait déjà", () => {
  const { urls } = urlsFranceTravail({ motsCles: ["ingénieur automatisation IA"], communes: ["75056"], rayon: 20 });
  assert.equal(urls.length, 1);
  const u = new URL(urls[0]);
  assert.equal(`${u.origin}${u.pathname}`, BASE_FT);
  assert.equal(u.searchParams.get("commune"), "75056");
  assert.equal(u.searchParams.get("rayon"), "20");
  assert.equal(u.searchParams.get("motsCles"), "ingénieur automatisation IA");
  assert.equal(u.searchParams.get("range"), "0-149");
});

test("sans commune : recherche France entière, pas de rayon parasite", () => {
  const { urls } = urlsFranceTravail({ motsCles: ["n8n"], communes: [] });
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get("commune"), null);
  assert.equal(u.searchParams.get("rayon"), null, "un rayon sans commune n'a pas de sens");
  assert.equal(u.searchParams.get("motsCles"), "n8n");
});

test("plusieurs communes = une URL par couple (mot-clé, commune)", () => {
  const { urls } = urlsFranceTravail({ motsCles: ["n8n", "RPA"], communes: ["75056", "92050"], max: 99 });
  assert.equal(urls.length, 4);
});

test("le plafond d'URLs est appliqué ET annoncé", () => {
  const { urls, tronquees } = urlsFranceTravail({ motsCles: POSITIVE_REEL, max: 5 });
  assert.equal(urls.length, 5);
  assert.ok(tronquees > 0, "on doit savoir combien de requêtes n'ont pas été lancées");
});

test("planRecherche rend un plan complet et auto-descriptif", () => {
  const plan = planRecherche({
    filtres: {
      positive: POSITIVE_REEL,
      negative: [],
      allow: ["France", "Paris"],
      block: [],
      alwaysAllow: ["Remote", "Télétravail"],
    },
    ft: { mots_cles: ["ingénieur automatisation IA"], communes: ["75056"], rayon: 20, max_urls: 8 },
  });
  assert.equal(plan.source, "portals.yml");
  assert.equal(plan.urls.length, 8);
  assert.ok(plan.motsCles.length >= 8);
  assert.equal(plan.motsCles[0], "ingénieur automatisation IA");
  assert.ok(plan.ecartes.length > 0, "le plan dit ce qu'il a écarté");
  assert.ok(plan.traduits.length > 0, "et ce qu'il a traduit");
  // les filtres partent avec le plan : n8n doit trier avec les MÊMES règles
  assert.deepEqual(plan.filtreLieu.alwaysAllow, ["Remote", "Télétravail"]);
  assert.deepEqual(plan.filtreTitre.positive, POSITIVE_REEL);
  for (const u of plan.urls) assert.ok(u.startsWith(BASE_FT), "toutes les URLs visent l'API FT");
});

test("aucun mot-clé en config et aucun positive : plan vide, pas de crash", () => {
  const plan = planRecherche({ filtres: { positive: [], negative: [], allow: [], block: [], alwaysAllow: [] } });
  assert.deepEqual(plan.urls, []);
  assert.deepEqual(plan.motsCles, []);
});
