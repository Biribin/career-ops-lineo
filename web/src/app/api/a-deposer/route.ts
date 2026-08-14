import { canonicalizeStatus } from "@/lib/core/states";
import { fichesADeposerDepuis } from "@/lib/a-deposer.mjs";
import { readApplications } from "@/lib/career-ops";
import { journalPath } from "@/lib/n8n-decisions";
import { lireJournalDetaille } from "@/lib/n8n-decisions.mjs";
import { lireInbox } from "@/lib/cv-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liste les candidatures validées qui attendent un dépôt manuel sur un portail.
// Lecture seule, et entièrement DÉRIVÉE (cf. l'en-tête de a-deposer.mjs) :
// fiches n8n + journal des décisions + tracker. Rien à stocker, donc rien à
// resynchroniser.
//
// Pas de `?sync=1` ici, contrairement à /api/decisions : une candidature ne peut
// entrer dans cette file qu'après avoir été validée, donc sa fiche est déjà
// descendue depuis longtemps. Le seul mouvement qui la fait sortir est une
// écriture au tracker, qui est LOCALE.
//
// La confirmation du dépôt ne passe pas par ici : elle va sur
// /api/tracker/set-status, l'unique point d'écriture sanctionné du tracker (lock
// partagé, états validés contre templates/states.yml, amorçage de la cadence de
// relance). Une route d'écriture de plus ici serait un second chemin vers la
// même table.

export async function GET() {
  const source = await lireInbox();
  // Les DEUX lectures peuvent échouer en silence, et ici l'échec est invisible :
  // sans fiches, ou sans journal, la file paraît vide. Chacune est donc remontée
  // séparément — « je n'ai pas pu lire » n'est pas « il n'y a rien à déposer ».
  const journal = lireJournalDetaille(journalPath());

  return Response.json({
    fiches: fichesADeposerDepuis(source.fiches, journal.journal, readApplications(), canonicalizeStatus),
    mode: source.mode,
    origine: source.origine,
    erreur: source.erreur,
    tronquees: source.tronquees,
    erreurJournal: journal.erreur,
    journalIllisibles: journal.illisibles,
  });
}
