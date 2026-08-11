import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { ajouterEntrepriseSuivie, cheminPortals, entreprisesSuivies } from "@/lib/portals-track";
import { entreeExistante } from "@/lib/portails-suivies.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Ajouter au réseau public des ATS une entreprise croisée sur France Travail.
//
// LE MANQUE QUE ÇA COMBLE : une annonce France Travail est un instantané. Elle
// expire, et l'entreprise redevient invisible — alors que c'est ELLE qui
// intéresse, pas ce poste-là. Suivre l'entreprise, c'est faire relire sa page
// carrières à chaque tournée : le prochain poste arrive sans qu'on ait rien à
// refaire.
//
// DEUX ISSUES, JAMAIS D'ÉCHEC SEC :
//   1. Un board public répond (Greenhouse / Ashby / Lever) → entrée `enabled:
//      true`, scannée dès la tournée suivante. C'est discover-ats.mjs qui sonde
//      ET écrit : on ne réimplémente pas la résolution d'ATS.
//   2. Aucun board — le cas ordinaire d'une PME française, qui recrute sur son
//      propre site ou via un ATS non couvert → entrée `enabled: false` avec
//      l'URL de l'annonce en indice. Elle apparaît « en attente » sur la page
//      Portails, où le bouton « Trouver l'ATS » confie la recherche à l'agent.
//      Une entrée désactivée ne peut ni casser un scan ni polluer un résultat.
//
// La sonde tape des API tierces : bornée à 45 s (le cas courant est un 404
// immédiat sur les trois vendeurs, donc ~1–3 s). Dépassement = on retombe sur
// l'issue 2, jamais sur une erreur affichée à l'utilisateur.
const SONDE_MS = 45_000;

/** Nom exploitable à la fois comme argument de CLI et comme scalaire YAML :
 *  espaces réduits, pas de tiret de tête (discover-ats le lirait comme un
 *  drapeau), longueur bornée. */
function nettoyerNom(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^-+/, "")
    .trim()
    .slice(0, 120);
}

function urlHttp(v: unknown): string {
  const s = String(v ?? "").trim();
  return /^https?:\/\/\S+$/i.test(s) ? s.slice(0, 500) : "";
}

type Board = { careers_url: string; vendor?: string; jobCount?: number; api?: string };
type Sonde = { board: Board | null; ecrit: boolean; deja: boolean };

/**
 * Sonde les boards publics via le cœur (discover-ats.mjs), qui écrit lui-même
 * l'entrée résolue dans portals.yml (`--write`, découpage de texte : les
 * commentaires du fichier sont préservés).
 *
 * Ne lève jamais : toute panne (script absent, JSON illisible, dépassement de
 * délai) rend une sonde vide, et l'appelant bascule sur l'entrée en attente.
 */
async function sonderBoardsPublics(nom: string): Promise<Sonde> {
  const vide: Sonde = { board: null, ecrit: false, deja: false };
  const script = rootScript("discover-ats");
  if (!fs.existsSync(script)) return vide;

  const stdout = await new Promise<string>((resolve) => {
    execFile(
      "node",
      [script, nom, "--write"],
      {
        cwd: careerOpsRoot(),
        timeout: SONDE_MS,
        maxBuffer: 4 * 1024 * 1024,
        // Le cœur résout portals.yml depuis SON dossier ; on le pointe
        // explicitement sur le fichier que l'app lit, pour qu'un
        // CAREER_OPS_ROOT de développement n'écrive pas ailleurs.
        env: { ...process.env, CAREER_OPS_PORTALS: cheminPortals() },
      },
      (_e, out) => resolve(out || ""),
    );
  });

  const debut = stdout.indexOf("{");
  if (debut < 0) return vide;
  let json: {
    metadata?: { freshWritten?: number; duplicatesSkipped?: number; written?: boolean };
    resolved?: Board[];
  };
  try {
    json = JSON.parse(stdout.slice(debut));
  } catch {
    return vide;
  }
  const board = Array.isArray(json.resolved) && json.resolved[0] ? json.resolved[0] : null;
  return {
    board,
    ecrit: !!json.metadata?.written && (json.metadata?.freshWritten ?? 0) > 0,
    deja: (json.metadata?.duplicatesSkipped ?? 0) > 0,
  };
}

/** La liste du réseau suivi — lue à l'ouverture de la page Portails, sans
 *  aucune sonde réseau (le contrôle de santé, lui, coûte 30–60 s).
 *
 *  `enAttente` ne compte QUE les entreprises ajoutées ici sans ATS résolu : le
 *  fichier livré désactive volontairement une quinzaine d'entreprises qui ont,
 *  elles, une vraie page carrières — les mélanger reviendrait à proposer de
 *  réparer ce qui n'est pas cassé. */
export async function GET() {
  const entreprises = entreprisesSuivies();
  return Response.json({
    entreprises,
    actives: entreprises.filter((e) => e.enabled).length,
    enAttente: entreprises.filter((e) => e.enAttente).length,
  });
}

export async function POST(req: Request) {
  let body: { entreprise?: unknown; url?: unknown };
  try {
    body = (await req.json()) as { entreprise?: unknown; url?: unknown };
  } catch {
    return Response.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const nom = nettoyerNom(body.entreprise);
  if (!nom) return Response.json({ ok: false, error: "entreprise manquante" }, { status: 400 });
  const urlOffre = urlHttp(body.url);

  // Déjà suivie : on répond sans toucher au réseau ni au fichier.
  const deja = entreeExistante(entreprisesSuivies(), { name: nom });
  if (deja) {
    return Response.json({
      ok: true,
      statut: "deja",
      entreprise: deja.nom,
      message: deja.enabled
        ? `${deja.nom} est déjà suivie — sa page carrières est relue à chaque tournée.`
        : `${deja.nom} est déjà dans la liste, en attente d'ATS (careers_url à compléter).`,
    });
  }

  const sonde = await sonderBoardsPublics(nom);

  if (sonde.board?.careers_url) {
    // Le cœur a normalement déjà écrit l'entrée. S'il ne l'a pas fait (portals.yml
    // absent, écriture refusée), on l'inscrit nous-mêmes plutôt que d'annoncer un
    // suivi qui n'existe nulle part.
    const ecriture = sonde.ecrit
      ? { applique: true, deja: false, erreur: null }
      : ajouterEntrepriseSuivie({
          name: nom,
          careers_url: sonde.board.careers_url,
          api: sonde.board.api,
          enabled: true,
          notes: "Ajoutée depuis une offre France Travail — board public détecté.",
        });
    if (ecriture.erreur) {
      return Response.json({ ok: false, error: ecriture.erreur }, { status: 500 });
    }
    const n = typeof sonde.board.jobCount === "number" ? sonde.board.jobCount : null;
    return Response.json({
      ok: true,
      statut: "suivie",
      entreprise: nom,
      board: sonde.board,
      message:
        `${nom} est suivie — board ${sonde.board.vendor || "public"} détecté` +
        (n !== null ? ` (${n} poste${n > 1 ? "s" : ""} en ligne)` : "") +
        ", scanné à chaque tournée.",
    });
  }

  // Pas de board public : entrée en attente, désactivée, avec l'annonce en indice.
  const ecriture = ajouterEntrepriseSuivie({
    name: nom,
    careers_url: urlOffre,
    enabled: false,
    enAttente: true,
    notes: "Ajoutée depuis une offre France Travail — aucun board public trouvé. Compléter careers_url puis passer enabled: true.",
  });
  if (ecriture.deja) {
    return Response.json({ ok: true, statut: "deja", entreprise: nom, message: `${nom} est déjà dans la liste.` });
  }
  if (ecriture.erreur) {
    return Response.json({ ok: false, error: ecriture.erreur }, { status: 500 });
  }
  return Response.json({
    ok: true,
    statut: "en_attente",
    entreprise: nom,
    message: `${nom} est ajoutée en attente : aucun board public (Greenhouse, Ashby, Lever) ne répond. À compléter depuis la page Portails.`,
  });
}
