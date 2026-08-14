import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { erreurOpenAi, executeLlm } from "@/lib/llm-runner";
import { parseRelance, promptRelance } from "@/lib/followup-draft.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Rédaction d'UNE relance de candidature, pour le workflow 3 (envoi).
//
//   POST { relance: {entreprise, poste, joursDepuisEnvoi, envoyeeLe, urlOffre, rang, relanceMax, candidat}, consigne? }
//   →    { objet, corps, mots, compte }
//
// Symétrique de POST /api/letter, et pour la même raison : c'est un texte qui
// part chez un recruteur, donc il appartient à career-ops et pas à un prompt
// écrit dans n8n.
//
// CE QUE CETTE ROUTE NE FAIT PAS : décider s'il faut relancer. La cadence
// (délai, nombre maxi) vient de followup-cadence.mjs, exposée par
// /api/followups?full=1. Un second calcul ici serait une seconde vérité.

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

/**
 * Le nom du candidat, depuis config/profile.yml. Le prompt demande de signer du
 * SEUL nom du candidat : sans lui il écrit « le candidat » en signature, et une
 * relance signée « le candidat » part chez un recruteur. L'appelant peut
 * toujours l'imposer (`relance.candidat`) — ceci n'est qu'un repli.
 * Un profile.yml absent est normal (tous les clones n'en ont pas) : repli muet.
 */
function nomCandidat(): string {
  try {
    const profil = yaml.load(fs.readFileSync(path.join(careerOpsRoot(), "config", "profile.yml"), "utf8")) as
      | { candidate?: { full_name?: string } }
      | undefined;
    return String(profil?.candidate?.full_name ?? "").trim();
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  let body: { relance?: Record<string, unknown>; consigne?: string };
  try {
    body = await req.json();
  } catch {
    return erreurOpenAi("json invalide", 400, "invalid_request_error");
  }

  const relance = body.relance ?? {};
  if (!String(relance.entreprise ?? "").trim()) {
    return erreurOpenAi("relance.entreprise requise : sans elle, la relance ne sait pas de quoi elle parle", 400, "invalid_request_error");
  }

  const prompt = promptRelance({
    relance: { ...relance, candidat: String(relance.candidat ?? "").trim() || nomCandidat() },
    profilCv: profilCv(),
    consigne: String(body.consigne ?? "").slice(0, 600),
  });

  const r = await executeLlm(prompt);
  if (!r.ok) return erreurOpenAi(r.message, r.status);

  try {
    return Response.json({ ...parseRelance(r.texte), compte: r.compte });
  } catch (e) {
    return erreurOpenAi(e instanceof Error ? e.message : "relance illisible", 502);
  }
}
