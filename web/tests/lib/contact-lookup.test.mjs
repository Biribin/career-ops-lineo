import { test } from "node:test";
import assert from "node:assert/strict";
import {
  choisitContact,
  classeCandidat,
  domaineExclu,
  extraitCourriels,
  localRecrutement,
  normaliseNom,
  parseCarnet,
} from "../../src/lib/contact-lookup.mjs";

// La règle que ces tests protègent : une adresse rendue par ce module a été lue
// littéralement quelque part. Rien n'est fabriqué à partir d'un domaine.

test("extraitCourriels: trouve, déduplique et plie la casse", () => {
  const t = "Écrivez à RH@Acme.fr ou rh@acme.fr, sinon jean.dupont@acme.fr.";
  assert.deepEqual(extraitCourriels(t).sort(), ["jean.dupont@acme.fr", "rh@acme.fr"]);
});

test("extraitCourriels: la ponctuation de fin n'entre pas dans le domaine", () => {
  assert.deepEqual(extraitCourriels("Contact : rh@acme.fr."), ["rh@acme.fr"]);
  assert.deepEqual(extraitCourriels("(rh@acme.fr)"), ["rh@acme.fr"]);
});

test("extraitCourriels: rien à trouver rend une liste vide, pas une erreur", () => {
  assert.deepEqual(extraitCourriels(""), []);
  assert.deepEqual(extraitCourriels(null), []);
  assert.deepEqual(extraitCourriels("aucune adresse ici"), []);
});

test("normaliseNom: plie accents, casse et ponctuation", () => {
  assert.equal(normaliseNom("Groupe Décathlon-France"), "groupedecathlonfrance");
  assert.equal(normaliseNom(null), "");
});

test("domaineExclu: les plateformes d'annonces et leurs sous-domaines", () => {
  assert.equal(domaineExclu("francetravail.fr"), true);
  assert.equal(domaineExclu("candidat.francetravail.fr"), true);
  assert.equal(domaineExclu("linkedin.com"), true);
  assert.equal(domaineExclu("acme.fr"), false);
  // Un domaine qui CONTIENT le nom d'une plateforme sans en être un.
  assert.equal(domaineExclu("monindeed.fr"), false);
});

test("localRecrutement: sur des morceaux, jamais au milieu d'un mot", () => {
  assert.equal(localRecrutement("recrutement"), true);
  assert.equal(localRecrutement("rh"), true);
  assert.equal(localRecrutement("jobs.fr"), true);
  assert.equal(localRecrutement("recrutement-france"), true);
  // « rh » au milieu d'un prénom ne doit pas passer pour du recrutement.
  assert.equal(localRecrutement("sarah"), false);
  assert.equal(localRecrutement("christophe"), false);
  assert.equal(localRecrutement("precrutement"), false);
});

test("classeCandidat: recrutement + domaine de l'entreprise = meilleur score", () => {
  const r = classeCandidat("recrutement@devoteam.com", "Devoteam");
  assert.equal(r.retenable, true);
  assert.equal(r.score, 100);
});

test("classeCandidat: une boîte non lue est écartée", () => {
  for (const a of ["noreply@acme.fr", "no-reply@acme.fr", "dpo@acme.fr", "postmaster@acme.fr"]) {
    const r = classeCandidat(a, "Acme");
    assert.equal(r.retenable, false, `${a} devrait être écartée`);
  }
});

test("classeCandidat: une adresse de plateforme est écartée même si elle dit recrutement", () => {
  const r = classeCandidat("recrutement@francetravail.fr", "Devoteam");
  assert.equal(r.retenable, false);
  assert.match(r.motif, /plateforme/);
});

test("classeCandidat: une adresse sans lien avec l'entreprise reste visible mais non envoyable", () => {
  const r = classeCandidat("jean@prestataire-web.fr", "Devoteam");
  assert.equal(r.retenable, false);
  assert.match(r.motif, /aucun lien/);
});

test("classeCandidat: le nom d'entreprise se retrouve dans les deux sens", () => {
  assert.equal(classeCandidat("contact@devoteam.com", "Groupe Devoteam Consulting").retenable, true);
  assert.equal(classeCandidat("contact@devoteam.com", "Devoteam").retenable, true);
});

test("parseCarnet: lit nom, entreprise, type et courriel, ignore le reste", () => {
  const tsv = [
    "# name\tcompany\ttype\ttitle\tphone\temail\tlinkedin\ttracker\tnotes",
    "",
    "Marie Curie\tAcme\trecruiter\tTalent\t0102030405\tmarie@acme.fr\tin/mcurie\t12\tvue au forum",
    "Trop\tCourt",
    "\tSansNom\trecruiter\t\t\tx@y.fr",
    "Paul Sans Mail\tGlobex\tpeer\tDev\t\t\t\t-\t",
  ].join("\n");
  const r = parseCarnet(tsv);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { name: "Marie Curie", company: "Acme", type: "recruiter", email: "marie@acme.fr" });
  assert.equal(r[1].email, "");
});

test("parseCarnet: une entrée absente ou vide ne jette pas", () => {
  assert.deepEqual(parseCarnet(""), []);
  assert.deepEqual(parseCarnet(null), []);
});

test("choisitContact: le carnet d'adresses passe avant l'annonce", () => {
  const r = choisitContact({
    carnet: [{ name: "Marie Curie", company: "Acme", type: "recruiter", email: "marie@acme.fr" }],
    textes: ["écrivez à recrutement@acme.fr"],
    entreprise: "Acme",
  });
  assert.equal(r.courriel, "marie@acme.fr");
  assert.equal(r.source, "carnet");
  assert.equal(r.confiance, "haute");
});

test("choisitContact: dans le carnet, un recruteur passe avant un pair", () => {
  const r = choisitContact({
    carnet: [
      { name: "Pair", company: "Acme", type: "peer", email: "pair@acme.fr" },
      { name: "Recruteuse", company: "Acme", type: "recruiter", email: "recruteuse@acme.fr" },
    ],
    entreprise: "Acme",
  });
  assert.equal(r.courriel, "recruteuse@acme.fr");
});

test("choisitContact: un contact d'une AUTRE entreprise n'est jamais utilisé", () => {
  const r = choisitContact({
    carnet: [{ name: "Marie", company: "Globex", type: "recruiter", email: "marie@globex.fr" }],
    textes: [],
    entreprise: "Acme",
  });
  assert.equal(r.courriel, null);
});

test("choisitContact: sans rien trouver, rend null — le dépôt manuel reprend la main", () => {
  const r = choisitContact({ textes: ["Postulez sur notre portail."], entreprise: "Devoteam" });
  assert.equal(r.courriel, null);
  assert.equal(r.confiance, "aucune");
  assert.deepEqual(r.candidats, []);
});

test("choisitContact: ne fabrique JAMAIS une adresse à partir du domaine", () => {
  // Le texte nomme le site de l'entreprise mais aucune adresse : la tentation
  // serait de composer recrutement@devoteam.com. Interdit.
  const r = choisitContact({
    textes: ["Retrouvez-nous sur https://www.devoteam.com/carrieres"],
    entreprise: "Devoteam",
  });
  assert.equal(r.courriel, null);
});

test("choisitContact: entre plusieurs adresses, la mieux notée gagne", () => {
  const r = choisitContact({
    textes: ["webmaster@devoteam.com, jean.dupont@devoteam.com, recrutement@devoteam.com"],
    entreprise: "Devoteam",
  });
  assert.equal(r.courriel, "recrutement@devoteam.com");
  assert.equal(r.confiance, "haute");
  assert.equal(r.source, "annonce");
});

test("choisitContact: les candidats écartés restent visibles pour Linéo", () => {
  const r = choisitContact({
    textes: ["noreply@acme.fr et jean@ailleurs.fr"],
    entreprise: "Acme",
  });
  assert.equal(r.courriel, null);
  assert.equal(r.candidats.length, 2);
  assert.ok(r.candidats.every((c) => c.retenable === false));
});

test("choisitContact: une adresse trouvée hors domaine entreprise n'est pas envoyée", () => {
  // Cas réel : une annonce hébergée par un prestataire dont l'adresse traîne
  // dans le pied de page. L'envoi automatique serait une erreur.
  const r = choisitContact({
    textes: ["Site réalisé par contact@agence-web.fr"],
    entreprise: "Devoteam",
  });
  assert.equal(r.courriel, null);
});
