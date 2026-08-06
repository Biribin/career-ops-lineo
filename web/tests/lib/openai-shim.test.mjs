// Tests du shim OpenAI Chat Completions (openai-shim.mjs).
//
// Ce shim porte les 4 agents restants du workflow n8n. S'il déforme un prompt ou
// rend une enveloppe que le client OpenAI de LangChain ne sait pas lire, les
// agents échouent silencieusement — et une lettre de candidature vide partirait
// chez un recruteur. D'où des tests sur les deux bords : ce qui entre (aplatissage
// des messages, y compris l'historique multi-tours de la mémoire n8n) et ce qui
// sort (enveloppe + nettoyage des blocs de code).
//
// Run:  node --test tests/lib/openai-shim.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  contenuEnTexte,
  nettoieSortie,
  promptDepuisMessages,
  reponseChatCompletions,
} from "../../src/lib/openai-shim.mjs";

test("system + user sont aplatis dans l'ordre", () => {
  const p = promptDepuisMessages([
    { role: "system", content: "Tu es un rédacteur de CV." },
    { role: "user", content: "Adapte ce CV." },
  ]);
  assert.equal(p, "Tu es un rédacteur de CV.\n\nAdapte ce CV.");
});

test("l'historique multi-tours garde qui a dit quoi", () => {
  const p = promptDepuisMessages([
    { role: "system", content: "S" },
    { role: "user", content: "U1" },
    { role: "assistant", content: "A1" },
    { role: "user", content: "U2" },
  ]);
  assert.ok(p.includes("[réponse précédente]\nA1"), "la réponse de l'assistant doit être étiquetée");
  assert.ok(p.indexOf("U1") < p.indexOf("A1"), "l'ordre chronologique est conservé");
  assert.ok(p.indexOf("A1") < p.indexOf("U2"));
});

test("le content en parts typées (format multimodal) est recollé", () => {
  const p = promptDepuisMessages([
    { role: "user", content: [{ type: "text", text: "ligne 1" }, { type: "text", text: "ligne 2" }] },
  ]);
  assert.equal(p, "ligne 1\nligne 2");
});

test("les messages vides ou mal formés sont ignorés, sans crash", () => {
  assert.equal(promptDepuisMessages([null, {}, { role: "user" }, { role: "user", content: "" }]), "");
  assert.equal(promptDepuisMessages(undefined), "");
  assert.equal(promptDepuisMessages("pas un tableau"), "");
});

test("contenuEnTexte couvre chaîne, parts et valeurs inutilisables", () => {
  assert.equal(contenuEnTexte("  x  "), "x");
  assert.equal(contenuEnTexte([{ text: "a" }, "b"]), "a\nb");
  assert.equal(contenuEnTexte(42), "");
  assert.equal(contenuEnTexte(null), "");
});

test("l'enveloppe a les champs que le client OpenAI lit vraiment", () => {
  const r = reponseChatCompletions({ texte: "bonjour", model: "career-ops-cli/claude", cree: 1700000000 });
  assert.equal(r.object, "chat.completion");
  assert.equal(r.choices.length, 1);
  assert.equal(r.choices[0].message.role, "assistant");
  assert.equal(r.choices[0].message.content, "bonjour");
  assert.equal(r.choices[0].finish_reason, "stop");
  assert.equal(r.choices[0].index, 0);
  assert.equal(r.model, "career-ops-cli/claude");
  assert.equal(r.created, 1700000000);
  // usage à zéro et non absent : un client qui l'additionne ne doit pas casser,
  // et zéro est la vérité (aucun token facturé).
  assert.deepEqual(r.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
});

test("le bloc de code entourant tout le JSON est retiré", () => {
  assert.equal(nettoieSortie('```json\n{"a":1}\n```'), '{"a":1}');
  assert.equal(nettoieSortie('```\n{"a":1}\n```'), '{"a":1}');
  assert.equal(nettoieSortie('  ```json\n{"a":1}\n```  '), '{"a":1}');
});

test("un bloc de code AU MILIEU du texte n'est pas touché", () => {
  // Ici on ne doit rien casser : le parser de n8n sait extraire du JSON noyé,
  // et retirer des backticks internes changerait le contenu.
  const t = 'Voici le résultat :\n```json\n{"a":1}\n```\net voilà.';
  assert.equal(nettoieSortie(t), t);
});

test("du JSON nu passe intact", () => {
  assert.equal(nettoieSortie('{"adaptedYaml":"meta:\\n  locale: fr"}'), '{"adaptedYaml":"meta:\\n  locale: fr"}');
});

test("nettoieSortie tolère null et vide", () => {
  assert.equal(nettoieSortie(null), "");
  assert.equal(nettoieSortie(undefined), "");
  assert.equal(nettoieSortie("   "), "");
});
