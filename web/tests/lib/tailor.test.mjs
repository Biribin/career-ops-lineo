// Tests du tailoring « données » (tailor.mjs).
//
// L'enjeu est l'anti-invention : un mot-clé rendu ici part dans le CV Typst
// envoyé à un recruteur. Un faux positif n'est pas un bug d'affichage, c'est une
// compétence affirmée à tort. Les tests ci-dessous verrouillent donc surtout ce
// que la fonction doit REFUSER de rendre.
//
// Run:  node --test tests/lib/tailor.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TERMES_BANNIS,
  jdEnBlocRequis,
  motsClesDepuisCv,
  motsClesDuClassifieur,
  motsClesVrais,
  nettoyer,
  phrasePresente,
  termeBanni,
  titresCibles,
  titreVrai,
  vocabulaireCv,
} from "../../src/lib/tailor.mjs";

const CV = `# CV

## Professional Summary

J'ai automatisé la paie et la DSN d'un groupe qui gère 900 intérimaires.

## Skills

- **Automatisation & intégration :** n8n auto-hébergé, API REST, OAuth2, MCP (Model Context Protocol), gestion de cache
- **IA appliquée :** RAG, Pinecone, prompt engineering appliqué à la production
- **Développement :** JavaScript / TypeScript, Node.js, Python, SQL
- **Métier :** paie et cotisations sociales, DSN, PAS, conformité aéroportuaire (badges, habilitations), ISO 9001

## Languages

- **Français :** langue maternelle
`;

test("nettoyer: ni markdown ni tiret cadratin dans une sortie candidat", () => {
  assert.equal(nettoyer("**Node.js**"), "Node.js");
  assert.equal(nettoyer("Python — avancé"), "Python avancé");
  assert.equal(nettoyer("`SQL`"), "SQL");
  assert.equal(nettoyer("  API   REST  "), "API REST");
});

test("vocabulaireCv: ne lit que la section Skills", () => {
  const v = vocabulaireCv(CV);
  assert.ok(v.includes("n8n"));
  assert.ok(v.includes("DSN"));
  // « 900 intérimaires » est dans le résumé, pas dans Skills : hors périmètre.
  assert.ok(!v.some((p) => /intérim/i.test(p)));
  // Le titre de rubrique n'est pas une compétence.
  assert.ok(!v.includes("Automatisation & intégration"));
  // Un CV sans section Skills ne produit aucun vocabulaire (donc aucun mot-clé).
  assert.deepEqual(vocabulaireCv("# CV\n\nJ'aime Python.\n"), []);
});

test("vocabulaireCv: éclate les listes, parenthèses et séparateurs", () => {
  const v = vocabulaireCv(CV);
  for (const attendu of ["MCP", "Model Context Protocol", "JavaScript", "TypeScript", "badges", "habilitations"]) {
    assert.ok(v.includes(attendu), `manque : ${attendu}`);
  }
  // La ponctuation de liste ne doit pas coller au mot-clé.
  assert.ok(!v.some((p) => /[,;]$/.test(p)));
  // « ISO 9001 » ne doit pas produire le mot-clé « 9001 ».
  assert.ok(!v.includes("9001"));
  // « gestion de cache » ne doit pas produire « gestion ».
  assert.ok(!v.includes("gestion"));
});

test("phrasePresente: frontières de mot et accents", () => {
  assert.equal(phrasePresente("Java", "on cherche du JavaScript"), false);
  assert.equal(phrasePresente("intégration", "poste d'integration continue"), true);
  assert.equal(phrasePresente("Node.js", "stack Node.js / Postgres"), true);
  assert.equal(phrasePresente("API REST", "des  API   REST à concevoir"), true);
  assert.equal(phrasePresente("", "n'importe quoi"), false);
});

test("phrasePresente: un sigle court exige les capitales", () => {
  // « PAS » (prélèvement à la source) contre la négation française : sans cette
  // règle, toute offre écrivant « ne pas » se verrait attribuer la compétence.
  assert.equal(phrasePresente("PAS", "il ne faut pas hésiter"), false);
  assert.equal(phrasePresente("PAS", "gestion du PAS mensuel"), true);
  // Un mot long reste insensible à la casse.
  assert.equal(phrasePresente("Kubernetes", "du kubernetes en prod"), true);
});

test("motsClesDepuisCv: intersection cv.md ∩ offre, dans l'ordre de l'offre", () => {
  const jd = "Vous maîtrisez Node.js, et vous connaissez n8n.";
  assert.deepEqual(motsClesDepuisCv(CV, jd), ["Node.js", "n8n"]);
});

test("motsClesDepuisCv: ce que l'offre demande mais que le CV n'a pas est ignoré", () => {
  const mots = motsClesDepuisCv(CV, "Nous cherchons du Kubernetes, du Rust et du Salesforce.");
  assert.deepEqual(mots, []);
});

test("motsClesDuClassifieur: seul ce que la section Skills confirme survit", () => {
  // On présente l'offre entière comme un bloc d'exigences, donc le classifieur
  // ratisse large : le filtre section-Skills est le garde-fou anti-invention.
  const mots = motsClesDuClassifieur({ existing: ["Node.js", "Kubernetes", "Rust"] }, CV);
  assert.deepEqual(mots, ["Node.js"]);
  assert.deepEqual(motsClesDuClassifieur(null, CV), []);
  // Pas de section Skills = rien de nommé à confirmer.
  assert.deepEqual(motsClesDuClassifieur({ existing: ["Python"] }, "# CV\n\nJ'aime Python.\n"), []);
});

test("motsClesDuClassifieur: un mot capitalisé de début de ligne n'est pas une compétence", () => {
  // Cas réel : sur une offre française le classifieur remonte « La », « Vous »,
  // « Notions ». Une simple recherche dans la section Skills les laisserait passer
  // (elle contient « appliqué à la production »).
  assert.deepEqual(motsClesDuClassifieur({ existing: ["La", "Vous", "Notions"] }, CV), []);
});

test("motsClesDuClassifieur: garde un sigle en capitales même hors vocabulaire", () => {
  // « IA » ne vit que dans un intitulé de rubrique (donc pas dans le vocabulaire),
  // mais reste un mot-clé ATS légitime et vrai.
  assert.ok(!vocabulaireCv(CV).includes("IA"));
  assert.deepEqual(motsClesDuClassifieur({ existing: ["IA"] }, CV), ["IA"]);
});

test("motsClesDuClassifieur: un jeton isolé cède la place à l'expression du CV", () => {
  // Le classifieur découpe mot à mot (« Microsoft », « Graph ») ; le CV, lui, nomme
  // « Microsoft Graph ». Le jeton seul n'est pas une compétence nommée.
  const cv = CV.replace("API REST,", "API REST, Microsoft Graph,");
  assert.deepEqual(motsClesDuClassifieur({ existing: ["Microsoft", "Graph"] }, cv), []);
});

test("motsClesVrais: union des deux sources, sans doublon ni recouvrement", () => {
  const jd = "Stack : Node.js, API REST, n8n. Bonus : Kubernetes.";
  // `API` et `REST` arrivent AVANT `API REST` (le classifieur découpe mot à mot) :
  // c'est le sens de recouvrement que le simple « déjà couvert » ne voit pas.
  const mots = motsClesVrais({
    cvText: CV,
    jdText: jd,
    classification: { existing: ["API", "REST", "Node.js", "Kubernetes"] },
  });
  // Kubernetes n'est pas sur le CV : jamais rendu, même annoncé par le classifieur.
  assert.ok(!mots.includes("Kubernetes"));
  assert.ok(mots.includes("Node.js"));
  assert.ok(mots.includes("n8n"));
  // « API REST » couvre « API » et « REST » : une seule place consommée.
  assert.ok(mots.includes("API REST"));
  assert.ok(!mots.includes("API"));
  assert.ok(!mots.includes("REST"));
  // Aucun doublon, casse et accents confondus.
  const cles = mots.map((m) => m.toLowerCase());
  assert.equal(new Set(cles).size, cles.length);
});

test("motsClesVrais: une offre hors sujet ne rend aucun mot-clé", () => {
  assert.deepEqual(motsClesVrais({ cvText: CV, jdText: "Recherche boulanger, pétrissage, four à bois." }), []);
});

test("motsClesVrais: plafonné et sans markdown", () => {
  const jd = vocabulaireCv(CV).join(", ");
  const mots = motsClesVrais({ cvText: CV, jdText: jd });
  assert.ok(mots.length <= 18, `plafond dépassé : ${mots.length}`);
  assert.ok(!mots.some((m) => /[*`—–]/.test(m)));
});

test("jdEnBlocRequis: ouvre un bloc d'exigences que l'extracteur du cœur reconnaît", () => {
  const out = jdEnBlocRequis("Nos missions\n\nConcevoir des workflows n8n.\n# Avantages\nTickets restaurant");
  assert.match(out.split("\n")[0], /^##\s*Requirements$/);
  // Chaque ligne non vide devient une puce, y compris les anciens titres : sinon
  // un « À propos de nous » refermerait le bloc et l'offre ne serait pas scannée.
  assert.deepEqual(
    out.split("\n").filter((l) => l.startsWith("- ")),
    ["- Nos missions", "- Concevoir des workflows n8n.", "- Avantages", "- Tickets restaurant"],
  );
  assert.equal(jdEnBlocRequis("").split("\n").filter((l) => l.startsWith("- ")).length, 0);
});

const PROFIL = {
  target_roles: {
    primary: ["AI Automation Engineer", "Ingenieur en automatisation & integration IA"],
    archetypes: [
      { name: "AI Automation Engineer", fit: "primary" },
      { name: "Solutions Engineer", fit: "secondary" },
      { name: "Data Engineer", fit: "adjacent" },
    ],
  },
};

test("titresCibles: primary d'abord, dédoublonné, rangé par fit", () => {
  const cibles = titresCibles(PROFIL);
  assert.deepEqual(
    cibles.map((c) => c.nom),
    ["AI Automation Engineer", "Ingenieur en automatisation & integration IA", "Solutions Engineer", "Data Engineer"],
  );
  assert.deepEqual(titresCibles(null), []);
  assert.deepEqual(titresCibles({}), []);
  assert.deepEqual(titresCibles({ target_roles: "n'importe quoi" }), []);
});

test("titreVrai: rend un intitulé DÉCLARÉ, jamais celui de l'annonce", () => {
  const cibles = titresCibles(PROFIL);
  assert.equal(titreVrai("AI Automation Engineer (H/F)", cibles), "AI Automation Engineer");
  // Accents et « et » vs « & » ne doivent pas empêcher la correspondance.
  assert.equal(
    titreVrai("Ingénieur en automatisation et intégration IA - CDI", cibles),
    "Ingenieur en automatisation & integration IA",
  );
});

test("titreVrai: undefined plutôt qu'un intitulé forcé", () => {
  const cibles = titresCibles(PROFIL);
  // Un seul jeton commun (« Engineer ») ne fait pas une correspondance.
  assert.equal(titreVrai("Sales Engineer", cibles), undefined);
  assert.equal(titreVrai("Chef de projet marketing", cibles), undefined);
  assert.equal(titreVrai("", cibles), undefined);
  // Sans config, pas d'intitulé : le CV garde le sien.
  assert.equal(titreVrai("AI Automation Engineer", []), undefined);
});

test("titreVrai: à couverture égale, le fit déclaré tranche", () => {
  const cibles = titresCibles({
    target_roles: {
      primary: [],
      archetypes: [
        { name: "Data Engineer", fit: "adjacent" },
        { name: "Backend Engineer", fit: "primary" },
      ],
    },
  });
  assert.equal(titreVrai("Backend Data Engineer", cibles), "Backend Engineer");
});

// « no-code » est banni des CV de Lineo depuis le 2026-08-11 (« moi je fais du low
// code et du vibe code »). Il etait quand meme arrive dans le CV Nutripure, par
// l'annonce : le terme y figurait, le classifieur l'a rendu, et il s'est retrouve
// dans les mots-cles ATS. Le prompt ne suffit pas, d'ou ce filtre.
test("termeBanni: reconnait no-code quelle que soit la graphie", () => {
  for (const graphie of ["no-code", "No-Code", "NO CODE", "nocode", " no-code "]) {
    assert.equal(termeBanni(graphie), true, graphie);
  }
});

test("termeBanni: laisse passer ce qui n'est pas banni", () => {
  for (const mot of ["low-code", "no-code-review", "code", "vibe coding", "n8n"]) {
    assert.equal(termeBanni(mot), false, mot);
  }
});

test("motsClesVrais: no-code ne peut pas entrer dans les mots-cles ATS", () => {
  const cvAvecNoCode = CV.replace(
    "n8n auto-hébergé, API REST",
    "n8n auto-hébergé, no-code, API REST",
  );
  const jd = "Nous cherchons quelqu'un en no-code et n8n, API REST.";
  const mots = motsClesVrais({
    cvText: cvAvecNoCode,
    jdText: jd,
    classification: { existing: ["no-code", "n8n", "API REST"] },
  });
  assert.ok(!mots.some((m) => termeBanni(m)), "aucun terme banni : " + JSON.stringify(mots));
  assert.ok(mots.length > 0, "le filtre ne doit pas vider la liste");
});

test("TERMES_BANNIS est exporte, pour que le garde-fou soit lisible d'ailleurs", () => {
  assert.ok(TERMES_BANNIS.includes("no-code"));
});
