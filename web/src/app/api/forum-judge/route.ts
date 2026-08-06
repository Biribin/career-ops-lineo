import { spawn } from "node:child_process";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs"; // spawn => runtime Node
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Jugement LLM sans état pour le forum watcher n8n (workflow iHpOWEC1nFUDsZ7T).
// n8n envoie un prompt déjà formé (profil + consigne + offre) ; on le passe au
// CLI configuré (Claude Code sur l'abonnement Max = coût marginal nul, au lieu
// de l'API Anthropic facturée) en headless, SANS aucun outil (pur jugement
// texte : aucune raison de lire des fichiers ou d'aller sur le web), et on
// renvoie le texte brut du modèle. NON streamé : n8n veut une réponse simple.
//
// Sécurité : l'app entière est derrière le basic_auth Caddy — n8n doit donc
// s'authentifier (credential Basic Auth côté n8n). Pas d'exposition publique de
// cette route (elle lance un process sur le quota Max).
export async function POST(req: Request) {
  let body: { prompt?: string; cliId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const prompt = (body.prompt || "").trim();
  const cliId = (body.cliId || process.env.CAREER_OPS_CLI || "claude").trim();
  if (!prompt) return Response.json({ error: "prompt requis" }, { status: 400 });

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
        resolve(Response.json({ text }));
      } else {
        resolve(Response.json({ error: err.trim() || `${spec.name} n'a rien renvoyé (code ${code})` }, { status: 502 }));
      }
    });
  });
}
