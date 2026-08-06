import { spawn } from "node:child_process";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { nettoieSortie, promptDepuisMessages, reponseChatCompletions } from "@/lib/openai-shim.mjs";

export const runtime = "nodejs"; // spawn => runtime Node
export const dynamic = "force-dynamic";
// Une adaptation de CV (le YAML complet dans le prompt) est longue. forum-judge
// plafonne à 120 s, ce qui suffit pour un jugement court mais pas ici.
export const maxDuration = 300;

// Shim OpenAI Chat Completions → CLI agentique local (Claude Code, abonnement Max).
//
// À BRANCHER AINSI dans n8n : sous-nœud « OpenAI Chat Model », avec
//   options.baseURL      = http://career-ops:3000/api/llm/v1
//   responsesApiEnabled  = false     (sinon le nœud appelle /responses, pas /chat/completions)
//
// Pourquoi le format OpenAI et pas Anthropic (comme forum-judge) : le sous-nœud
// « Anthropic Chat Model » de n8n n'expose pas de base URL — elle est dans la
// credential. Le sous-nœud OpenAI, si. C'est ce qui permet de migrer les 4 agents
// restants SANS toucher à un seul de leurs prompts ni de leurs parsers.
//
// Appelé par n8n en direct sur le réseau Docker : pas d'auth, rien d'exposé
// publiquement (le site public est derrière basic_auth côté Caddy). La clé API
// envoyée par le client OpenAI est donc ignorée — il n'y a pas d'API derrière.

const TIMEOUT_CLI_MS = 280_000;

type MsgOpenAi = { role?: string; content?: unknown };

export async function POST(req: Request) {
  let body: {
    messages?: MsgOpenAi[];
    model?: string;
    cliId?: string;
    stream?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: { message: "json invalide", type: "invalid_request_error" } }, { status: 400 });
  }

  // On ne sait pas streamer depuis un CLI headless. Le dire franchement plutôt
  // que de renvoyer un corps non-streamé qu'un client attendrait en SSE.
  if (body.stream === true) {
    return Response.json(
      { error: { message: "stream non supporté par ce shim : mettre stream=false", type: "invalid_request_error" } },
      { status: 400 },
    );
  }

  const prompt = promptDepuisMessages(body.messages);
  if (!prompt) {
    return Response.json(
      { error: { message: "messages requis (aucun contenu texte exploitable)", type: "invalid_request_error" } },
      { status: 400 },
    );
  }

  // Défaut claude = l'abonnement Max. Le modèle demandé par n8n est ignoré :
  // c'est le CLI qui décide, et on le dit dans la réponse pour ne pas laisser
  // croire que `model` a été honoré.
  const cliId = (body.cliId || "claude").trim();
  const resolved = resolveCli(cliId);
  if (!resolved) {
    return Response.json(
      { error: { message: `CLI '${cliId}' introuvable sur cette machine`, type: "server_error" } },
      { status: 503 },
    );
  }
  const { spec, binPath } = resolved;

  const isClaude = cliId === "claude";
  // Tous les outils coupés : le prompt contient déjà tout le contexte, le modèle
  // n'a qu'à répondre. Un agent qui se mettrait à lire des fichiers ou à faire
  // des recherches web ici serait à la fois lent et imprévisible.
  const args = isClaude
    ? [
        "-p",
        prompt,
        "--permission-mode",
        "acceptEdits",
        "--disallowedTools",
        "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch,Read,Glob,Grep",
      ]
    : spec.args(prompt);

  return new Promise<Response>((resolve) => {
    let child;
    try {
      child = spawn(binPath, args, { cwd: careerOpsRoot(), env: process.env });
    } catch (e) {
      resolve(
        Response.json(
          { error: { message: e instanceof Error ? e.message : "spawn a échoué", type: "server_error" } },
          { status: 500 },
        ),
      );
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
      resolve(Response.json({ error: { message: e.message, type: "server_error" } }, { status: 500 }));
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      const texte = nettoieSortie(out);
      if (!texte) {
        resolve(
          Response.json(
            {
              error: {
                message: err.trim() || `${spec.name} n'a rien renvoyé (code ${code})`,
                type: "server_error",
              },
            },
            { status: 502 },
          ),
        );
        return;
      }
      resolve(
        Response.json(
          reponseChatCompletions({
            texte,
            // Le vrai moteur, pas le modèle demandé : sinon les logs n8n
            // laisseraient croire qu'un modèle OpenAI a répondu.
            model: `career-ops-cli/${cliId}`,
            cree: Math.floor(Date.now() / 1000),
          }),
        ),
      );
    });
  });
}
