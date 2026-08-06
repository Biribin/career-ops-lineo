import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Génère un BROUILLON de réponse à une offre (message d'approche / candidature),
// via le CLI configuré (Claude Code sur le Max = coût marginal nul). Lit l'offre
// (WebFetch de l'URL) + le CV de Lineo, et rédige en français, dans SON style :
// pas de tiret cadratin, pas de markdown. Failover 2 comptes Max comme
// /api/forum-judge. Appelé par le bouton « Générer une réponse » de la carte.

const LIMIT_RE = /hit your (session|usage) limit|approaching your (session|usage) limit|usage limit reached|rate.?limit(ed)?|resets? (at )?\d{1,2}(:\d{2})?\s*(am|pm)/i;
const isLimited = (t: string) => !!t && t.length < 400 && LIMIT_RE.test(t);

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
    }, 240_000);
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
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

function readIf(rel: string, max: number): string {
  try {
    return fs.readFileSync(path.join(careerOpsRoot(), rel), "utf8").slice(0, max);
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  let body: { url?: string; company?: string; role?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const url = (body.url || "").trim();
  const company = (body.company || "").trim();
  const role = (body.role || "").trim().replace(/^\[\d+\/10\]\s*/, ""); // retire le badge [x/10]
  if (!url && !role) return Response.json({ error: "url ou role requis" }, { status: 400 });

  const cv = readIf("cv.md", 8000);

  const prompt = [
    "Tu rédiges, au nom de Linéo Biribin, un BROUILLON de réponse à une offre repérée (message d'approche pour candidater / se proposer).",
    url ? `OFFRE (lis la page pour le contexte) : ${url}` : "",
    company ? `Entreprise / auteur : ${company}` : "",
    role ? `Intitulé : ${role}` : "",
    body.note ? `Note interne : ${body.note}` : "",
    "",
    cv ? `CV de Linéo (pour ancrer le message sur des faits réels, ne rien inventer) :\n${cv}` : "",
    "",
    "CONSIGNES DE RÉDACTION (impératives) :",
    "- En français, ton professionnel et chaleureux, vouvoiement.",
    "- Court : 120 à 180 mots. Direct, concret, orienté valeur pour l'entreprise.",
    "- Accroche personnalisée à l'offre, 2-3 preuves de fit tirées du CV, un appel à échanger.",
    "- INTERDIT : le tiret cadratin « — » (utilise une virgule, un point ou des parenthèses). INTERDIT : le markdown (pas de **gras**, pas de #, pas de puces markdown).",
    "- Ne rien inventer (pas de fausse ancienneté, pas de diplôme fictif).",
    "- Renvoie UNIQUEMENT le texte du message, sans préambule ni commentaire.",
  ]
    .filter(Boolean)
    .join("\n");

  const cliId = "claude";
  const resolved = resolveCli(cliId);
  if (!resolved) return Response.json({ error: `CLI '${cliId}' introuvable` }, { status: 404 });
  const { spec, binPath } = resolved;

  // WebFetch autorisé (lire l'offre) ; pas d'écriture.
  const args = [
    "-p",
    prompt,
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    "WebFetch,WebSearch,Read",
    "--disallowedTools",
    "Bash,Write,Edit,NotebookEdit,Task",
  ];

  let r = await runCli(binPath, args, process.env);
  const token2 = process.env.CLAUDE_CODE_OAUTH_TOKEN_2;
  if (token2 && isLimited(r.text)) {
    r = await runCli(binPath, args, { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: token2 });
  }

  if (isLimited(r.text)) return Response.json({ error: `Max limité (2 comptes) : ${r.text}` }, { status: 429 });
  if (r.text) return Response.json({ text: r.text });
  return Response.json({ error: r.err || `${spec.name} n'a rien renvoyé (code ${r.code})` }, { status: 502 });
}
