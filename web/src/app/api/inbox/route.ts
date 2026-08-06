import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Ajoute une (ou plusieurs) offre(s) à l'INBOX de l'app — le fichier
// `data/pipeline.md`, que `readInbox()` affiche dans la page pipeline de
// career-ops. L'offre apparaît donc VISUELLEMENT dans l'app, prête à être
// évaluée A–F / tailorée / candidatée / suivie — pas dans une table brute.
//
// Utilisé par le forum watcher n8n (offres pertinentes) POUR REMPLACER le mail :
// « tout dans l'app ». Format d'une ligne inbox (voir readInbox) :
//   - [ ] URL | Company | Role [| posted: YYYY-MM-DD] [| note: ...]
//
// Dédup par URL : jamais deux fois la même offre (2e barrière — le watcher
// déduplique déjà via sa data table). data/pipeline.md vit sur le volume
// persistant (/app/data) → survit aux redeploys.

type Offer = { url?: string; company?: string; role?: string; posted?: string; note?: string };

/** Aplatit : pas de retour-ligne ni de `|` (ils casseraient une ligne du tableau). */
function clean(v: unknown): string {
  return String(v ?? "")
    .replace(/[\r\n|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: Request) {
  let body: ({ offers?: Offer[] } & Offer) | null;
  try {
    body = (await req.json()) as ({ offers?: Offer[] } & Offer) | null;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const offers: Offer[] = body && Array.isArray(body.offers) ? body.offers : body ? [body] : [];
  if (!offers.length) return Response.json({ error: "aucune offre" }, { status: 400 });

  const file = path.join(careerOpsRoot(), "data", "pipeline.md");
  let md = "";
  try {
    md = fs.readFileSync(file, "utf8");
  } catch {
    md = "";
  }

  // URLs déjà présentes (colonne 0 de chaque ligne de checklist).
  const seen = new Set(
    md
      .split("\n")
      .map((l) => {
        const m = l.match(/^\s*-\s*\[[ xX]\]\s*([^|]+)/);
        return m ? m[1].trim() : "";
      })
      .filter(Boolean),
  );

  const added: string[] = [];
  let already = 0;
  const lignes: string[] = [];
  for (const o of offers) {
    const url = clean(o.url);
    if (!url) continue;
    if (seen.has(url)) {
      already++;
      continue;
    }
    seen.add(url);
    const company = clean(o.company) || "Forum n8n";
    const role = clean(o.role) || "Offre";
    let line = `- [ ] ${url} | ${company} | ${role}`;
    const posted = clean(o.posted);
    if (/^\d{4}-\d{2}-\d{2}$/.test(posted)) line += ` | posted: ${posted}`;
    const note = clean(o.note);
    if (note) line += ` | note: ${note}`;
    lignes.push(line);
    added.push(url);
  }

  if (lignes.length) {
    const base = md === "" || md.endsWith("\n") ? md : md + "\n";
    try {
      atomicWriteWithBackup(file, base + lignes.join("\n") + "\n");
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "écriture de data/pipeline.md impossible" }, { status: 500 });
    }
  }

  return Response.json({ added: added.length, already, urls: added });
}
