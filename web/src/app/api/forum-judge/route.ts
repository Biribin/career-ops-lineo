import { spawn } from "node:child_process";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs"; // spawn => runtime Node
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Jugement LLM sans état pour le forum watcher n8n (workflow iHpOWEC1nFUDsZ7T).
//
// SHIM COMPATIBLE ANTHROPIC (volontaire) : le nœud n8n envoie déjà un corps au
// format Messages API (`{model, max_tokens, system, messages:[{role,content}]}`)
// et le nœud « Lire le verdict » parse une réponse au format `{content:[{type,
// text}]}`. En imitant ces deux formats, le seul changement à faire dans le
// workflow est l'URL + l'auth du nœud HTTP — « Preparer appel Claude » et
// « Lire le verdict » restent INCHANGÉS. (On accepte aussi un simple `{prompt}`.)
//
// On exécute le CLI configuré (Claude Code sur l'abonnement Max = coût marginal
// nul, au lieu de l'API Anthropic facturée) en headless -p, SANS aucun outil
// (pur jugement texte). Derrière le basic_auth Caddy : n8n s'authentifie en Basic.

type AnthropicMsg = { role?: string; content?: unknown };

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
      .join("\n");
  }
  return "";
}

export async function POST(req: Request) {
  let body: { prompt?: string; cliId?: string; system?: string; messages?: AnthropicMsg[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  // Prompt explicite prioritaire ; sinon on reconstruit depuis system + messages.
  let prompt = (body.prompt || "").trim();
  if (!prompt) {
    const sys = (body.system || "").trim();
    const userText = (Array.isArray(body.messages) ? body.messages : [])
      .map((m) => contentToText(m?.content))
      .join("\n")
      .trim();
    prompt = [sys, userText].filter(Boolean).join("\n\n");
  }
  if (!prompt) return Response.json({ error: "prompt (ou system+messages) requis" }, { status: 400 });

  // Défaut = claude (abonnement Max) : ce watcher DOIT tourner sur le Max, pas
  // sur le Gemini par défaut du conteneur. Surchargeable via body.cliId.
  const cliId = (body.cliId || "claude").trim();
  const resolved = resolveCli(cliId);
  if (!resolved) return Response.json({ error: `CLI '${cliId}' introuvable sur cette machine` }, { status: 404 });
  const { spec, binPath } = resolved;

  const isClaude = cliId === "claude";
  // -p = print (réponse finale sur stdout, non interactif). Tous les outils
  // désactivés : le prompt contient déjà tout, le modèle n'a qu'à répondre.
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
      resolve(Response.json({ error: e instanceof Error ? e.message : "spawn a échoué" }, { status: 500 }));
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
    }, 100_000);
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve(Response.json({ error: e.message }, { status: 500 }));
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      const text = out.trim();
      if (text) {
        // Format de réponse Anthropic Messages → « Lire le verdict » le parse tel quel.
        resolve(Response.json({ content: [{ type: "text", text }] }));
      } else {
        resolve(Response.json({ error: err.trim() || `${spec.name} n'a rien renvoyé (code ${code})` }, { status: 502 }));
      }
    });
  });
}
