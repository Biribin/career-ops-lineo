// Tests de la détection de plafond et de la rotation des comptes.
//
// L'enjeu, en une phrase : sans cette détection, « You've hit your weekly limit »
// devient le corps d'une lettre de motivation, part dans le repo cv, est rendu en
// PDF et envoyé à un recruteur. Le CLI répond ce texte AVEC un code de sortie 0,
// donc rien ne signale l'anomalie en amont.
//
// Run:  node --test tests/lib/llm-quota.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { comptesDisponibles, estPlafond } from "../../src/lib/llm-quota.mjs";

test("le message réellement observé le 2026-08-06 est détecté", () => {
  assert.equal(estPlafond("You've hit your weekly limit · resets Aug 9, 8am (UTC)"), true);
});

test("les autres formulations de plafond sont détectées", () => {
  for (const m of [
    "You've reached your usage limit",
    "Usage limit reached",
    "Rate limited, try again later",
    "rate-limiting active",
    "Quota exceeded for this account",
    "429 Too Many Requests",
    "Your credit balance is too low",
    "Insufficient quota",
    "resets at 8am UTC",
  ]) {
    assert.equal(estPlafond(m), true, `non détecté : ${m}`);
  }
});

test("un plafond arrivé sur stderr est détecté aussi", () => {
  assert.equal(estPlafond("", "Error: 429 too many requests"), true);
});

test("une VRAIE réponse n'est pas prise pour un plafond", () => {
  for (const m of [
    "Madame, Monsieur, je me permets de revenir vers vous au sujet de ma candidature.",
    '{"jobs":[{"jobId":"A","score":80}]}',
    '{"adaptedYaml":"meta:\\n  locale: fr"}',
    "OK",
  ]) {
    assert.equal(estPlafond(m), false, `faux positif sur : ${m.slice(0, 40)}`);
  }
});

test("une lettre qui PARLE de rate limiting n'est pas confondue avec un plafond", () => {
  // Cas réaliste : Linéo travaille sur des API, une lettre peut légitimement
  // mentionner le sujet. La détection ne regarde que le début de la sortie,
  // c'est ce qui évite de jeter une lettre valide.
  const lettre =
    "Madame, Monsieur,\n\nVotre annonce mentionne la fiabilisation d'API. " +
    "J'ai notamment mis en place de la gestion de rate limiting et des quotas sur une centaine de workflows " +
    "en production, avec reprise automatique.\n\nCordialement,\nLinéo Biribin";
  assert.equal(estPlafond(lettre), false, "une lettre valide ne doit pas être jetée");
});

test("vide et null ne déclenchent rien", () => {
  assert.equal(estPlafond(""), false);
  assert.equal(estPlafond(null), false);
  assert.equal(estPlafond(undefined, undefined), false);
});

test("sans second jeton, un seul compte est proposé", () => {
  const c = comptesDisponibles({ CLAUDE_CODE_OAUTH_TOKEN: "peu-importe" });
  assert.equal(c.length, 1);
  assert.equal(c[0].id, "compte-1");
  assert.equal(c[0].varJeton, null, "le compte 1 ne surcharge rien");
});

test("les comptes supplémentaires sont ajoutés dans l'ordre", () => {
  const c = comptesDisponibles({
    CLAUDE_CODE_OAUTH_TOKEN: "a",
    CLAUDE_CODE_OAUTH_TOKEN_2: "b",
    CLAUDE_CODE_OAUTH_TOKEN_3: "c",
  });
  assert.deepEqual(c.map((x) => x.id), ["compte-1", "compte-2", "compte-3"]);
  assert.deepEqual(c.map((x) => x.varJeton), [null, "CLAUDE_CODE_OAUTH_TOKEN_2", "CLAUDE_CODE_OAUTH_TOKEN_3"]);
});

test("un jeton vide ou blanc n'est pas compté comme un compte", () => {
  const c = comptesDisponibles({ CLAUDE_CODE_OAUTH_TOKEN_2: "   ", CLAUDE_CODE_OAUTH_TOKEN_3: "" });
  assert.equal(c.length, 1, "un jeton vide dans Coolify ne doit pas créer un faux compte");
});

test("le module ne renvoie JAMAIS la valeur d'un jeton", () => {
  // Garde-fou anti-fuite : seuls des noms de variables sortent d'ici, donc aucun
  // secret ne peut atterrir dans un log ou un message d'erreur.
  const secret = "valeur-ultra-secrete-du-jeton";
  const c = comptesDisponibles({ CLAUDE_CODE_OAUTH_TOKEN_2: secret });
  const serialise = JSON.stringify(c);
  assert.ok(!serialise.includes(secret), "aucune valeur de jeton ne doit sortir du module");
  assert.ok(serialise.includes("CLAUDE_CODE_OAUTH_TOKEN_2"), "seul le nom de la variable sort");
});
