import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { canonicalizeStatus } from "@/lib/core/states";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Deux sous-processus au pire (set-status, puis followup-seed), 30 s de garde
// chacun : la borne doit les couvrir tous les deux, sinon un amorçage lent est
// tué en laissant la ligne écrite et la relance non armée.
export const maxDuration = 120;

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
 * POST { entreprise, statut, role?, note?, creer? }
 *   -> 200 { ok, statut, num, creee, relance }
 *   -> 422 { ok: false, error }   ligne absente et `creer` non demandé
 *
 * `creer: true` ferme la boucle envoi → relance du workflow 3. Sans lui, une
 * candidature préparée par n8n n'a AUCUNE ligne au tracker (les lignes naissent
 * du flux d'évaluation local), `set-status.mjs` sort en 2, et la tournée de
 * relances — qui lit le tracker, pas ce que n8n a envoyé — ne la voit jamais.
 * La relance de cette candidature ne partirait donc jamais.
 *
 * Amorçage de la cadence : marquer `Applied` ne suffit pas non plus. C'est le
 * bug #1430 — `data/follow-ups.md` restait vide, donc aucune date de prochaine
 * relance n'existait. `set-status.mjs` signale le cas avec
 * `followupSeedCandidate: true` (uniquement sur une VRAIE transition vers
 * Applied, jamais sur un rejeu), et c'est ici qu'on appelle `followup-seed.mjs`.
 * Le faire dans set-status.mjs mélangerait deux responsabilités : lui écrit
 * l'état, la cadence est un dérivé.
 *
 * Un échec d'amorçage n'annule PAS l'écriture du statut : la ligne est déjà
 * juste, et perdre le statut pour sauver la cadence serait le mauvais sens
 * d'échec. On le remonte dans `relance.erreur` pour que l'appelant le voie.
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

/**
 * Lance un script career-ops en `--json` et rend sa sortie brute.
 *
 * Partagé par set-status.mjs et followup-seed.mjs : les deux ont le même
 * contrat d'erreur (payload structuré `{error, code}` sur stdout, code de
 * sortie non nul), donc une seule enveloppe suffit et les deux ne peuvent pas
 * diverger sur la façon dont une panne est rapportée.
 */
function lanceScript(args: string[]): Promise<Resultat> {
  const script = args[0]?.split(/[\\/]/).pop() ?? "le script";
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(process.execPath, args, { cwd: careerOpsRoot(), env: process.env });
    } catch (e) {
      resolve({ ok: false, erreur: e instanceof Error ? e.message : `${script} n'a pas démarré`, sortie: "" });
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
      // Les deux scripts mettent leur erreur structurée sur stdout en --json.
      let message = err.trim().split("\n")[0] || `${script} a terminé avec le code ${code}`;
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

/** Ce que `set-status.mjs --json` rend sur sa sortie standard en cas de succès. */
type SortieSetStatus = {
  num?: number;
  created?: boolean;
  followupSeedCandidate?: boolean;
};

/** Ce que `followup-seed.mjs --json` rend. */
type SortieSeed = { seeded?: boolean; nextDate?: string | null; reason?: string };

function parseJson<T>(texte: string): T | null {
  try {
    return JSON.parse(texte) as T;
  } catch {
    return null;
  }
}

/**
 * Amorce la date de prochaine relance pour une ligne fraîchement passée Applied.
 *
 * Idempotent par construction côté script : un deuxième appel rend
 * `seeded: false, reason: "already-seeded"` au lieu d'empiler un second pin.
 */
async function amorceRelance(num: number): Promise<{
  amorcee: boolean;
  prochaine: string | null;
  motif?: string;
  erreur?: string;
}> {
  const r = await lanceScript([rootScript("followup-seed"), String(num), "--json"]);
  const j = parseJson<SortieSeed>(r.sortie);
  if (!r.ok) return { amorcee: false, prochaine: null, erreur: r.erreur ?? "followup-seed.mjs a échoué" };
  if (!j) return { amorcee: false, prochaine: null, erreur: "sortie de followup-seed.mjs illisible" };
  return {
    amorcee: Boolean(j.seeded),
    prochaine: j.nextDate ?? null,
    ...(j.reason ? { motif: j.reason } : {}),
  };
}

export async function POST(req: Request) {
  let body: { entreprise?: string; statut?: string; role?: string; note?: string; creer?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "json invalide" }, { status: 400 });
  }

  const entreprise = nettoieTexte(body.entreprise, 120);
  const role = nettoieTexte(body.role, 120);
  const note = nettoieTexte(body.note, MAX_NOTE);
  const demande = nettoieTexte(body.statut, 40);
  const creer = body.creer === true;

  if (!entreprise) return Response.json({ error: "entreprise requise" }, { status: 400 });
  if (!demande) return Response.json({ error: "statut requis" }, { status: 400 });
  // Refusé ici plutôt que par set-status.mjs : le message reste dans le langage
  // de la route, et on n'a pas payé un sous-processus pour l'apprendre.
  if (creer && !role) {
    return Response.json(
      { error: "role requis avec creer : une ligne sans rôle ne peut plus être départagée ensuite" },
      { status: 400 },
    );
  }

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
  if (creer) args.push("--create");

  const r = await lanceScript(args);
  if (!r.ok) {
    // Une ligne absente n'est PAS une panne du système : les candidatures
    // préparées par n8n n'ont pas toutes été évaluées en local. On le dit
    // clairement plutôt que de rendre un faux succès — l'appelant décide.
    return Response.json({ ok: false, statut: canon, error: r.erreur }, { status: 422 });
  }

  const sortie = parseJson<SortieSetStatus>(r.sortie);
  const num = typeof sortie?.num === "number" ? sortie.num : null;

  // `followupSeedCandidate` ne vaut true que sur une vraie transition vers
  // Applied : un rejeu de n8n ne réamorce donc rien, et n'empile pas un second
  // pin dans data/follow-ups.md.
  const relance =
    sortie?.followupSeedCandidate === true && num !== null
      ? await amorceRelance(num)
      : { amorcee: false, prochaine: null, motif: "pas de transition vers Applied" };

  return Response.json({
    ok: true,
    statut: canon,
    num,
    creee: sortie?.created === true,
    relance,
    sortie: r.sortie,
  });
}
