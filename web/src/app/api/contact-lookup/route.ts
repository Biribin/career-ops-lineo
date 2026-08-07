import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { choisitContact, parseCarnet } from "@/lib/contact-lookup.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Trouver le courriel du recruteur, ou dire honnêtement qu'il n'y en a pas.
 *
 *   POST { entreprise, urlOffre?, description? }
 *   →    { courriel, source, confiance, motif, candidats, sourcesConsultees }
 *
 * POURQUOI : les offres France Travail ne portent aucune adresse (vérifié le
 * 2026-08-07 : le champ n'existe pas dans les 6 offres du journal, et la page
 * d'une annonce rendue fait 55 Ko sans une seule adresse). Sans cette route, le
 * workflow 3 envoie TOUJOURS en dépôt manuel et sa branche d'envoi ne sert
 * jamais.
 *
 * LA RÈGLE : on ne devine pas. Toute adresse rendue a été lue littéralement
 * dans le carnet d'adresses ou dans le texte de l'annonce — jamais composée à
 * partir d'un nom de domaine. `courriel: null` est un résultat correct : le
 * workflow 3 retombe alors sur le dépôt manuel, qui marche déjà.
 *
 * Cette route ne DÉCIDE pas d'envoyer. Elle répond à une question ; c'est
 * l'aiguillage du workflow 3 qui tranche, et lui seul.
 */

const TAILLE_MAX = 800_000; // au-delà, c'est une page qu'on ne veut pas charger
const DELAI_MS = 20_000;

function nettoie(v: unknown, max: number): string {
  return String(v ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

/**
 * L'URL vient d'une fiche produite par n8n, elle-même issue d'une offre
 * extérieure : on ne la suit qu'en http(s) et jamais vers une adresse interne.
 * Sans ce garde-fou, une offre malveillante ferait de cette route un proxy vers
 * le réseau privé du VPS (Coolify, Postgres, n8n sont tous à portée).
 */
function urlSure(brut: string): URL | null {
  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const h = u.hostname.toLowerCase();
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".internal") ||
    h.endsWith(".local") ||
    /^\d+\.\d+\.\d+\.\d+$/.test(h) || // pas d'IP littérale : rien de légitime n'en publie
    h.startsWith("[") // IPv6 littérale
  ) {
    return null;
  }
  return u;
}

/** Le texte visible d'une page, sans balises ni scripts. */
function texteDePage(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&(?:amp|#38);/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function litAnnonce(brut: string): Promise<{ texte: string; note: string }> {
  const u = urlSure(brut);
  if (!u) return { texte: "", note: `URL d'annonce ignorée (non http(s) ou adresse interne) : ${brut.slice(0, 120)}` };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    const r = await fetch(u, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (career-ops contact-lookup)", accept: "text/html,*/*" },
    });
    if (!r.ok) return { texte: "", note: `annonce injoignable (HTTP ${r.status})` };
    const brutHtml = (await r.text()).slice(0, TAILLE_MAX);
    // Les adresses sont cherchées dans le HTML brut ET dans le texte visible :
    // un `mailto:` vit dans un attribut, que le détourage effacerait.
    return { texte: `${brutHtml}\n${texteDePage(brutHtml)}`, note: `annonce lue (${brutHtml.length} o)` };
  } catch (e) {
    return { texte: "", note: `annonce illisible : ${e instanceof Error ? e.message : "erreur"}` };
  } finally {
    clearTimeout(t);
  }
}

export async function POST(req: Request) {
  let body: { entreprise?: string; urlOffre?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "json invalide" }, { status: 400 });
  }

  const entreprise = nettoie(body.entreprise, 120);
  if (!entreprise) return Response.json({ error: "entreprise requise" }, { status: 400 });

  const urlOffre = String(body.urlOffre ?? "").trim();
  const description = String(body.description ?? "").slice(0, 100_000);

  const sourcesConsultees: string[] = [];

  // 1. Le carnet d'adresses. Absent = normal, pas une panne.
  let carnet: ReturnType<typeof parseCarnet> = [];
  const cheminCarnet = path.join(careerOpsRoot(), "data", "contacts.tsv");
  try {
    carnet = parseCarnet(fs.readFileSync(cheminCarnet, "utf8"));
    sourcesConsultees.push(`carnet (${carnet.length} contacts)`);
  } catch {
    sourcesConsultees.push("carnet absent");
  }

  // 2. Les textes. La description est gratuite ; la page ne se charge que si le
  //    carnet n'a rien donné, pour ne pas payer un aller-retour réseau inutile.
  const textes: string[] = [];
  if (description) {
    textes.push(description);
    sourcesConsultees.push("description de l'offre");
  }

  const parCarnet = choisitContact({ carnet, textes, entreprise });
  if (parCarnet.source === "carnet") {
    return Response.json({ ...parCarnet, sourcesConsultees });
  }

  if (urlOffre) {
    const { texte, note } = await litAnnonce(urlOffre);
    sourcesConsultees.push(note);
    if (texte) textes.push(texte);
  }

  return Response.json({ ...choisitContact({ carnet, textes, entreprise }), sourcesConsultees });
}
