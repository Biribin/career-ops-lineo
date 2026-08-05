import { execFile } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";

// Server-only : lance `node stats.mjs` et rend son JSON. Le MÊME agrégateur que
// le CLI (`node stats.mjs --summary`), pour que la page /stats et le terminal ne
// puissent pas afficher deux vérités différentes — c'est la raison d'être du
// contrat stats.mjs (#1604).
//
// Zéro token : stats.mjs ne lit que des fichiers durables, aucun LLM.

export type StatsResultat = {
  /** Le contrat de stats.mjs, ou null si on n'a rien pu obtenir. */
  stats: Record<string, unknown> | null;
  /** Message technique quand le moteur n'a pas rendu son verdict. `null` en cas
   *  de succès. Sans lui, une page vide serait indiscernable d'un pipeline vide. */
  error: string | null;
};

/** Le script sans `--summary` écrit son JSON sur stdout. Il n'échoue pas quand
 *  les fichiers de données manquent : il rend le contrat avec des sections à
 *  `null` et `metadata.sources` qui dit lesquelles — c'est cet état-là qu'une
 *  installation neuve renvoie, et il est normal, pas cassé. */
export async function lireStats(): Promise<StatsResultat> {
  const script = rootScript("stats");
  if (!fs.existsSync(script)) {
    return { stats: null, error: "stats.mjs est absent de cette installation." };
  }
  return new Promise((resolve) => {
    execFile(
      "node",
      [script],
      { cwd: careerOpsRoot(), timeout: 20_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const brut = String(stdout || "");
        const debut = brut.indexOf("{");
        if (debut !== -1) {
          try {
            return resolve({ stats: JSON.parse(brut.slice(debut)) as Record<string, unknown>, error: null });
          } catch {
            /* sortie tronquée ou polluée → message d'erreur ci-dessous */
          }
        }
        const fin = String(stderr || "").trim().split("\n").filter(Boolean).slice(-2).join(" · ");
        resolve({
          stats: null,
          error:
            err && /timed out|ETIMEDOUT/i.test(String(err.message))
              ? "stats.mjs a dépassé le temps imparti."
              : fin || "stats.mjs n'a rien renvoyé d'exploitable.",
        });
      },
    );
  });
}
