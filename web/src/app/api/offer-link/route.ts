import { pipelineSummary } from "@/lib/career-ops";
import { resoudreLien } from "@/lib/lien-annonce.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Le lien d'une annonce pour une ligne du tracker, qui n'en porte pas.
//
//   GET /api/offer-link?company=…&role=…
//   →   { url, certitude: "exacte" | "recherche", ambigu, nbCandidats }
//
// Les candidates viennent de data/pipeline.md (l'inbox du scanner), où l'URL
// existe encore, plus les offres rapportées par n8n (/api/offers), qui la
// conservent aussi. On ne rend une URL « exacte » que si la correspondance est
// certaine : une mauvaise URL sur une candidature est pire que pas d'URL.

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const company = (p.get("company") || "").trim();
  const role = (p.get("role") || "").trim();
  if (!company && !role) {
    return Response.json({ error: "company ou role requis" }, { status: 400 });
  }

  // L'inbox du scanner : c'est là que l'URL vit avant d'être perdue.
  let candidats: Array<{ company?: string; role?: string; url?: string }> = [];
  try {
    candidats = pipelineSummary().inbox.map((j) => ({ company: j.company, role: j.role, url: j.url }));
  } catch {
    candidats = [];
  }

  return Response.json(resoudreLien({ company, role }, candidats));
}
