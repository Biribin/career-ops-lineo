import { spawn } from "node:child_process";
import fs from "node:fs";
import { cvRepoRoot, inboxDir, journalPath } from "@/lib/n8n-decisions";
import { fichesEnAttente } from "@/lib/n8n-decisions.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liste les candidatures que n8n a préparées et qui attendent une décision.
// Lecture seule : lit le clone local du repo cv + le journal local. Le `?sync=1`
// tire d'abord les nouvelles fiches (git pull --ff-only) — c'est le seul moment
// où cette route touche le réseau, et c'est toujours à la demande de Linéo.

function gitPull(cwd: string): Promise<{ ok: boolean; sortie: string }> {
  return new Promise((resolve) => {
    let sortie = "";
    let child;
    try {
      child = spawn("git", ["-C", cwd, "pull", "--ff-only"], { env: process.env });
    } catch (e) {
      resolve({ ok: false, sortie: e instanceof Error ? e.message : "git introuvable" });
      return;
    }
    const capte = (d: Buffer) => {
      sortie += d.toString();
    };
    child.stdout.on("data", capte);
    child.stderr.on("data", capte);
    const killer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, 30_000);
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ ok: false, sortie: e.message });
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      resolve({ ok: code === 0, sortie: sortie.trim() });
    });
  });
}

export async function GET(req: Request) {
  const sync = new URL(req.url).searchParams.get("sync") === "1";
  const racine = cvRepoRoot();
  const repoPresent = fs.existsSync(racine);

  let pull: { ok: boolean; sortie: string } | null = null;
  if (sync && repoPresent) pull = await gitPull(racine);

  return Response.json({
    fiches: repoPresent ? fichesEnAttente(inboxDir(), journalPath()) : [],
    repo: { racine, present: repoPresent, inbox: inboxDir() },
    pull,
  });
}
