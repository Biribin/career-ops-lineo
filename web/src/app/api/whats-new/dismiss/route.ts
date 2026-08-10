import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Écarter une offre remontée par un scan gratuit.
//
// Aucun stockage nouveau : GET /api/whats-new ignore DÉJÀ toute ligne dont la colonne
// `status` vaut `skipped` ou `expired`. Écarter revient donc simplement à écrire
// `skipped` dans cette colonne, et l'offre ne reviendra plus, même si une prochaine
// tournée la retrouve.
//
// Colonnes : url, first_seen, portal, title, company, status, location
const ENTETE = "url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation";
const COL_URL = 0;
const COL_STATUS = 5;

type Corps = { url?: string; portal?: string; title?: string; company?: string; location?: string };

export async function POST(req: Request) {
  let corps: Corps;
  try {
    corps = (await req.json()) as Corps;
  } catch {
    return Response.json({ error: "corps JSON illisible" }, { status: 400 });
  }

  const url = (corps.url || "").trim();
  if (!/^https?:\/\//i.test(url)) {
    return Response.json({ error: "url manquante ou invalide" }, { status: 400 });
  }

  const fichier = path.join(careerOpsRoot(), "data", "scan-history.tsv");
  let lignes: string[];
  try {
    lignes = fs.readFileSync(fichier, "utf8").split("\n");
  } catch {
    lignes = [ENTETE];
  }
  if (!lignes[0] || !lignes[0].startsWith("url\t")) lignes.unshift(ENTETE);

  // 1) l'offre est déjà dans l'historique : on marque la ou les lignes
  let marquees = 0;
  for (let i = 1; i < lignes.length; i++) {
    if (!lignes[i].trim()) continue;
    const c = lignes[i].split("\t");
    if ((c[COL_URL] || "").trim() !== url) continue;
    while (c.length <= COL_STATUS) c.push("");
    c[COL_STATUS] = "skipped";
    lignes[i] = c.join("\t");
    marquees++;
  }

  // 2) elle n'y est pas (résultat d'un scan en direct côté /explore) : on l'ajoute
  // déjà écartée, sinon le prochain scan la ferait réapparaître comme neuve.
  if (marquees === 0) {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const propre = (s?: string) => (s || "").replace(/[\t\r\n]+/g, " ").trim();
    lignes.push(
      [url, aujourdhui, propre(corps.portal) || "other", propre(corps.title), propre(corps.company), "skipped", propre(corps.location)].join("\t"),
    );
  }

  // Écriture par fichier temporaire puis renommage : un scan qui tournerait en même
  // temps ne peut pas tomber sur un fichier à moitié écrit. La fenêtre de course
  // reste théoriquement ouverte (un ajout fait entre la lecture et le renommage
  // serait perdu), mais un clic manuel face à une tournée planifiée est improbable,
  // et le coût d'un vrai verrou ne se justifie pas pour une colonne d'état.
  const tmp = `${fichier}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(tmp, lignes.join("\n").replace(/\n+$/, "") + "\n", "utf8");
  fs.renameSync(tmp, fichier);

  return Response.json({ ok: true, url, marquees, ajoutee: marquees === 0 });
}
