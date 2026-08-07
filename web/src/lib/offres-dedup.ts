import { spawn } from "node:child_process";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

// Pont vers l'univers de déduplication du scanner local.
//
// Les offres n8n (France Travail) et les offres du scanner local vivaient dans
// deux mondes étanches : la même annonce pouvait apparaître des deux côtés, et
// chacun continuait de la resservir puisque aucun ne connaissait l'autre.
//
// `n8n-offers-register.mjs` (à la racine) interroge loadSeenUrls() — qui couvre
// scan-history.tsv, pipeline.md ET applications.md — puis enregistre les
// nouvelles via appendToScanHistory, l'écrivain sanctionné de scan.mjs. On le
// lance en sous-processus plutôt que d'importer scan.mjs ici : c'est un module
// de 120 Ko avec sa propre configuration, et c'est le patron déjà retenu pour
// set-status.mjs.

export type ResultatDedup = {
  /** URLs jamais vues, désormais enregistrées. */
  nouvelles: string[];
  /** URLs déjà connues d'une autre source — à ne pas remontrer. */
  deja: string[];
  erreur: string | null;
};

const DELAI_MS = 30_000;

export function dedoublonneOffres(
  offres: Array<{ url?: string; title?: string; company?: string; location?: string }>,
): Promise<ResultatDedup> {
  const vide: ResultatDedup = { nouvelles: [], deja: [], erreur: null };
  if (!offres.length) return Promise.resolve(vide);

  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let child;
    try {
      child = spawn(process.execPath, [rootScript("n8n-offers-register")], {
        cwd: careerOpsRoot(),
        env: process.env,
      });
    } catch (e) {
      resolve({ ...vide, erreur: e instanceof Error ? e.message : "registre indisponible" });
      return;
    }

    const killer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* déjà mort */
      }
    }, DELAI_MS);

    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ ...vide, erreur: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      try {
        const j = JSON.parse(out) as { nouvelles?: string[]; deja?: string[]; error?: string };
        if (j.error) {
          resolve({ ...vide, erreur: j.error });
          return;
        }
        resolve({
          nouvelles: Array.isArray(j.nouvelles) ? j.nouvelles : [],
          deja: Array.isArray(j.deja) ? j.deja : [],
          erreur: null,
        });
      } catch {
        resolve({
          ...vide,
          erreur: err.trim().split("\n")[0] || `le registre a terminé avec le code ${code}`,
        });
      }
    });

    child.stdin.end(JSON.stringify({ offers: offres }));
  });
}
