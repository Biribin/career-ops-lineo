import { spawn } from "node:child_process";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs"; // spawn => runtime Node
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Jugement LLM sans état pour le forum watcher n8n (workflow iHpOWEC1nFUDsZ7T).
//
// SHIM COMPATIBLE ANTHROPIC (volontaire) : le nœud n8n envoie un corps au format
// Messages API (`{system, messages}`) et « Lire le verdict » parse `{content:
// [{type,text}]}`. En imitant ces formats, seul l'URL + l'auth du nœud change.
// (On accepte aussi un simple `{prompt}`.)
//
// FAILOVER 2 COMPTES MAX : on lance Claude Code avec CLAUDE_CODE_OAUTH_TOKEN
// (compte 1). Si la réponse est un message de limite d'abonnement, on RELANCE
// avec CLAUDE_CODE_OAUTH_TOKEN_2 (compte 2). Si les deux sont limités → 429 pour
// que n8n retente plus tard SANS marquer le sujet vu (offre pas perdue).

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

// Messages « quota atteint » des CLI (Claude Code surtout). Court + spécifique
// pour ne pas confondre avec un vrai verdict JSON.
const LIMIT_RE = /hit your (session|usage) limit|approaching your (session|usage) limit|usage limit reached|rate.?limit(ed)?|resets? (at )?\d{1,2}(:\d{2})?\s*(am|pm)/i;
function isLimited(text: string): boolean {
  return !!text && text.length < 400 && LIMIT_RE.test(text);
}

type CliResult = { text: string; err: string; code: number | null };

function runCli(binPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<CliResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(binPath, args, { cwd: careerOpsRoot(), env });
    } catch (e) {
      resolve({ text: "", err: e instanceof Error ? e.message : "spawn a échoué", code: -1 });
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
      resolve({ text: "", err: e.message, code: -1 });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ text: out.trim(), err: err.trim(), code });
    });
  });
}

export async function POST(req: Request) {
  let body: { prompt?: string; cliId?: string; system?: string; messages?: AnthropicMsg[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

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

  // Défaut = claude (Max) ; ce watcher DOIT tourner sur le Max, pas sur le gemini
  // par défaut du conteneur. Surchargeable via body.cliId.
  const cliId = (body.cliId || "claude").trim();
  const resolved = resolveCli(cliId);
  if (!resolved) return Response.json({ error: `CLI '${cliId}' introuvable sur cette machine` }, { status: 404 });
  const { spec, binPath } = resolved;

  const isClaude = cliId === "claude";
  const args = isClaude
    ? ["-p", prompt, "--permission-mode", "acceptEdits", "--disallowedTools", "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch,Read,Glob,Grep"]
    : spec.args(prompt);

  // Essai 1 : compte par défaut (CLAUDE_CODE_OAUTH_TOKEN).
  let r = await runCli(binPath, args, process.env);
  let tokenUtilise = "1";

  // Essai 2 : bascule sur le compte 2 si le 1er est rate-limited (claude only).
  const token2 = process.env.CLAUDE_CODE_OAUTH_TOKEN_2;
  if (isClaude && token2 && isLimited(r.text)) {
    tokenUtilise = "2";
    r = await runCli(binPath, args, { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token2 });
  }

  // Les deux comptes limités (ou le seul dispo) → 429 : n8n retente plus tard,
  // le sujet n'est PAS marqué vu, l'offre n'est pas perdue.
  if (isLimited(r.text)) {
    return Response.json({ error: `CLI rate-limited (token(s) épuisé(s)): ${r.text}` }, { status: 429 });
  }
  if (r.text) {
    return new Response(JSON.stringify({ content: [{ type: "text", text: r.text }] }), {
      status: 200,
      headers: { "Content-Type": "application/json", "X-Career-Ops-Token": tokenUtilise },
    });
  }
  return Response.json({ error: r.err || `${spec.name} n'a rien renvoyé (code ${r.code})` }, { status: 502 });
}
