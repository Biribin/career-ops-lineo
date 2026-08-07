import { test } from "node:test";
import assert from "node:assert/strict";
import { planAnnonce, texteDepuisHtml } from "../../src/lib/annonce-source.mjs";

// Ce que ces tests protègent : une annonce d'ATS moderne n'est PAS lisible en
// récupérant sa page — c'est du JavaScript. Elle l'est par l'API publique du
// tableau, celle que le scanner interroge déjà pour découvrir l'offre.

test("Ashby: reconnu, et l'offre est retrouvée par l'id présent dans jobUrl", () => {
  const p = planAnnonce("https://jobs.ashbyhq.com/andromeda/9a8cac0b-aec6-4df1-a03e-2cac4b3f9813");
  assert.equal(p.ats, "ashby");
  assert.equal(p.requete, "https://api.ashbyhq.com/posting-api/job-board/andromeda");

  const payload = {
    jobs: [
      { id: "autre", jobUrl: "https://jobs.ashbyhq.com/andromeda/zzz", descriptionPlain: "PAS CELLE-CI" },
      {
        id: "interne-different",
        jobUrl: "https://jobs.ashbyhq.com/andromeda/9a8cac0b-aec6-4df1-a03e-2cac4b3f9813",
        descriptionPlain: "FORWARD DEPLOYED ENGINEER - SRE",
      },
    ],
  };
  assert.match(p.extrait(payload), /FORWARD DEPLOYED ENGINEER/);
});

test("Ashby: une offre absente du tableau rend une chaîne vide, pas une autre offre", () => {
  const p = planAnnonce("https://jobs.ashbyhq.com/andromeda/introuvable");
  assert.equal(p.extrait({ jobs: [{ id: "x", jobUrl: "https://jobs.ashbyhq.com/andromeda/y", descriptionPlain: "AUTRE" }] }), "");
});

test("Ashby: un payload vide ou tordu ne jette pas", () => {
  const p = planAnnonce("https://jobs.ashbyhq.com/org/abc");
  assert.equal(p.extrait({}), "");
  assert.equal(p.extrait(null), "");
  assert.equal(p.extrait({ jobs: "pas un tableau" }), "");
});

test("Greenhouse: reconnu, endpoint par offre avec content=true", () => {
  const p = planAnnonce("https://job-boards.greenhouse.io/accela/jobs/8109291");
  assert.equal(p.ats, "greenhouse");
  assert.equal(p.requete, "https://boards-api.greenhouse.io/v1/boards/accela/jobs/8109291?content=true");
  assert.equal(p.extrait({ content: "&lt;p&gt;Bonjour&lt;/p&gt;" }), "&lt;p&gt;Bonjour&lt;/p&gt;");
});

test("Greenhouse: le domaine europeen est reconnu aussi", () => {
  const p = planAnnonce("https://job-boards.eu.greenhouse.io/acme/jobs/42");
  assert.equal(p.ats, "greenhouse");
  assert.match(p.requete, /boards\/acme\/jobs\/42/);
});

test("Lever: reconnu, l'offre est retrouvée par son id", () => {
  const p = planAnnonce("https://jobs.lever.co/acme/abc-123");
  assert.equal(p.ats, "lever");
  assert.equal(p.requete, "https://api.lever.co/v0/postings/acme?mode=json");
  assert.equal(p.extrait([{ id: "abc-123", descriptionPlain: "TEXTE" }]), "TEXTE");
});

test("Une URL hors ATS connu n'a pas de plan : l'appelant retombe sur la page", () => {
  assert.equal(planAnnonce("https://community.n8n.io/t/hiring-x/1"), null);
  assert.equal(planAnnonce("https://candidat.francetravail.fr/offres/recherche/detail/8813102"), null);
  assert.equal(planAnnonce(""), null);
  assert.equal(planAnnonce(null), null);
});

test("Un domaine qui ressemble à un ATS sans en être un n'est pas reconnu", () => {
  assert.equal(planAnnonce("https://jobs.ashbyhq.com.evil.test/org/id"), null);
  assert.equal(planAnnonce("https://faux-job-boards.greenhouse.io.evil/x/jobs/1"), null);
});

test("texteDepuisHtml: décode le HTML échappé de Greenhouse", () => {
  const t = texteDepuisHtml("&lt;p&gt;3 &amp; 5 ans d&#39;exp&lt;/p&gt;");
  assert.equal(t, "3 & 5 ans d'exp");
});

test("texteDepuisHtml: retire balises, scripts et styles", () => {
  const t = texteDepuisHtml("<style>a{}</style><script>x()</script><p>Bonjour <b>toi</b></p>");
  assert.equal(t, "Bonjour toi");
});

test("texteDepuisHtml: entrée vide ne jette pas", () => {
  assert.equal(texteDepuisHtml(null), "");
  assert.equal(texteDepuisHtml(""), "");
});
