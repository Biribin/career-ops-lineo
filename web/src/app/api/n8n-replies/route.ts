import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite } from "@/lib/core/safe-write";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Store des réponses aux posts du forum n8n (module « Réponses n8n »). Isolé du
// reste (fichier + endpoint dédiés) pour ne pas croiser le pipeline/À-valider.
// Vit sur le volume (/app/data) → persiste aux redeploys.
//
// Flux (sans API forum, donc pas d'auto-post) : le bouton « Réponse » d'une carte
// n8n génère + ENREGISTRE le brouillon ici (statut "brouillon"). La page
// /reponses le liste : Copier -> coller sur le forum -> « Marqué posté »
// (statut "poste", date) -> relance suggérée après 7 j sans retour -> « Répondu ».

export type ReplyStatus = "brouillon" | "poste" | "repondu";
export type N8nReply = {
  url: string;
  titre: string;
  company: string;
  message: string;
  status: ReplyStatus;
  createdAt: string;
  postedAt?: string;
};

function storeFile(): string {
  return path.join(careerOpsRoot(), "data", "n8n-replies.json");
}

function readAll(): N8nReply[] {
  try {
    const j = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    return Array.isArray(j) ? (j as N8nReply[]) : [];
  } catch {
    return [];
  }
}

function writeAll(list: N8nReply[]): void {
  atomicWrite(storeFile(), JSON.stringify(list, null, 2));
}

export async function GET() {
  // Plus récents d'abord.
  const list = readAll().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return Response.json({ replies: list });
}

type Body = { action?: string; url?: string; titre?: string; company?: string; message?: string; status?: string };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const action = String(body.action || "save").trim();
  const url = String(body.url || "").trim();
  if (!url) return Response.json({ error: "url requise" }, { status: 400 });

  const now = new Date().toISOString();
  const list = readAll();
  const idx = list.findIndex((r) => r.url === url);

  if (action === "delete") {
    if (idx >= 0) list.splice(idx, 1);
    writeAll(list);
    return Response.json({ ok: true, deleted: idx >= 0 });
  }

  if (action === "status") {
    if (idx < 0) return Response.json({ error: "réponse introuvable" }, { status: 404 });
    const next = String(body.status || "").trim() as ReplyStatus;
    if (!["brouillon", "poste", "repondu"].includes(next)) return Response.json({ error: "statut invalide" }, { status: 400 });
    list[idx].status = next;
    if (next === "poste" && !list[idx].postedAt) list[idx].postedAt = now;
    if (next === "brouillon") list[idx].postedAt = undefined;
    writeAll(list);
    return Response.json({ ok: true, reply: list[idx] });
  }

  // action "save" (défaut) : crée/actualise un brouillon.
  const message = String(body.message || "").trim();
  if (!message) return Response.json({ error: "message requis" }, { status: 400 });
  const titre = String(body.titre || "").trim().replace(/^\[\d+\/10\]\s*/, "");
  const company = String(body.company || "").trim();

  if (idx >= 0) {
    // Ne pas écraser un statut avancé : on met juste à jour le texte du brouillon.
    list[idx].message = message;
    if (titre) list[idx].titre = titre;
    if (company) list[idx].company = company;
  } else {
    list.push({ url, titre, company, message, status: "brouillon", createdAt: now });
  }
  writeAll(list);
  return Response.json({ ok: true });
}
