import { test } from "node:test";
import assert from "node:assert/strict";
import { chargeWf2, explicationEchecWf2, urlWebhookWf2 } from "../../src/lib/candidature-n8n.mjs";
import { MAX_ANNONCE } from "../../src/lib/pipeline-fit.mjs";
import { urlSure } from "../../src/lib/annonce-fetch.mjs";

// Ce que ces tests protègent : la charge envoyée au workflow n8n « 2. Generation
// lettre + CV ». Son nœud d'entrée JETTE si `title` et `description` sont tous
// deux vides, et la lettre est rédigée à partir de `description` — donc une
// charge mal formée se solde soit par une exécution morte, soit par une lettre
// creuse envoyée à un recruteur.

const offre = {
  url: "https://jobs.ashbyhq.com/acme/abc-123",
  company: "Acme",
  role: "Développeur IA",
  location: "Marseille",
};

test("la charge porte l'intitulé, l'entreprise et le texte de l'annonce", () => {
  const c = chargeWf2({ offre, texteAnnonce: "Poste de développeur IA. " + "x".repeat(500), quand: "2026-08-12T10:00:00.000Z" });
  assert.equal(c.mode, "nouvelle");
  assert.equal(c.declenche_par, "career-ops-web");
  assert.equal(c.at, "2026-08-12T10:00:00.000Z");
  assert.equal(c.job.title, "Développeur IA");
  assert.equal(c.job.company, "Acme");
  assert.equal(c.job.location, "Marseille");
  assert.equal(c.job.url, "https://jobs.ashbyhq.com/acme/abc-123");
  assert.match(String(c.job.description), /^Poste de développeur IA\./);
});

test("le texte de l'annonce est borné", () => {
  // Une annonce peut faire 800 000 caractères (la borne de lecture). La laisser
  // passer entière ferait traverser un webhook PUIS un modèle à du pied de page.
  const c = chargeWf2({ offre, texteAnnonce: "y".repeat(MAX_ANNONCE * 3), quand: "2026-08-12T10:00:00.000Z" });
  assert.equal(String(c.job.description).length, MAX_ANNONCE);
});

test("rien n'est inventé : ni note, ni contact, ni raison de match", () => {
  const c = chargeWf2({ offre, texteAnnonce: "z".repeat(300), quand: "2026-08-12T10:00:00.000Z" });
  assert.equal(c.job.score, null);
  assert.equal(c.job.contactEmail, "");
  assert.equal(c.job.whyMatch, "");
  // jobId vide EXPRÈS : le workflow nomme alors la fiche d'après
  // entreprise + poste, au lieu d'un identifiant opaque inventé ici.
  assert.equal(c.job.jobId, "");
});

test("une offre trouée ne produit ni undefined ni [object Object]", () => {
  const c = chargeWf2({ offre: {}, texteAnnonce: "", quand: "2026-08-12T10:00:00.000Z" });
  for (const cle of ["title", "company", "location", "url", "description"]) {
    assert.equal(typeof c.job[cle], "string", cle);
  }
  // Le workflow jettera « offre inexploitable » — c'est le bon comportement, et
  // l'appelant refuse déjà avant d'arriver là (annonce < 200 caractères).
  assert.equal(c.job.title, "");
  assert.equal(c.job.description, "");
});

test("le webhook visé est celui du workflow 2, base configurable", () => {
  assert.equal(urlWebhookWf2(undefined), "https://n8n.balzac-info.online/webhook/candidature-generer");
  assert.equal(urlWebhookWf2("https://n8n.exemple.fr/"), "https://n8n.exemple.fr/webhook/candidature-generer");
  assert.equal(urlWebhookWf2("  https://n8n.exemple.fr///  "), "https://n8n.exemple.fr/webhook/candidature-generer");
});

test("un 404 de n8n est traduit en « workflow désactivé ? »", () => {
  // Un nœud Webhook ne répond qu'en production. Sans ce message, « le bouton ne
  // fait rien » envoie chercher du côté du code de l'app.
  assert.match(explicationEchecWf2(404), /ACTIVÉ/);
  assert.equal(explicationEchecWf2(500), "n8n a répondu 500");
});

test("le garde-fou d'URL refuse tout ce qui n'est pas une annonce publique", () => {
  // Déplacé depuis api/pipeline/evaluate : cette protection SSRF est désormais
  // partagée par la lecture d'annonce des deux routes, donc elle est testée une
  // fois pour les deux.
  assert.ok(urlSure("https://jobs.ashbyhq.com/acme/abc"));
  assert.equal(urlSure("http://localhost:3000/x"), null);
  assert.equal(urlSure("http://127.0.0.1/x"), null);
  assert.equal(urlSure("http://192.168.1.10/x"), null);
  assert.equal(urlSure("http://n8n.internal/x"), null);
  assert.equal(urlSure("http://truc.local/x"), null);
  assert.equal(urlSure("http://[::1]/x"), null);
  assert.equal(urlSure("file:///etc/passwd"), null);
  assert.equal(urlSure("pas une url"), null);
});
