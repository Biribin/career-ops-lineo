import { spawn } from "node:child_process";
import { journalPath } from "@/lib/n8n-decisions";
import { fichesEnAttenteDepuis, lireJournal } from "@/lib/n8n-decisions.mjs";
import { lireInbox } from "@/lib/cv-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liste les candidatures que n8n a préparées et qui attendent une décision.
// Lecture seule. Deux sources possibles (cf. cv-inbox.ts) :
//   - clone local du repo cv  → `?sync=1` fait un git pull --ff-only ;
//   - API GitHub (conteneur)  → chaque lecture est déjà fraîche, il n'y a rien
//     à tirer, et `?sync=1` le dit au lieu de ne rien faire en silence.
// Le journal des décisions reste local dans les deux cas : c'est une donnée
// career-ops, pas une donnée du repo cv.

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
  const source = await lireInbox();

  // En mode local le pull est ce qui fait descendre les nouvelles fiches. En
  // mode GitHub il n'y a rien à tirer : on renvoie quand même un `pull` non-null
  // pour que le bouton ne paraisse pas inerte, avec la raison exacte.
  let pull: { ok: boolean; sortie: string } | null = null;
  if (sync) {
    if (source.mode === "local") {
      pull = source.repo.present
        ? await gitPull(source.repo.racine)
        : { ok: false, sortie: `rien à tirer : ${source.erreur ?? "clone absent"}` };
    } else {
      pull = { ok: source.erreur === null, sortie: source.erreur ?? "lecture directe via l'API GitHub : déjà à jour" };
    }
  }

  return Response.json({
    fiches: fichesEnAttenteDepuis(source.fiches, lireJournal(journalPath())),
    repo: source.repo,
    mode: source.mode,
    origine: source.origine,
    erreur: source.erreur,
    tronquees: source.tronquees,
    illisibles: source.illisibles,
    pull,
  });
}
