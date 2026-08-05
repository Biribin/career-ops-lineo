import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { inboxDir, journalPath } from "@/lib/n8n-decisions";
import { trackCompanyInPortals, type PortailTrackResult } from "@/lib/portals-track";
import {
  ajouterAuJournal,
  dejaClose,
  estDecision,
  lireFiches,
  lireJournal,
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

type ResultatTracker = { applique: boolean; erreur: string | null };

/**
 * Enregistre un refus dans le tracker via l'UNIQUE point d'écriture sanctionné
 * (`set-status.mjs`) : lock partagé, écriture atomique, états validés contre
 * templates/states.yml, note idempotente.
 *
 * Le format « DISCARD: <raison> » n'est pas arbitraire : c'est exactement ce que
 * `analyze-patterns.mjs` agrège pour dire à Linéo quel motif de refus revient
 * le plus. C'est la seule raison pour laquelle on écrit dans le tracker ici.
 *
 * Une ligne absente n'est PAS une erreur bloquante : les fiches viennent de
 * n8n, et une offre jamais évaluée en local n'a pas de ligne. On le remonte,
 * la raison reste dans le journal, et le refus part quand même chez n8n.
 */
function ecritRefusTracker(fiche: Fiche, raison: string): Promise<ResultatTracker> {
  const entreprise = String(fiche.entreprise ?? "").trim();
  if (!entreprise) {
    return Promise.resolve({ applique: false, erreur: "fiche sans entreprise : rien à retrouver dans le tracker" });
  }

  const args = [rootScript("set-status"), entreprise, "Discarded", "--note", `DISCARD: ${raison}`, "--json"];
  const poste = String(fiche.poste ?? "").trim();
  if (poste) args.push("--role", poste);

  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(process.execPath, args, { cwd: careerOpsRoot(), env: process.env });
    } catch (e) {
      resolve({ applique: false, erreur: e instanceof Error ? e.message : "set-status.mjs n'a pas démarré" });
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
      resolve({ applique: false, erreur: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) {
        resolve({ applique: true, erreur: null });
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
      resolve({ applique: false, erreur: message });
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

  const fiche = lireFiches(inboxDir()).find((f: Fiche) => f.id === id);
  if (!fiche) return Response.json({ error: `aucune fiche n8n pour l'id « ${id} »` }, { status: 404 });

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

  const ok = n8nStatus != null && n8nStatus < 400;
  return Response.json(
    {
      ok,
      decision: dec,
      n8nStatus,
      n8nError,
      tracker: dec === "refuser" ? tracker : null,
      portail: dec === "valider" ? portail : null,
      journalErreur,
    },
    { status: ok ? 200 : 502 },
  );
}
