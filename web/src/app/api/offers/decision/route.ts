import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { ligneDecision, offreComplete, parseJournal } from "@/lib/offers-store.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Déclencher le workflow 2 est immédiat (n8n répond onReceived puis travaille en
// arrière-plan), mais le réseau Docker peut être lent au réveil du conteneur.
export const maxDuration = 60;

/**
 * Les DEUX seules décisions possibles sur une offre découverte par n8n.
 *
 *   POST { jobId, action: "generer" | "ecarter" }
 *
 * - `ecarter` : Linéo n'en veut pas. La ligne part au journal et l'offre ne
 *   revient JAMAIS, même si la tournée du lendemain la repose (cf. le balayage
 *   des statuts classants dans offers-store.mjs).
 * - `generer` : on passe la main au workflow 2, qui rédige lettre + CV et dépose
 *   la fiche dans « À valider ». L'offre quitte cette file — elle vit désormais
 *   là-bas.
 *
 * L'ORDRE COMPTE : on n'écrit `GENEREE` qu'APRÈS que n8n a accusé réception. Si
 * on écrivait avant, un n8n injoignable ferait disparaître l'offre de la file
 * sans que rien ne soit rédigé : elle serait perdue des deux côtés, en silence.
 * Une offre encore là après un échec est le bon sens d'erreur — Linéo réessaie.
 *
 * Le client n'envoie qu'un `jobId` : le contenu de l'offre est relu ici, dans le
 * journal. Ce qui part chez n8n vient donc du serveur, pas du navigateur.
 */

const N8N_DEFAUT = "https://n8n.balzac-info.online";
const CHEMIN_WF2 = "/webhook/candidature-generer";

function journalPath(): string {
  return path.join(careerOpsRoot(), "data", "offres-n8n.jsonl");
}

type LigneOffre = {
  jobId?: string;
  title?: string;
  company?: string;
  description?: string;
  url?: string;
  location?: string;
  whyMatch?: string;
  score?: number | null;
};

function ajouteAuJournal(ligne: Record<string, unknown>): string | null {
  const p = journalPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(ligne) + "\n", "utf8");
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "écriture du journal impossible";
  }
}

export async function POST(req: Request) {
  let corps: { jobId?: string; action?: string };
  try {
    corps = await req.json();
  } catch {
    return Response.json({ error: "json invalide" }, { status: 400 });
  }

  const jobId = String(corps.jobId ?? "").trim();
  const action = String(corps.action ?? "").trim().toLowerCase();
  if (!jobId) return Response.json({ error: "jobId requis" }, { status: 400 });
  if (action !== "generer" && action !== "ecarter") {
    return Response.json({ error: `action inconnue : ${action || "(vide)"}` }, { status: 400 });
  }

  const quand = new Date().toISOString();
  const ligne = ligneDecision(jobId, action, quand);
  if (!ligne) return Response.json({ error: "décision inexploitable" }, { status: 400 });

  // ── Écarter : rien à appeler, on inscrit et c'est fini ────────────────────
  if (action === "ecarter") {
    const err = ajouteAuJournal(ligne);
    if (err) return Response.json({ error: err }, { status: 500 });
    return Response.json({ ok: true, jobId, statut: "ECARTEE" });
  }

  // ── Générer : il faut le contenu de l'offre, et n8n doit accuser réception ─
  let journal: Record<string, unknown>[] = [];
  try {
    journal = parseJournal(fs.readFileSync(journalPath(), "utf8"));
  } catch {
    return Response.json({ error: "journal des offres introuvable" }, { status: 404 });
  }

  const offre = offreComplete(journal, jobId) as LigneOffre | null;
  if (!offre) {
    return Response.json({ error: `offre ${jobId} introuvable dans le journal` }, { status: 404 });
  }

  const base = (process.env.N8N_BASE_URL?.trim() || N8N_DEFAUT).replace(/\/+$/, "");
  const url = `${base}${CHEMIN_WF2}`;
  // La forme attendue par « 🧩 Offre recue » du workflow 2 : { mode, job }.
  const charge = {
    mode: "nouvelle",
    declenche_par: "career-ops-web",
    at: quand,
    job: {
      jobId: offre.jobId ?? jobId,
      title: offre.title ?? "",
      company: offre.company ?? "",
      description: offre.description ?? "",
      url: offre.url ?? "",
      location: offre.location ?? "",
      whyMatch: offre.whyMatch ?? "",
      score: offre.score ?? null,
    },
  };

  let rep: Response;
  try {
    rep = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(charge),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "appel au workflow 2 impossible", url },
      { status: 502 },
    );
  }

  if (!rep.ok) {
    // Même piège que pour « Lancer la recherche » : un nœud Webhook ne répond
    // qu'en production, donc sur un workflow ACTIF. Le dire ici évite de
    // chercher longtemps pourquoi le bouton « ne fait rien ».
    const explication =
      rep.status === 404
        ? "n8n a répondu 404 : le workflow « 2. Generation lettre + CV » est-il ACTIVÉ ? Un nœud Webhook ne répond pas sur un workflow désactivé."
        : `n8n a répondu ${rep.status}`;
    return Response.json({ error: explication, url }, { status: 502 });
  }

  const err = ajouteAuJournal(ligne);
  if (err) {
    // La rédaction est lancée : le dire, même si la trace n'a pas pu s'écrire.
    // L'offre restera affichée, ce qui est gênant mais pas destructeur — alors
    // qu'un faux échec ferait relancer une génération déjà en cours.
    return Response.json(
      { ok: true, jobId, statut: "GENEREE", avertissement: `génération lancée, mais le journal n'a pas pu être écrit : ${err}` },
      { status: 200 },
    );
  }

  return Response.json({
    ok: true,
    jobId,
    statut: "GENEREE",
    message: "génération lancée — la fiche arrivera dans « À valider » dans quelques minutes",
  });
}
