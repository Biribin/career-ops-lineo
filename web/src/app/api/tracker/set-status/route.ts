import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { canonicalizeStatus } from "@/lib/core/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Écrire un statut dans le tracker QUAND ON N'A PAS LE NUMÉRO DE RAPPORT.
 *
 * `/api/status` fait déjà de l'écriture de statut, mais il cible une ligne par
 * son numéro `n`. n8n ne l'a pas : une candidature préparée par le workflow 2
 * n'est identifiée que par (entreprise, poste). D'où cette route, qui délègue à
 * `set-status.mjs` — l'UNIQUE point d'écriture sanctionné de
 * `data/applications.md` (verrou partagé, écriture atomique, états validés
 * contre `templates/states.yml`, note idempotente).
 *
 * C'est exactement le mécanisme que `/api/decisions/decide` utilise déjà pour
 * inscrire un refus ; il est ici exposé en HTTP parce que l'écoute Gmail des
 * réponses (workflow 4) tourne sur le VPS, dans un autre conteneur.
 *
 * POST { entreprise, statut, role?, note? } -> 200 { ok, statut }
 *
 * On ne recalcule AUCUNE statistique ici, et il ne faut pas en ajouter : les
 * pages /stats et /analytics dérivent tout du tracker via analyze-patterns.mjs.
 * Écrire proprement la ligne SUFFIT, et un second calcul serait une seconde
 * vérité.
 */

const MAX_NOTE = 300;

function nettoieTexte(v: unknown, max: number): string {
  return String(v ?? "")
    .replace(/[\r\n\t|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

type Resultat = { ok: boolean; erreur: string | null; sortie: string };

function lanceSetStatus(args: string[]): Promise<Resultat> {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(process.execPath, args, { cwd: careerOpsRoot(), env: process.env });
    } catch (e) {
      resolve({ ok: false, erreur: e instanceof Error ? e.message : "set-status.mjs n'a pas démarré", sortie: "" });
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
      resolve({ ok: false, erreur: e.message, sortie: out });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      if (code === 0) {
        resolve({ ok: true, erreur: null, sortie: out.trim() });
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
      resolve({ ok: false, erreur: message, sortie: out.trim() });
    });
  });
}

export async function POST(req: Request) {
  let body: { entreprise?: string; statut?: string; role?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "json invalide" }, { status: 400 });
  }

  const entreprise = nettoieTexte(body.entreprise, 120);
  const role = nettoieTexte(body.role, 120);
  const note = nettoieTexte(body.note, MAX_NOTE);
  const demande = nettoieTexte(body.statut, 40);

  if (!entreprise) return Response.json({ error: "entreprise requise" }, { status: 400 });
  if (!demande) return Response.json({ error: "statut requis" }, { status: 400 });

  // Le statut est validé ICI, contre les états canoniques, avant de toucher au
  // tracker : un état inventé par un workflow distant ne doit jamais atterrir
  // dans une cellule que le dashboard lira.
  const canon = canonicalizeStatus(demande);
  if (!canon) {
    return Response.json({ error: `statut hors des états canoniques : ${demande}` }, { status: 400 });
  }

  const args = [rootScript("set-status"), entreprise, canon, "--json"];
  if (role) args.push("--role", role);
  if (note) args.push("--note", note);

  const r = await lanceSetStatus(args);
  if (!r.ok) {
    // Une ligne absente n'est PAS une panne du système : les candidatures
    // préparées par n8n n'ont pas toutes été évaluées en local. On le dit
    // clairement plutôt que de rendre un faux succès — l'appelant décide.
    return Response.json({ ok: false, statut: canon, error: r.erreur }, { status: 422 });
  }
  return Response.json({ ok: true, statut: canon, sortie: r.sortie });
}
