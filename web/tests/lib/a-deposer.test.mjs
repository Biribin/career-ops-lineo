// Tests de la file « À déposer » (a-deposer.mjs).
//
// Ce que ces tests protègent : une candidature validée que n8n n'a PAS pu
// envoyer (aucun courriel de recruteur, dépôt manuel sur l'ATS) doit rester
// visible jusqu'à ce que le tracker atteste du dépôt — et disparaître dès qu'il
// l'atteste, sans drapeau supplémentaire nulle part.
//
// Le cas de référence est réel : Nutripure, exécution n8n 973939 du 2026-08-11,
// validée par Linéo, dossier reçu, déposée sur welcomekit, zéro ligne au
// tracker, donc zéro relance armée. Personne ne l'a vue nulle part pendant
// trois jours.
//
// Les deux erreurs ne se valent pas : afficher une candidature déjà déposée
// coûte un clic idempotent, en cacher une jamais déposée la perd pour toujours.
// D'où les tests sur les statuts illisibles.
//
// Run:  node --test tests/lib/a-deposer.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { attesteUnTraitement, cleSuivi, fichesADeposerDepuis } from "../../src/lib/a-deposer.mjs";

/**
 * Stub de `canonicalizeStatus` (lib/core/states.ts) : même contrat — le label
 * canonique, ou null si l'état n'est pas reconnu. Volontairement réduit aux
 * états que ces tests exercent, alias espagnols compris.
 */
const ALIAS = {
  evaluated: "Evaluated",
  evaluada: "Evaluated",
  applied: "Applied",
  enviada: "Applied",
  sent: "Applied",
  responded: "Responded",
  interview: "Interview",
  hired: "Hired",
  rejected: "Rejected",
  discarded: "Discarded",
  skip: "SKIP",
};
const canonise = (brut) => ALIAS[String(brut).trim().toLowerCase()] ?? null;

/** La fiche Nutripure, réduite à ce que la file regarde. */
function nutripure(extra = {}) {
  return {
    schema: "career-ops-inbox/v2",
    id: "5016911",
    statut: "A_VALIDER",
    entreprise: "Nutripure",
    poste: "Développeur intelligence artificielle (H/F)",
    lieu: "31 - Toulouse",
    courriel_contact: "",
    ...extra,
  };
}

/** Le journal réel : un `valider` transmis (n8n a répondu 200). */
const VALIDEE = [{ id: "5016911", decision: "valider", at: "2026-08-11T13:46:54.557Z", n8nStatus: 200 }];

test("le cas Nutripure : validee, sans courriel, sans ligne au tracker -> a deposer", () => {
  const out = fichesADeposerDepuis([nutripure()], VALIDEE, [], canonise);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "5016911");
  assert.equal(out[0].valideeLe, "2026-08-11T13:46:54.557Z");
  assert.equal(out[0].numTracker, null);
  assert.equal(out[0].statutTracker, null);
});

test("une ligne Applied au tracker fait sortir la fiche de la file", () => {
  const lignes = [{ n: "5", company: "Nutripure", role: "Développeur intelligence artificielle (H/F)", status: "Applied" }];
  assert.equal(fichesADeposerDepuis([nutripure()], VALIDEE, lignes, canonise).length, 0);
});

test("l intitule du tracker n a pas besoin d etre identique au caractere pres", () => {
  // Ce que Linéo (ou un rattrapage a la main) ecrit rarement a l identique :
  // accents perdus, « (H/F) » oublie, ordre des mots, casse de l entreprise.
  const lignes = [{ n: "5", company: "nutripure", role: "Developpeur intelligence artificielle", status: "Applied" }];
  assert.equal(fichesADeposerDepuis([nutripure()], VALIDEE, lignes, canonise).length, 0);
});

test("les etats qui viennent APRES l envoi font aussi sortir de la file", () => {
  for (const status of ["Responded", "Interview", "Hired", "Rejected", "Discarded", "SKIP", "enviada"]) {
    const lignes = [{ n: "5", company: "Nutripure", role: "Développeur intelligence artificielle (H/F)", status }];
    assert.equal(fichesADeposerDepuis([nutripure()], VALIDEE, lignes, canonise).length, 0, status);
  }
});

test("une ligne Evaluated n atteste AUCUN depot : la fiche reste, avec son numero", () => {
  // Candidature evaluee en local puis reprise par n8n : la ligne existe deja,
  // mais rien n a ete envoye. Afficher le numero evite de croire que le clic va
  // creer un doublon.
  const lignes = [{ n: "12", company: "Nutripure", role: "Développeur intelligence artificielle (H/F)", status: "Evaluated" }];
  const out = fichesADeposerDepuis([nutripure()], VALIDEE, lignes, canonise);
  assert.equal(out.length, 1);
  assert.equal(out[0].numTracker, "12");
  assert.equal(out[0].statutTracker, "Evaluated");
});

test("un statut vide ou illisible laisse la fiche VISIBLE (le sens de l echec)", () => {
  for (const status of ["", "  ", "—", "-", "En cours de dépôt", "Applied (portail)"]) {
    const lignes = [{ n: "5", company: "Nutripure", role: "Développeur intelligence artificielle (H/F)", status }];
    assert.equal(fichesADeposerDepuis([nutripure()], VALIDEE, lignes, canonise).length, 1, JSON.stringify(status));
  }
});

test("une fiche AVEC courriel de recruteur n est jamais a deposer : le mail est parti seul", () => {
  const f = nutripure({ courriel_contact: "recrutement@exemple.fr" });
  assert.equal(fichesADeposerDepuis([f], VALIDEE, [], canonise).length, 0);
});

test("une validation NON transmise ne met rien dans la file : n8n n a rien prepare", () => {
  // POST tombe sur une porte disparue (404) ou en panne reseau (null) :
  // l execution reste parquee, aucun dossier a deposer n existe.
  for (const n8nStatus of [404, 410, 500, null]) {
    const journal = [{ id: "5016911", decision: "valider", at: "2026-08-11T13:46:54.557Z", n8nStatus }];
    assert.equal(fichesADeposerDepuis([nutripure()], journal, [], canonise).length, 0, String(n8nStatus));
  }
});

test("les autres decisions ne mettent rien dans la file", () => {
  for (const decision of ["refuser", "retoucher_lettre", "retoucher_cv"]) {
    const journal = [{ id: "5016911", decision, at: "2026-08-11T13:46:54.557Z", n8nStatus: 200 }];
    assert.equal(fichesADeposerDepuis([nutripure()], journal, [], canonise).length, 0, decision);
  }
});

test("une fiche jamais tranchee n est pas a deposer", () => {
  assert.equal(fichesADeposerDepuis([nutripure()], [], [], canonise).length, 0);
});

test("la file est ordonnee par validation la plus ancienne d abord", () => {
  const fiches = [
    nutripure({ id: "a", entreprise: "Alpha", poste: "Data Engineer" }),
    nutripure({ id: "b", entreprise: "Beta", poste: "Data Engineer" }),
    nutripure({ id: "c", entreprise: "Gamma", poste: "Data Engineer" }),
  ];
  const journal = [
    { id: "b", decision: "valider", at: "2026-08-12T10:00:00.000Z", n8nStatus: 200 },
    { id: "c", decision: "valider", at: "2026-08-10T10:00:00.000Z", n8nStatus: 200 },
    { id: "a", decision: "valider", at: "2026-08-11T10:00:00.000Z", n8nStatus: 200 },
  ];
  assert.deepEqual(
    fichesADeposerDepuis(fiches, journal, [], canonise).map((f) => f.id),
    ["c", "a", "b"],
  );
});

test("une retouche puis une validation : c est la validation transmise qui date la fiche", () => {
  const journal = [
    { id: "5016911", decision: "retoucher_lettre", at: "2026-08-09T08:00:00.000Z", n8nStatus: 200 },
    { id: "5016911", decision: "valider", at: "2026-08-11T13:46:54.557Z", n8nStatus: 200 },
  ];
  const out = fichesADeposerDepuis([nutripure()], journal, [], canonise);
  assert.equal(out.length, 1);
  assert.equal(out[0].valideeLe, "2026-08-11T13:46:54.557Z");
});

test("deux rangees pour la meme candidature : celle qui atteste un traitement gagne", () => {
  // Peut arriver si les intitules ont assez diverge pour que merge-tracker cree
  // une seconde rangee. Une seule qui atteste suffit a sortir de la file, quel
  // que soit l ordre de lecture.
  const evaluee = { n: "12", company: "Nutripure", role: "Développeur intelligence artificielle (H/F)", status: "Evaluated" };
  const envoyee = { n: "5", company: "Nutripure", role: "Développeur intelligence artificielle (H/F)", status: "Applied" };
  assert.equal(fichesADeposerDepuis([nutripure()], VALIDEE, [evaluee, envoyee], canonise).length, 0);
  assert.equal(fichesADeposerDepuis([nutripure()], VALIDEE, [envoyee, evaluee], canonise).length, 0);
});

test("une fiche sans entreprise ou sans poste ne peut pas etre rapprochee, donc reste visible", () => {
  // Pas de cle -> aucun rapprochement possible avec le tracker. On l affiche :
  // c est le seul endroit ou Lineo peut encore la voir.
  assert.equal(cleSuivi({ entreprise: "", poste: "Data Engineer" }), null);
  assert.equal(cleSuivi({ entreprise: "Alpha", poste: "" }), null);
  const f = nutripure({ entreprise: "" });
  const lignes = [{ n: "5", company: "Nutripure", role: "Développeur intelligence artificielle (H/F)", status: "Applied" }];
  assert.equal(fichesADeposerDepuis([f], VALIDEE, lignes, canonise).length, 1);
});

test("attesteUnTraitement : le vocabulaire vient du canoniseur, jamais d une copie locale", () => {
  assert.equal(attesteUnTraitement("Applied", canonise), true);
  assert.equal(attesteUnTraitement("enviada", canonise), true);
  // Evaluated est reconnu par le canoniseur, et pourtant n atteste RIEN : c est
  // l etat d une candidature evaluee et pas encore envoyee.
  assert.equal(attesteUnTraitement("Evaluated", canonise), false);
  assert.equal(attesteUnTraitement("evaluada", canonise), false);
  assert.equal(attesteUnTraitement("", canonise), false);
  assert.equal(attesteUnTraitement(null, canonise), false);
  assert.equal(attesteUnTraitement("Déposée", canonise), false);
  // Un canoniseur qui reconnaitrait un etat futur le fait compter, sans toucher
  // a ce fichier : c est tout l interet de l injection.
  assert.equal(attesteUnTraitement("Withdrawn", () => "Withdrawn"), true);
});
