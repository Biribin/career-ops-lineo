import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { journalPath } from "@/lib/n8n-decisions";
import { lireInbox } from "@/lib/cv-inbox";
import { trackCompanyInPortals, type PortailTrackResult } from "@/lib/portals-track";
import {
  ajouterAuJournal,
  argsRefusTracker,
  dejaClose,
  estDecision,
  lireJournal,
  porteDisparue,
  type Decision,
  type Fiche,
} from "@/lib/n8n-decisions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * LA porte de validation, côté local.
 *
 * n8n attend sur un nœud Wait en reprise-par-webhook. Ce POST est la seule
 * chose au monde qui le fasse repartir : sans lui, l'exécution reste parkée et
 * aucun mail ne peut être envoyé.
 *
 * Ordre volontaire — tracker AVANT n8n : si l'écriture du tracker échoue, on
 * n'a rien débloqué (l'exécution reste en attente, aucun mail) ; si c'était
 * l'inverse, un refus pourrait partir chez n8n en laissant le tracker muet.
 * Tout échec laisse donc le système dans l'état sûr.
 */

/** Seul l'hôte n8n connu peut recevoir la décision. */
function baseN8n(): string {
  return (process.env.N8N_BASE_URL?.trim() || "https://n8n.balzac-info.online").replace(/\/+$/, "");
}

const MAX_TEXTE = 500;

/** Une consigne/raison est du texte libre : on la borne et on l'aplatit. */
function nettoieTexte(v: unknown): string {
  return String(v ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXTE);
}

type ResultatTracker = { applique: boolean; erreur: string | null; creee?: boolean; num?: number | null };

/**
 * Enregistre un refus dans le tracker via l'UNIQUE point d'écriture sanctionné
 * (`set-status.mjs`) : lock partagé, écriture atomique, états validés contre
 * templates/states.yml, note idempotente.
 *
 * Le format « DISCARD: <raison> » n'est pas arbitraire : c'est exactement ce que
 * `analyze-patterns.mjs` agrège pour dire à Linéo quel motif de refus revient
 * le plus. C'est la seule raison pour laquelle on écrit dans le tracker ici.
 *
 * La ligne est CRÉÉE si elle n'existe pas (`--create`) : une candidature
 * préparée par n8n n'en a pas, et sans ça la raison du refus mourait ici. Le
 * choix des arguments vit dans `argsRefusTracker` (pur, testé) — cette fonction
 * ne fait que lancer le script et rapporter.
 *
 * Un échec n'est PAS bloquant : la raison reste dans le journal, et le refus
 * part quand même chez n8n. Mais il est remonté, jamais avalé.
 */
function ecritRefusTracker(fiche: Fiche, raison: string): Promise<ResultatTracker> {
  const plan = argsRefusTracker({
    scriptPath: rootScript("set-status"),
    entreprise: String(fiche.entreprise ?? ""),
    poste: String(fiche.poste ?? ""),
    raison,
  });
  if (!plan.ok) return Promise.resolve({ applique: false, erreur: plan.motif, creee: false, num: null });
  const { args, creation } = plan;

  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(process.execPath, args, { cwd: careerOpsRoot(), env: process.env });
    } catch (e) {
      resolve({ applique: false, erreur: e instanceof Error ? e.message : "set-status.mjs n'a pas démarré", creee: false, num: null });
      return;
    }
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    const killer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, 30_000);
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ applique: false, erreur: e.message, creee: false, num: null });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) {
        // `created` vient de set-status.mjs : on rapporte s'il a fallu créer la
        // ligne ou seulement la mettre à jour, plutôt que de le déduire.
        let creee = false;
        let num: number | null = null;
        try {
          const j = JSON.parse(out) as { created?: boolean; num?: number };
          creee = j?.created === true;
          num = typeof j?.num === "number" ? j.num : null;
        } catch {
          /* sortie illisible : l'écriture a réussi, seul le détail manque */
        }
        resolve({ applique: true, erreur: null, creee, num });
        return;
      }
      // set-status --json met son erreur structurée sur stdout.
      let message = err.trim().split("\n")[0] || `set-status.mjs a terminé avec le code ${code}`;
      try {
        const j = JSON.parse(out) as { error?: string };
        if (j?.error) message = j.error;
      } catch {
        /* on garde le message brut */
      }
      // Sans rôle exploitable on n'a pas pu demander la création : le dire, sinon
      // « aucune ligne » ressemble à une panne alors que c'est une fiche incomplète.
      if (!creation) {
        message += " — création impossible : la fiche n'a pas de poste exploitable";
      }
      resolve({ applique: false, erreur: message, creee: false, num: null });
    });
  });
}

export async function POST(req: Request) {
  let body: { id?: string; decision?: string; consigne?: string; raison?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "json invalide" }, { status: 400 });
  }

  const id = String(body.id ?? "").trim();
  const decision = String(body.decision ?? "").trim();
  if (!id) return Response.json({ error: "id requis" }, { status: 400 });
  if (!estDecision(decision)) {
    return Response.json(
      { error: `décision inconnue : ${decision || "(vide)"} — attendu : valider, retoucher_lettre, retoucher_cv, refuser` },
      { status: 400 },
    );
  }
  const dec: Decision = decision;

  const consigne = nettoieTexte(body.consigne);
  const raison = nettoieTexte(body.raison);

  // Un refus SANS raison ne sert à rien : c'est la raison qui alimente
  // analyze-patterns.mjs. Une retouche sans consigne ferait juste re-générer
  // le même texte pour rien (et rappellerait un LLM).
  if (dec === "refuser" && !raison) {
    return Response.json({ error: "une raison est obligatoire pour refuser (elle alimente les statistiques)" }, { status: 400 });
  }
  if ((dec === "retoucher_lettre" || dec === "retoucher_cv") && !consigne) {
    return Response.json({ error: "une consigne est obligatoire pour demander une retouche" }, { status: 400 });
  }

  // Même source que la liste : sans ça, une fiche visible sur la page serait
  // introuvable au moment de décider (et l'exécution n8n resterait parquée).
  const source = await lireInbox();
  const fiche = source.fiches.find((f: Fiche) => f.id === id);
  if (!fiche) {
    return Response.json(
      {
        error: source.erreur
          ? `impossible de lire les fiches (${source.origine}) : ${source.erreur}`
          : `aucune fiche n8n pour l'id « ${id} »`,
      },
      { status: source.erreur ? 502 : 404 },
    );
  }

  // Anti double-clic : une décision terminale déjà transmise a consommé la
  // porte. Re-POSTer tomberait de toute façon sur une URL qui n'attend plus.
  if (dejaClose(lireJournal(journalPath()), id)) {
    return Response.json({ error: "cette candidature a déjà été tranchée" }, { status: 409 });
  }

  const url = String(fiche.decision_url ?? "").trim();
  if (!url) {
    return Response.json(
      { error: "la fiche n'a pas de decision_url — elle vient d'une version de workflow sans porte de validation" },
      { status: 422 },
    );
  }
  // La fiche est un fichier écrit par une machine distante : on ne POSTe que
  // vers l'hôte n8n attendu, pour qu'une fiche corrompue ne puisse pas
  // détourner la décision (ni les données qu'elle contient) ailleurs.
  if (!url.startsWith(`${baseN8n()}/`)) {
    return Response.json(
      { error: `decision_url hors de l'hôte n8n autorisé (${baseN8n()}) : ${url}` },
      { status: 422 },
    );
  }

  // 1) Le tracker d'abord (refus uniquement) — voir l'en-tête du fichier.
  let tracker: ResultatTracker = { applique: false, erreur: null };
  if (dec === "refuser") tracker = await ecritRefusTracker(fiche, raison);

  // 2) Puis on rouvre la porte chez n8n.
  let n8nStatus: number | null = null;
  let n8nError: string | null = null;
  try {
    const rep = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: dec, consigne, raison, decide_par: "career-ops-web" }),
      signal: AbortSignal.timeout(30_000),
    });
    n8nStatus = rep.status;
    if (!rep.ok) {
      n8nError =
        rep.status === 404
          ? "n8n n'attend plus sur cette candidature (exécution reprise, expirée ou workflow rechargé)"
          : `n8n a répondu ${rep.status}`;
    }
  } catch (e) {
    n8nError = e instanceof Error ? e.message : "POST vers n8n impossible";
  }

  // 2 bis) Valider => la candidature part chez n8n. On ajoute alors l'entreprise
  // aux Portails suivis (tracked_companies) pour que career-ops la surveille.
  // NON bloquant : le mail est déjà relancé, un échec d'écriture n'annule rien —
  // on le remonte dans le journal + la réponse. Uniquement si n8n a bien accepté.
  let portail: PortailTrackResult | null = null;
  if (dec === "valider" && n8nStatus != null && n8nStatus < 400) {
    try {
      portail = trackCompanyInPortals(String(fiche.entreprise ?? ""), String(fiche.url_offre ?? ""));
    } catch (e) {
      portail = { applique: false, deja: false, erreur: e instanceof Error ? e.message : "ajout aux portails impossible" };
    }
  }

  // 3) Journal, quel que soit le résultat : c'est la trace d'audit.
  const entree = {
    id,
    decision: dec,
    consigne: consigne || undefined,
    raison: raison || undefined,
    at: new Date().toISOString(),
    execution_id: fiche.execution_id,
    n8nStatus,
    n8nError,
    trackerApplique: dec === "refuser" ? tracker.applique : undefined,
    trackerErreur: dec === "refuser" ? tracker.erreur : undefined,
    // Ligne créée ou simplement mise à jour : sans ça, on ne peut plus savoir
    // après coup si le motif de refus a bien atteint les statistiques.
    trackerCreee: dec === "refuser" ? tracker.creee : undefined,
    trackerNum: dec === "refuser" ? tracker.num : undefined,
    portailApplique: dec === "valider" ? portail?.applique : undefined,
    portailDeja: dec === "valider" ? portail?.deja : undefined,
    portailErreur: dec === "valider" ? portail?.erreur ?? undefined : undefined,
  };
  let journalErreur: string | null = null;
  try {
    ajouterAuJournal(journalPath(), entree);
  } catch (e) {
    journalErreur = e instanceof Error ? e.message : "écriture du journal impossible";
  }

  const transmis = n8nStatus != null && n8nStatus < 400;
  // Un REFUS que n8n n'attendait plus est quand même une décision aboutie : rien
  // ne devait partir, le tracker porte la raison, et la fiche est close ici (cf.
  // closEnLocal dans n8n-decisions.mjs). Répondre 502 sur ce cas était ce qui
  // laissait Linéo refuser une candidature qui revenait au chargement suivant.
  //
  // Pour `valider`, la porte disparue reste un ÉCHEC : le mail n'est pas parti.
  const closLocalement = dec === "refuser" && !transmis && porteDisparue(n8nStatus);
  const ok = transmis || closLocalement;
  return Response.json(
    {
      ok,
      decision: dec,
      n8nStatus,
      n8nError,
      transmis,
      closLocalement,
      // Ce qui s'est réellement passé, en une phrase affichable telle quelle.
      avertissement: closLocalement
        ? "n8n n'attendait plus cette candidature : le refus est enregistré ici (tracker + journal) et la fiche ne reviendra plus. Rien n'a été envoyé, ce qui est le comportement voulu pour un refus."
        : undefined,
      tracker: dec === "refuser" ? tracker : null,
      portail: dec === "valider" ? portail : null,
      journalErreur,
    },
    { status: ok ? 200 : 502 },
  );
}
