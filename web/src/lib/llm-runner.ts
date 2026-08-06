import { spawn } from "node:child_process";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { nettoieSortie } from "@/lib/openai-shim.mjs";
import { comptesDisponibles, estPlafond } from "@/lib/llm-quota.mjs";

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
  | { ok: true; texte: string; cliId: string; compte: string }
  | { ok: false; message: string; status: number };

/**
 * Exécute un prompt, en basculant automatiquement de compte si le premier est
 * plafonné.
 *
 * LE DANGER QU'ON DÉSAMORCE ICI : quand l'abonnement est épuisé, le CLI ne plante
 * pas, il RÉPOND « You've hit your weekly limit… » avec un code de sortie 0. Sans
 * la détection de `llm-quota.mjs`, ce texte devient le corps d'une lettre de
 * motivation, commitée dans le repo cv, rendue en PDF et envoyée à un recruteur.
 * On teste donc chaque sortie avant de la rendre.
 *
 * Comptes essayés dans l'ordre : l'environnement tel quel, puis
 * CLAUDE_CODE_OAUTH_TOKEN_2, _3… (convention déjà retenue par /api/forum-judge).
 * Aucune valeur de jeton ne transite par le code : seuls des NOMS de variables.
 */
export async function executeLlm(prompt: string, cliIdDemande?: string): Promise<ResultatLlm> {
  const cliId = (cliIdDemande || CLI_DEFAUT).trim();
  const resolved = resolveCli(cliId);
  if (!resolved) {
    return { ok: false, message: `CLI '${cliId}' introuvable sur cette machine`, status: 503 };
  }

  // La rotation de comptes n'a de sens que pour Claude (jeton d'abonnement).
  const comptes = cliId === CLI_DEFAUT ? comptesDisponibles(process.env) : [{ id: "compte-1", varJeton: null }];

  let dernierPlafond = "";
  for (const compte of comptes) {
    const env = compte.varJeton
      ? { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: process.env[compte.varJeton] }
      : process.env;

    const r = await lanceUneFois(prompt, cliId, resolved, env);

    if (r.plafond) {
      // On garde la trace du message pour le rendre si TOUS les comptes sont
      // épuisés, mais on ne le rend jamais comme une réponse du modèle.
      dernierPlafond = r.message;
      continue;
    }
    if (!r.ok) return { ok: false, message: r.message, status: r.status };
    return { ok: true, texte: r.texte, cliId, compte: compte.id };
  }

  // Tous les comptes plafonnés → 429, pour que n8n retente plus tard et ne
  // marque RIEN comme traité. Une offre non traitée se rattrape ; une lettre
  // vide envoyée à un recruteur, non.
  return {
    ok: false,
    status: 429,
    message:
      `tous les comptes Claude sont plafonnes (${comptes.length} essaye(s)) : ` +
      (dernierPlafond || "plafond atteint") +
      ". Ajouter CLAUDE_CODE_OAUTH_TOKEN_2 dans Coolify, ou attendre la reinitialisation.",
  };
}

type Essai =
  | { ok: true; texte: string; plafond: false }
  | { ok: false; message: string; status: number; plafond: boolean };

function lanceUneFois(
  prompt: string,
  cliId: string,
  resolved: NonNullable<ReturnType<typeof resolveCli>>,
  env: NodeJS.ProcessEnv,
): Promise<Essai> {
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

  return new Promise<Essai>((resolve) => {
    let child;
    try {
      child = spawn(binPath, args, { cwd: careerOpsRoot(), env });
    } catch (e) {
      resolve({ ok: false, message: e instanceof Error ? e.message : "spawn a échoué", status: 500, plafond: false });
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
      resolve({ ok: false, message: e.message, status: 500, plafond: false });
    });
    child.on("close", (code) => {
      clearTimeout(killer);

      // AVANT tout : est-ce un refus pour plafond ? Le CLI répond ce message
      // avec un code de sortie 0, donc c'est le seul endroit où on peut
      // l'attraper avant qu'il ne devienne « la réponse du modèle ».
      if (estPlafond(out, err)) {
        resolve({
          ok: false,
          plafond: true,
          status: 429,
          message: String(out || err).trim().slice(0, 200),
        });
        return;
      }

      const texte = nettoieSortie(out);
      if (!texte) {
        resolve({
          ok: false,
          message: err.trim() || `${spec.name} n'a rien renvoyé (code ${code})`,
          status: 502,
          plafond: false,
        });
        return;
      }
      resolve({ ok: true, texte, plafond: false });
    });
  });
}

/** Erreur au format OpenAI, pour que n8n l'affiche lisiblement. */
export function erreurOpenAi(message: string, status: number, type = "server_error") {
  return Response.json({ error: { message, type, code: null, param: null } }, { status });
}
