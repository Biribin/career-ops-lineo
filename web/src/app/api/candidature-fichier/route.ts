import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { lireInbox } from "@/lib/cv-inbox";
import { cvRepoRoot } from "@/lib/n8n-decisions";
import { enteteTelechargement, resoudFichierCandidature, urlContenuGitHub } from "@/lib/candidature-fichier.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sert le CV ou la lettre d'une candidature EN TELECHARGEMENT, depuis l'app.
//
// POURQUOI. La fiche n8n porte des liens `github.com/Biribin/cv/blob/<branche>/…`
// que Lineo ne peut pas utiliser : `/blob/` est une page et non un fichier, le
// depot est prive donc il faut une session GitHub, et le nom de branche contient
// une barre oblique qui rend l'URL ambigue. Ici le serveur va chercher le blob
// avec le jeton qui lit deja l'inbox, et le renvoie avec un
// `Content-Disposition: attachment`. Lineo clique, le fichier arrive.
//
// Deux sources, comme pour les fiches : le clone local quand il existe (poste de
// Lineo), l'API contents sinon (conteneur sur le VPS).
//
// GET /api/candidature-fichier?id=<id de fiche>&type=cv|lettre
export async function GET(req: NextRequest) {
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  const type = (req.nextUrl.searchParams.get("type") ?? "").trim();
  if (!id) return new Response("id requis", { status: 400 });

  const inbox = await lireInbox();
  if (inbox.erreur) {
    return new Response(`inbox illisible : ${inbox.erreur}`, { status: 502 });
  }
  const fiche = inbox.fiches.find((f) => String(f.id) === id) ?? null;

  const r = resoudFichierCandidature({ fiche, type });
  if (!r.ok) return new Response(r.motif, { status: r.statut });

  const entetes = {
    "Content-Type": r.mime,
    "Content-Disposition": enteteTelechargement(r.nom),
    // Un CV regenere a la meme URL : ne jamais servir l'ancien depuis un cache.
    "Cache-Control": "no-store",
  };

  // Mode local : le fichier est sur le disque, dans le clone du repo cv. On ne
  // peut pas lire une branche depuis le disque sans git, donc on sert l'arbre
  // courant — c'est la disposition du poste de Lineo, ou n8n pousse et il tire.
  if (inbox.mode === "local") {
    const abs = path.join(cvRepoRoot(), r.chemin);
    if (!abs.startsWith(cvRepoRoot())) return new Response("chemin refusé", { status: 400 });
    if (!fs.existsSync(abs)) {
      return new Response(`fichier absent du clone local : ${r.chemin}`, { status: 404 });
    }
    return new Response(new Uint8Array(fs.readFileSync(abs)), { headers: entetes });
  }

  const owner = process.env.CV_REPO_OWNER?.trim() || "Biribin";
  const repo = process.env.CV_REPO_NAME?.trim() || "cv";
  const token = process.env.CV_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || "";
  if (!token) return new Response("CV_GITHUB_TOKEN manquant : impossible de lire un dépôt privé", { status: 503 });

  let amont: Response;
  try {
    amont = await fetch(urlContenuGitHub({ owner, repo, chemin: r.chemin, branche: r.branche }), {
      headers: {
        // `raw` rend les octets du fichier, pas le JSON qui les enveloppe.
        Accept: "application/vnd.github.raw",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "career-ops-web",
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch (e) {
    return new Response(`API GitHub injoignable : ${e instanceof Error ? e.message : String(e)}`, { status: 502 });
  }

  // Un 404 ici a une cause tres concrete et utile a dire : la branche de la
  // candidature a ete supprimee. C'est le cas de fiches restees « à valider »
  // apres un nettoyage de branches.
  if (amont.status === 404) {
    return new Response(
      `introuvable sur GitHub : ${r.chemin} sur la branche ${r.branche}. ` +
        `La branche a probablement été supprimée : il faut régénérer la candidature.`,
      { status: 404 },
    );
  }
  if (!amont.ok) {
    return new Response(`GitHub a répondu ${amont.status} pour ${r.chemin}`, { status: 502 });
  }

  return new Response(await amont.arrayBuffer(), { headers: entetes });
}
