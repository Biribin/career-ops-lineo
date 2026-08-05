import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { estDue, relancesDues } from "@/lib/followups-due.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The DEMAND loop: surface follow-ups due, via the core's own
// followup-cadence.mjs --json (the SAME calculator the CLI uses) — we never
// reimplement the cadence logic, we read its verdict (mirrors /api/doctor).
// Default: capped list for the home card. `?full=1`: the complete cadence
// (entries + metadata + cadenceConfig) for the /followups tracker page.
//
// `due` est le CONTRAT FIGÉ consommé par n8n (et par la page /relances) :
//   { due: [{ id, entreprise, poste, courriel_contact, jours_depuis_envoi }] }
// Il est ADDITIF — `available` / `metadata` / `entries` restent la forme que la
// home et /followups lisaient déjà. Il est toujours présent, même en échec,
// pour qu'un n8n en face n'ait jamais à distinguer « absent » de « vide ».
//
// On lance le script UNE fois sans `--overdue-only` : la home a besoin de la
// liste complète en repli, et `estDue()` applique exactement le filtre du drapeau
// (followup-cadence.mjs : urgency `overdue` ou `urgent`). Deux processus enfants
// pour le même verdict seraient payés deux fois par requête.
//
// `error` relaie le message du moteur (tracker absent, vide…). Sans lui, un
// `due: []` d'échec est indiscernable d'un `due: []` « rien à relancer » — c'est
// le zéro silencieux que le cœur passe son temps à dénoncer. On ne bascule PAS
// `available` pour autant : un tracker vide est l'état normal d'un premier run,
// pas une panne.
export async function GET(req: Request) {
  const full = new URL(req.url).searchParams.get("full") === "1";
  const script = rootScript("followup-cadence");
  if (!fs.existsSync(script)) {
    return Response.json({ available: false, metadata: null, entries: [], due: [], error: null });
  }
  const stdout = await new Promise<string>((resolve) => {
    execFile("node", [script, "--json"], { cwd: careerOpsRoot(), timeout: 12_000 }, (_e, out) => resolve(out || ""));
  });
  try {
    const start = stdout.indexOf("{");
    const j = JSON.parse(stdout.slice(start));
    const entries = Array.isArray(j.entries) ? j.entries : [];
    const due = relancesDues(entries);
    const error = typeof j.error === "string" && j.error.trim() ? j.error.trim() : null;
    if (full) {
      return Response.json({
        available: true,
        metadata: j.metadata ?? null,
        entries,
        cadenceConfig: j.cadenceConfig ?? null,
        due,
        error,
      });
    }
    // Overdue first; cap for the home (full list lives in /followups).
    const overdue = entries.filter(estDue).slice(0, 8);
    const top = (overdue.length ? overdue : entries).slice(0, 6);
    return Response.json({ available: true, metadata: j.metadata ?? null, entries: top, due, error });
  } catch {
    return Response.json({ available: false, metadata: null, entries: [], due: [], error: null });
  }
}
