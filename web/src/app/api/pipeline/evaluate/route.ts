import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readInbox } from "@/lib/career-ops";
import { erreurOpenAi, executeLlm } from "@/lib/llm-runner";
import { parseFit, promptFit } from "@/lib/pipeline-fit.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Une lecture d'annonce plus un appel au modèle local. Même ordre de grandeur
// que /api/followup-draft.
export const maxDuration = 300;

/**
 * Évaluer UNE offre du pipeline, en lisant vraiment l'annonce.
 *
 *   POST { url }
 *   →    { verdict, resume, bloquants[], bloquantsNonVerifies[], atouts[],
 *          ecarts[], offre, annonceLue }
 *
 * POURQUOI : le classement du scan (`scan-rank.mjs`) ne regarde que l'intitulé,
 * le lieu et la date. Il ne lit jamais le corps de l'annonce et traite
 * « junior »/« senior » comme des mots vides. D'où le piège constaté le
 * 2026-08-07 : une offre notée 83/100 exigeait « 3 à 5 ans d'expérience », donc
 * inaccessible, et aucun réglage de mots-clés ne pouvait l'attraper — l'exigence
 * est dans le texte, pas dans le titre.
 *
 * Cette route est un filtre d'entrée, pas le mode `oferta` : elle ne produit ni
 * rapport, ni note sur 5, ni ligne de tracker. Elle répond à une seule question,
 * vite : est-ce que ça vaut le coup d'aller plus loin.
 *
 * L'URL est reçue du client mais l'offre est relue dans `data/pipeline.md` : ce
 * qui part au modèle vient du serveur, pas du navigateur — même discipline que
 * `/api/offers/decision`.
 */

const TAILLE_MAX = 800_000;
const DELAI_MS = 25_000;

/** Même garde-fou que /api/contact-lookup : l'URL vient d'une annonce
 *  extérieure, donc http(s) seulement et jamais vers une adresse interne. */
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
    /^\d+\.\d+\.\d+\.\d+$/.test(h) ||
    h.startsWith("[")
  ) {
    return null;
  }
  return u;
}

function texteDePage(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:nbsp|#160);/gi, " ")
    .replace(/&(?:amp|#38);/gi, "&")
    .replace(/&(?:quot|#34);/gi, '"')
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function litAnnonce(brut: string): Promise<string> {
  const u = urlSure(brut);
  if (!u) return "";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    const r = await fetch(u, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (career-ops pipeline-fit)", accept: "text/html,*/*" },
    });
    if (!r.ok) return "";
    return texteDePage((await r.text()).slice(0, TAILLE_MAX));
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

function profilCv(): string {
  for (const rel of ["cv.md", path.join("data", "perso", "cv.md")]) {
    try {
      const t = fs.readFileSync(path.join(careerOpsRoot(), rel), "utf8");
      if (t.trim()) return t;
    } catch {
      /* on essaie l'emplacement suivant */
    }
  }
  return "";
}

export async function POST(req: Request) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return erreurOpenAi("json invalide", 400, "invalid_request_error");
  }

  const url = String(body.url ?? "").trim();
  if (!url) return erreurOpenAi("url requise", 400, "invalid_request_error");

  const offre = readInbox().find((o) => String(o.url ?? "").trim() === url);
  if (!offre) {
    return erreurOpenAi(`offre introuvable dans le pipeline : ${url.slice(0, 200)}`, 404, "invalid_request_error");
  }

  const texteAnnonce = await litAnnonce(url);
  // Sans le texte, il n'y a rien de plus a dire que ce que le score dit deja :
  // evaluer a l'aveugle produirait exactement le jugement sans fondement que ce
  // module existe pour eviter.
  if (!texteAnnonce || texteAnnonce.length < 200) {
    return Response.json(
      {
        error: "annonce illisible : page injoignable, vide, ou rendue par JavaScript",
        offre,
        annonceLue: texteAnnonce.length,
      },
      { status: 422 },
    );
  }

  const r = await executeLlm(promptFit({ offre, texteAnnonce, profilCv: profilCv() }));
  if (!r.ok) return erreurOpenAi(r.message, r.status);

  try {
    return Response.json({
      ...parseFit(r.texte, texteAnnonce),
      offre,
      annonceLue: texteAnnonce.length,
      compte: r.compte,
    });
  } catch (e) {
    return erreurOpenAi(e instanceof Error ? e.message : "evaluation illisible", 502);
  }
}
