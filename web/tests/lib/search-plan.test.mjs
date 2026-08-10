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
  const { urls } = urlsFranceTravail({ motsCles: ["ingénieur automatisation IA"], communes: ["75056"], distance: 20 });
  assert.equal(urls.length, 1);
  const u = new URL(urls[0]);
  assert.equal(`${u.origin}${u.pathname}`, BASE_FT);
  assert.equal(u.searchParams.get("commune"), "75056");
  assert.equal(u.searchParams.get("distance"), "20");
  assert.equal(u.searchParams.get("motsCles"), "ingénieur automatisation IA");
  assert.equal(u.searchParams.get("range"), "0-149");
});

test("le rayon part sous le nom « distance », le seul que l'API honore", () => {
  // Régression du 2026-08-10. Mesuré contre l'API, requête « automatisation »
  // autour de Paris : rayon=30 et rayon=100 rendent 14 offres, exactement comme
  // distance=10 (le défaut), pendant que distance=100 en rend 29. France Travail
  // ne rejette pas les paramètres inconnus : `rayon` était donc ignoré EN
  // SILENCE, et la tournée cherchait dans 10 km en croyant en faire 30.
  const { urls } = urlsFranceTravail({ motsCles: ["n8n"], communes: ["75056"], distance: 100 });
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get("distance"), "100");
  assert.equal(u.searchParams.get("rayon"), null, "`rayon` est ignoré par l'API : ne jamais l'émettre");
});

test("l'ancien nom `rayon` en config reste honoré, sous le bon paramètre", () => {
  // Un portals.yml pas encore renommé ne doit pas perdre silencieusement son
  // rayon — il doit juste partir sous le nom que l'API comprend.
  const { urls } = urlsFranceTravail({ motsCles: ["n8n"], communes: ["75056"], rayon: 45 });
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get("distance"), "45");
  assert.equal(u.searchParams.get("rayon"), null);
});

test("sans commune : recherche France entière, pas de distance parasite", () => {
  const { urls } = urlsFranceTravail({ motsCles: ["n8n"], communes: [] });
  const u = new URL(urls[0]);
  assert.equal(u.searchParams.get("commune"), null);
  assert.equal(u.searchParams.get("distance"), null, "une distance sans commune n'a pas de sens");
  assert.equal(u.searchParams.get("rayon"), null);
  assert.equal(u.searchParams.get("motsCles"), "n8n");
});

test("les continents ajoutent des requêtes hors France, APRÈS la France", () => {
  // L'ordre compte : prepareLot tronque dans l'ordre d'arrivée, et le corpus
  // international de France Travail est à 84 % luxembourgeois (1 423 offres sur
  // 1 691, mesuré le 2026-08-10). L'Europe en tête ferait manger les places du
  // lot par du Luxembourg avant que la France n'arrive.
  const { urls } = urlsFranceTravail({ motsCles: ["n8n", "RPA"], communes: [], continents: ["991"], max: 99 });
  assert.equal(urls.length, 4, "2 mots-clés × (France + Europe)");
  const zones = urls.map((u) => new URL(u).searchParams.get("paysContinent"));
  assert.deepEqual(zones, [null, null, "991", "991"], "la France passe en premier");
  const euro = new URL(urls[2]);
  assert.equal(euro.searchParams.get("motsCles"), "n8n");
  assert.equal(euro.searchParams.get("commune"), null, "hors France : aucune commune");
});

test("un continent vide ou blanc est ignoré au lieu de produire une URL cassée", () => {
  const { urls } = urlsFranceTravail({ motsCles: ["n8n"], communes: [], continents: ["", "  ", null], max: 99 });
  assert.equal(urls.length, 1, "seule la requête France subsiste");
  assert.equal(new URL(urls[0]).searchParams.get("paysContinent"), null);
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
    ft: { mots_cles: ["ingénieur automatisation IA"], communes: ["75056"], distance: 20, max_urls: 8 },
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
