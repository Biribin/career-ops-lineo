import { spawn } from "node:child_process";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { nettoieSortie } from "@/lib/openai-shim.mjs";

// Exécution d'un prompt par le CLI agentique local (Claude Code sur l'abonnement
// Max = coût marginal nul), partagée par les trois routes du shim :
//   /api/llm/v1/chat/completions   (Chat Completions)
//   /api/llm/v1/responses          (Responses API)
//   /api/llm/v1/models             (liste, pour la validation de modèle)
//
// POURQUOI TROIS ROUTES
// ---------------------
// Le sous-nœud « OpenAI Chat Model » de n8n n'appelle pas toujours le même
// endpoint : selon `responsesApiEnabled` il vise /chat/completions ou /responses,
// et il peut valider le modèle via /models. Au premier run réel (exécution
// 959526) il a pris un 404 et l'a traduit en « The model career-ops-cli does not
// exist » — un message trompeur, puisque le vrai problème était le CHEMIN.
// On implémente donc les trois plutôt que de deviner lequel, et on arrête de
// payer un cycle de redéploiement par hypothèse.

export const CLI_DEFAUT = "claude";
const TIMEOUT_CLI_MS = 280_000;

export type ResultatLlm =
  | { ok: true; texte: string; cliId: string }
  | { ok: false; message: string; status: number };

export function executeLlm(prompt: string, cliIdDemande?: string): Promise<ResultatLlm> {
  const cliId = (cliIdDemande || CLI_DEFAUT).trim();
  const resolved = resolveCli(cliId);
  if (!resolved) {
    return Promise.resolve({
      ok: false,
      message: `CLI '${cliId}' introuvable sur cette machine`,
      status: 503,
    });
  }
  const { spec, binPath } = resolved;

  // Tous les outils coupés : le prompt contient déjà tout le contexte, le modèle
  // n'a qu'à répondre. Un agent qui lirait des fichiers ou ferait des recherches
  // web ici serait lent et imprévisible.
  const args =
    cliId === CLI_DEFAUT
      ? [
          "-p",
          prompt,
          "--permission-mode",
          "acceptEdits",
          "--disallowedTools",
          "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch,Read,Glob,Grep",
        ]
      : spec.args(prompt);

  return new Promise<ResultatLlm>((resolve) => {
    let child;
    try {
      child = spawn(binPath, args, { cwd: careerOpsRoot(), env: process.env });
    } catch (e) {
      resolve({ ok: false, message: e instanceof Error ? e.message : "spawn a échoué", status: 500 });
      return;
    }

    let out = "";
    let err = "";
    const killer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, TIMEOUT_CLI_MS);

    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ ok: false, message: e.message, status: 500 });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      const texte = nettoieSortie(out);
      if (!texte) {
        resolve({
          ok: false,
          message: err.trim() || `${spec.name} n'a rien renvoyé (code ${code})`,
          status: 502,
        });
        return;
      }
      resolve({ ok: true, texte, cliId });
    });
  });
}

/** Erreur au format OpenAI, pour que n8n l'affiche lisiblement. */
export function erreurOpenAi(message: string, status: number, type = "server_error") {
  return Response.json({ error: { message, type, code: null, param: null } }, { status });
}
