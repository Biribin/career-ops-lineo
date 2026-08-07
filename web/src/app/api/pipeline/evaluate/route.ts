import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readInbox } from "@/lib/career-ops";
import { erreurOpenAi, executeLlm } from "@/lib/llm-runner";
import { parseFit, promptFit } from "@/lib/pipeline-fit.mjs";
import { planAnnonce, texteDepuisHtml } from "@/lib/annonce-source.mjs";

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

async function recupere(u: URL, accept: string): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    const r = await fetch(u, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (career-ops pipeline-fit)", accept },
    });
    return r.ok ? r : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Le texte de l'annonce, par le meilleur chemin disponible.
 *
 * D'ABORD l'API publique du tableau ATS quand il est reconnu. Un
 * `jobs.ashbyhq.com` est une application React : récupérer sa page rend une
 * coquille vide, et l'évaluation échouait en « annonce illisible » — constaté en
 * production le 2026-08-07. La même offre est parfaitement lisible par
 * `api.ashbyhq.com`, que `providers/ashby.mjs` interroge déjà pour la découvrir.
 *
 * ENSUITE la page, pour tout le reste (forum, pages statiques). Le repli sert
 * aussi quand l'API d'un ATS reconnu ne rend rien : un tableau peut avoir retiré
 * l'offre alors que la page existe encore.
 */
async function litAnnonce(brut: string): Promise<{ texte: string; via: string }> {
  const u = urlSure(brut);
  if (!u) return { texte: "", via: "url refusée" };

  const plan = planAnnonce(brut);
  if (plan) {
    const uApi = urlSure(plan.requete);
    const r = uApi ? await recupere(uApi, "application/json") : null;
    if (r) {
      try {
        const texte = texteDepuisHtml(plan.extrait(await r.json()));
        if (texte.length >= 200) return { texte, via: `api ${plan.ats}` };
      } catch {
        /* payload illisible : on retombe sur la page */
      }
    }
  }

  const r = await recupere(u, "text/html,*/*");
  if (!r) return { texte: "", via: plan ? `api ${plan.ats} muette, page injoignable` : "page injoignable" };
  const texte = texteDepuisHtml((await r.text()).slice(0, TAILLE_MAX));
  return { texte, via: plan ? `api ${plan.ats} muette, repli page` : "page" };
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

  const { texte: texteAnnonce, via } = await litAnnonce(url);
  // Sans le texte, il n'y a rien de plus a dire que ce que le score dit deja :
  // evaluer a l'aveugle produirait exactement le jugement sans fondement que ce
  // module existe pour eviter.
  if (!texteAnnonce || texteAnnonce.length < 200) {
    return Response.json(
      {
        error: `annonce illisible (${via}) : injoignable, vide, ou rendue par JavaScript`,
        offre,
        annonceLue: texteAnnonce.length,
        via,
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
      via,
      compte: r.compte,
    });
  } catch (e) {
    return erreurOpenAi(e instanceof Error ? e.message : "evaluation illisible", 502);
  }
}
