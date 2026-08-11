// Tests de l'ajout au reseau public des ATS (portails-suivies.mjs).
//
// CE QUI SE JOUE ICI : portals.yml est ecrit a la main et fait 2000 lignes dont
// l'essentiel est du COMMENTAIRE — la strategie de scan, les pieges d'URL, le
// classement par secteur. Ajouter une entreprise depuis l'interface ne doit pas
// couter ce fichier. Un yaml.load/yaml.dump rendrait un document valide et
// illisible ; on verifie donc que l'insertion est un DECOUPAGE DE TEXTE, que le
// reste du fichier ressort octet pour octet, et qu'un nom venu d'une annonce
// tierce ne peut pas casser le document.
//
// Run:  node --test tests/lib/portails-suivies.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import yaml from "js-yaml";
import {
  entreeExistante,
  insererDansTrackedCompanies,
  lireEntreprisesSuivies,
  normaliserNom,
  rendreEntree,
  scalaireYaml,
  urlYaml,
} from "../../src/lib/portails-suivies.mjs";

const PORTALS = `# Portal Scanner Configuration
# Chaque entreprise DOIT avoir careers_url.

title_filter:
  positive:
    - "automation engineer"

tracked_companies:

  # -- AI Labs --

  - name: Anthropic
    careers_url: https://job-boards.greenhouse.io/anthropic
    api: https://boards-api.greenhouse.io/v1/boards/anthropic/jobs
    enabled: true

search_queries:
  - "site:example.com"
`;

test("l'entreprise ajoutee est lisible par le scanner", () => {
  const apres = insererDansTrackedCompanies(PORTALS, [
    rendreEntree({ name: "Decathlon", careers_url: "https://jobs.lever.co/decathlon", enabled: true }),
  ]);
  const doc = yaml.load(apres);
  assert.equal(doc.tracked_companies.length, 2);
  assert.deepEqual(doc.tracked_companies[1], {
    name: "Decathlon",
    careers_url: "https://jobs.lever.co/decathlon",
    enabled: true,
  });
});

test("les commentaires et les autres blocs survivent a l'ajout", () => {
  const apres = insererDansTrackedCompanies(PORTALS, [
    rendreEntree({ name: "Decathlon", careers_url: "https://jobs.lever.co/decathlon" }),
  ]);
  // C'EST LE TEST QUI COMPTE : un yaml.dump les perdrait tous.
  assert.ok(apres.includes("# Portal Scanner Configuration"), "l'en-tete du fichier");
  assert.ok(apres.includes("# -- AI Labs --"), "les commentaires de section");
  assert.ok(apres.includes('    - "automation engineer"'), "les filtres, guillemets compris");
  // L'insertion se fait DANS le bloc, pas apres la cle suivante.
  assert.ok(apres.indexOf("Decathlon") < apres.indexOf("search_queries"));
  assert.ok(apres.trimEnd().endsWith('- "site:example.com"'), "le bloc suivant reste en place");
});

test("une entreprise en attente est ecrite desactivee, avec l'annonce en indice", () => {
  // enabled: false = le scanner saute l'entree (scan.mjs). C'est ce qui rend
  // l'ajout sans risque quand aucun board public n'a repondu : une PME ajoutee
  // depuis France Travail ne peut pas casser une tournee.
  const doc = yaml.load(
    insererDansTrackedCompanies(PORTALS, [
      rendreEntree({
        name: "Boulangerie Martin",
        careers_url: "https://candidat.francetravail.fr/offres/recherche/detail/1234567",
        enabled: false,
        notes: "Aucun board public trouve.",
      }),
    ]),
  );
  const ajoutee = doc.tracked_companies[1];
  assert.equal(ajoutee.enabled, false);
  assert.equal(ajoutee.careers_url, "https://candidat.francetravail.fr/offres/recherche/detail/1234567");
  assert.equal(ajoutee.notes, "Aucun board public trouve.");
});

test("« en attente » ne se confond pas avec « desactivee expres »", () => {
  // LE PIEGE, constate sur le vrai fichier : 15 entreprises livrees sont
  // enabled: false VOLONTAIREMENT, avec une vraie page carrieres. Les afficher
  // comme « en attente d'ATS » proposerait de reparer ce qui n'est pas casse.
  const entrees = lireEntreprisesSuivies(`tracked_companies:
  - name: Desactivee Expres
    careers_url: https://www.exemple.com/kariyer
    enabled: false
    notes: "Istanbul. Marche non prioritaire."
  - name: Vraiment En Attente
    careers_url: https://candidat.francetravail.fr/offres/recherche/detail/1
    enabled: false
    en_attente_ats: true
  - name: Ancienne Ecriture
    careers_url: ""
    enabled: false
    notes: "Ajoute automatiquement depuis une candidature validee. Completer careers_url puis passer enabled: true."
  - name: Reactivee
    careers_url: https://jobs.lever.co/reactivee
    enabled: true
    en_attente_ats: true
`);
  assert.deepEqual(
    entrees.filter((e) => e.enAttente).map((e) => e.nom),
    ["Vraiment En Attente", "Ancienne Ecriture"],
    "le marqueur, plus les entrees ecrites avant qu'il existe (repli sur la note)",
  );
  assert.equal(entrees.at(-1).enAttente, false, "reactivee : c'est enabled qui fait foi");
});

test("le marqueur n'est ecrit que sur une entree effectivement en attente", () => {
  const attente = rendreEntree({ name: "Sans ATS", enabled: false, enAttente: true });
  assert.match(attente, /en_attente_ats: true/);
  // Une entreprise resolue est active : lui coller le marqueur la ferait
  // apparaitre a reparer alors qu'elle scanne tres bien.
  const resolue = rendreEntree({ name: "Avec ATS", careers_url: "https://jobs.lever.co/x", enAttente: true });
  assert.doesNotMatch(resolue, /en_attente_ats/);
});

test("un nom hostile est echappe, jamais interprete", () => {
  // Le nom vient d'une annonce France Travail : c'est une saisie tierce qui
  // finit dans un fichier de configuration. Il doit ressortir tel quel, sans
  // jamais devenir une cle, un commentaire ou une entree supplementaire.
  const nom = 'Acme: "corp" #1\n  - name: Pirate';
  const doc = yaml.load(
    insererDansTrackedCompanies(PORTALS, [rendreEntree({ name: nom, careers_url: "https://jobs.lever.co/acme" })]),
  );
  assert.equal(doc.tracked_companies.length, 2, "aucune entree clandestine");
  assert.equal(doc.tracked_companies[1].name, 'Acme: "corp" #1   - name: Pirate');
});

test("une URL douteuse n'entre pas dans careers_url", () => {
  assert.equal(urlYaml("https://jobs.lever.co/acme"), "https://jobs.lever.co/acme");
  assert.equal(urlYaml("javascript:alert(1)"), null);
  assert.equal(urlYaml("   "), null);
  // Pas d'URL exploitable => la cle reste, vide : la ligne a completer se voit.
  const doc = yaml.load(insererDansTrackedCompanies(PORTALS, [rendreEntree({ name: "Sans Site", enabled: false })]));
  assert.equal(doc.tracked_companies[1].careers_url, "");
});

test("scalaireYaml laisse tranquille ce qui est inoffensif", () => {
  assert.equal(scalaireYaml("Decathlon France"), "Decathlon France");
  assert.equal(scalaireYaml("Acme: corp"), '"Acme: corp"');
});

test("le doublon est reconnu par le nom, casse et accents compris", () => {
  const entrees = lireEntreprisesSuivies(PORTALS);
  assert.equal(normaliserNom("  Éditions  BELIN "), "editions belin");
  assert.ok(entreeExistante(entrees, { name: "anthropic" }), "meme nom en minuscules");
  assert.ok(entreeExistante(entrees, { name: " Anthröpic " }), "meme nom accentue et espace");
  assert.equal(entreeExistante(entrees, { name: "Anthropic Labs" }), null, "un AUTRE employeur passe");
});

test("le doublon est aussi reconnu par l'URL du board", () => {
  // Deux graphies du meme employeur qui pointent le meme board donneraient deux
  // entrees, donc deux lectures du meme ATS a chaque tournee.
  const entrees = lireEntreprisesSuivies(PORTALS);
  const trouve = entreeExistante(entrees, {
    name: "Anthropic PBC",
    careers_url: "https://job-boards.greenhouse.io/anthropic/",
  });
  assert.equal(trouve?.nom, "Anthropic");
});

test("enabled absent = entreprise active (la regle du scanner)", () => {
  const entrees = lireEntreprisesSuivies(`tracked_companies:
  - name: Sans Drapeau
    careers_url: https://jobs.lever.co/sans
  - name: Desactivee
    careers_url: https://jobs.lever.co/off
    enabled: false
`);
  assert.equal(entrees[0].enabled, true);
  assert.equal(entrees[1].enabled, false);
});

test("un fichier CRLF reste en CRLF, sans \\r orphelin", () => {
  // Le vrai portals.yml de Linéo est en CRLF (clone Windows). Y coller des
  // lignes en LF donne un fichier a fins de ligne melangees — illisible dans les
  // editeurs qui ne devinent pas, alors que ce fichier s'edite a la main. Pire :
  // une coupe entre le \\r et le \\n laissait un \\r seul au milieu du document.
  const crlf = PORTALS.replace(/\n/g, "\r\n");
  const apres = insererDansTrackedCompanies(crlf, [
    rendreEntree({ name: "Decathlon", careers_url: "https://jobs.lever.co/decathlon" }),
  ]);
  assert.equal(apres.match(/\r(?!\n)/), null, "aucun \\r qui ne soit pas suivi d'un \\n");
  assert.equal(apres.match(/(?<!\r)\n/), null, "aucun \\n qui ne soit pas precede d'un \\r");
  assert.equal(yaml.load(apres).tracked_companies.length, 2);
  // Le reste du fichier ressort octet pour octet.
  assert.equal(apres.replace(/\r\n  - name: Decathlon\r\n[^]*?enabled: true\r\n/, ""), crlf);
});

test("un portals.yml sans bloc tracked_companies en recoit un", () => {
  const doc = yaml.load(
    insererDansTrackedCompanies("title_filter:\n  positive:\n    - n8n\n", [
      rendreEntree({ name: "Acme", careers_url: "https://jobs.lever.co/acme" }),
    ]),
  );
  assert.equal(doc.tracked_companies[0].name, "Acme");
  assert.deepEqual(doc.title_filter.positive, ["n8n"]);
});

test("un fichier illisible ne fait pas tomber la lecture", () => {
  assert.deepEqual(lireEntreprisesSuivies("tracked_companies: [oui\n  - non"), []);
  assert.deepEqual(lireEntreprisesSuivies(""), []);
  assert.deepEqual(lireEntreprisesSuivies(undefined), []);
});

test("rien a inserer = fichier inchange, octet pour octet", () => {
  assert.equal(insererDansTrackedCompanies(PORTALS, []), PORTALS);
});
