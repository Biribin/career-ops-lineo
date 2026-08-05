import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

// Résolution des chemins du pont n8n ↔ career-ops. La logique, elle, vit dans
// n8n-decisions.mjs (pure, chemins injectés, testable sans vrai repo cv).

/**
 * Racine du clone local du repo `cv` — là où n8n dépose les fiches via GitHub.
 * `CV_REPO_ROOT` l'emporte ; sinon on suppose la disposition de Linéo, où
 * `career-ops/` et `cv/` sont voisins.
 */
export function cvRepoRoot(): string {
  const env = process.env.CV_REPO_ROOT?.trim();
  if (env) return env;
  return path.resolve(careerOpsRoot(), "..", "cv");
}

/** Dossier des fiches déposées par n8n (dans le repo cv, versionné). */
export function inboxDir(): string {
  return path.join(cvRepoRoot(), "data-inbox");
}

/** Journal local des décisions. Hors du repo cv : c'est une donnée career-ops. */
export function journalPath(): string {
  return path.join(careerOpsRoot(), "data", "n8n-decisions.jsonl");
}
