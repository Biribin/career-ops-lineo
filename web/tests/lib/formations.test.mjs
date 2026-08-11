import test from "node:test";
import assert from "node:assert/strict";
import { formationsPourFiche, CATALOGUE, MAX_CONSEILS } from "../../src/lib/formations.mjs";

test("l'offre Nutripure qui exige Python sort Python en premier conseil", () => {
  const r = formationsPourFiche({
    poste: "Builder IA et automatisation",
    pourquoi_ca_matche: "Python capable de concevoir et maintenir du code propre et teste (Flask, FastAPI). SQL sur un warehouse cloud. Outils internes et dashboards operationnels.",
  });
  assert.equal(r.aFaire[0].id, "python-fastapi");
  assert.equal(r.aucunSignal, false);
});

test("une exigence dure passe devant un « plus » qui touche plus de mots-cles", () => {
  // Le vrai texte Nutripure : Streamlit et ses synonymes sont cites 4 fois
  // (streamlit, outils internes, dashboards, interfaces web), Python 3 fois
  // (python, flask, fastapi). Python est pourtant l'exigence dure, Streamlit « un
  // plus » : compter les mots-cles classait l'accessoire en premier.
  const r = formationsPourFiche({
    poste: "Builder IA et automatisation",
    pourquoi_ca_matche:
      "Python capable de concevoir et maintenir du code propre et teste (Flask, FastAPI). Outils internes, interfaces web legeres, dashboards operationnels. Streamlit est un plus.",
  });
  const ids = r.aFaire.map((f) => f.id);
  assert.equal(ids[0], "python-fastapi", `attendu python en tete, obtenu ${ids.join(", ")}`);
  assert.equal(ids[1], "streamlit");
});

test("une offre RPA UiPath conseille UiPath, jamais la n8n Academy", () => {
  const r = formationsPourFiche({
    poste: "Developpeur RPA UiPath / Camunda H/F",
    pourquoi_ca_matche: "Automatisation de processus, UiPath, orchestration n8n en plus",
  });
  const ids = r.aFaire.map((f) => f.id);
  assert.ok(ids.includes("uipath"), `attendu uipath dans ${ids.join(", ")}`);
  assert.ok(!ids.includes("n8n-academy"), "n8n est deja acquis, il ne doit jamais etre conseille");
});

test("ce qui est deja en production sort dans dejaAcquis avec sa preuve, pas dans aFaire", () => {
  const r = formationsPourFiche({
    poste: "Ingenieur MCP et RAG",
    pourquoi_ca_matche: "serveurs MCP, base vectorielle Pinecone, Docker",
  });
  const acquis = r.dejaAcquis.map((f) => f.id);
  assert.ok(acquis.includes("hf-mcp"));
  assert.ok(acquis.includes("rag-llamaindex"));
  assert.ok(acquis.includes("docker"));
  assert.equal(r.aFaire.length, 0, "aucune formation a faire ici");
  // La preuve est ce qu'il dira a l'oral : elle ne doit jamais etre vide.
  for (const f of r.dejaAcquis) assert.ok(f.preuve && f.preuve.length > 10, `preuve manquante pour ${f.id}`);
});

test("une offre hors sujet ne conseille rien plutot que d'inventer un plan", () => {
  const r = formationsPourFiche({
    poste: "Chauffeur livreur permis B",
    pourquoi_ca_matche: "tournee regionale, port de charges",
  });
  assert.equal(r.aFaire.length, 0);
  assert.equal(r.dejaAcquis.length, 0);
  assert.equal(r.aucunSignal, true);
});

test("aucunSignal reste faux quand l'offre ne tombe que sur de l'acquis", () => {
  const r = formationsPourFiche({ poste: "Consultant n8n" });
  assert.equal(r.aFaire.length, 0);
  assert.equal(r.dejaAcquis.length, 1);
  assert.equal(r.aucunSignal, false, "il y a bien un signal, il n'appelle juste aucune formation");
});

test("les conseils sont plafonnes", () => {
  const r = formationsPourFiche({
    poste: "Python Streamlit SQL BigQuery AWS UiPath LangGraph Copilot Studio Make",
  });
  assert.ok(r.aFaire.length <= MAX_CONSEILS, `${r.aFaire.length} conseils, plafond ${MAX_CONSEILS}`);
});

test("l'intitule du poste pese plus que le corps de la lettre", () => {
  // Streamlit dans le titre contre Make cite deux fois dans le corps : le titre gagne.
  const r = formationsPourFiche({
    poste: "Developpeur Streamlit",
    apercu_lettre: "j'ai utilise Make. Make est un bon outil.",
  });
  assert.equal(r.aFaire[0].id, "streamlit");
});

test("les accents et la casse de l'offre ne changent rien", () => {
  const avec = formationsPourFiche({ poste: "Ingénieur Données, SQL & Entrepôt" });
  const sans = formationsPourFiche({ poste: "ingenieur donnees, sql et entrepot" });
  assert.deepEqual(
    avec.aFaire.map((f) => f.id),
    sans.aFaire.map((f) => f.id),
  );
  assert.ok(avec.aFaire.some((f) => f.id === "sql-entrepot"));
});

test("mots_cles_source est ignore : son jeton parasite ne doit rien declencher", () => {
  // Sur les fiches reelles il vaut « api » ou « mode ». S'il etait lu, « api »
  // ferait remonter Python sur n'importe quelle offre.
  const r = formationsPourFiche({ poste: "Chauffeur livreur", mots_cles_source: "api" });
  assert.equal(r.aucunSignal, true);
  assert.equal(r.aFaire.length, 0);
});

test("une fiche vide ou incomplete ne fait pas planter le calcul", () => {
  for (const f of [undefined, null, {}, { poste: null }, { arguments_cles: "" }]) {
    const r = formationsPourFiche(f);
    assert.equal(r.aFaire.length, 0);
    assert.equal(r.aucunSignal, true);
  }
});

test("arguments_cles est accepte en tableau comme en chaine", () => {
  const tableau = formationsPourFiche({ poste: "Builder", arguments_cles: ["maitrise de Streamlit"] });
  const chaine = formationsPourFiche({ poste: "Builder", arguments_cles: "maitrise de Streamlit" });
  assert.equal(tableau.aFaire[0].id, "streamlit");
  assert.deepEqual(
    tableau.aFaire.map((f) => f.id),
    chaine.aFaire.map((f) => f.id),
  );
});

test("le catalogue est coherent : tout acquis a une preuve, tout a-faire a un effort", () => {
  for (const f of CATALOGUE) {
    assert.ok(f.id && f.libelle && f.declencheurs?.length, `entree incomplete : ${f.id}`);
    if (f.acquis) assert.ok(f.preuve, `${f.id} est acquis mais sans preuve a citer a l'oral`);
    else assert.ok(f.effort && f.org, `${f.id} est a faire mais sans effort ni organisme`);
  }
  const ids = CATALOGUE.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "identifiants dupliques dans le catalogue");
});
