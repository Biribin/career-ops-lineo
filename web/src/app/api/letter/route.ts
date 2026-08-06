import { erreurOpenAi, executeLlm } from "@/lib/llm-runner";
import { profilCv } from "@/lib/profil-cv";
import { parseLettre, promptLettre } from "@/lib/letter.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Rédaction de la lettre de motivation, pour le workflow 2 (génération).
//
//   POST { offre: {title,company,location,description}, consigne? }
//   →    { email_subject, salutation, letter_body, key_selling_points, mots, compte }
//
// Le profil vient de cv.md (source de vérité du candidat), pas du corps de la
// requête : n8n ne doit pas pouvoir injecter un faux profil.
//
// Lève plutôt que de rendre une lettre douteuse. Une lettre vide, trop longue ou
// contenant une ancienneté inventée ne doit jamais atteindre l'étape d'envoi —
// c'est la seule pièce que lit un recruteur.

export async function POST(req: Request) {
  let body: { offre?: Record<string, unknown>; consigne?: string; candidat?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return erreurOpenAi("json invalide", 400, "invalid_request_error");
  }

  const offre = body.offre ?? {};
  if (!String(offre.title ?? "").trim() && !String(offre.description ?? "").trim()) {
    return erreurOpenAi("offre requise (au moins title ou description)", 400, "invalid_request_error");
  }

  const profil = profilCv();
  if (!profil) {
    // Sans cv.md on ne peut pas garantir l'absence d'invention : on refuse au
    // lieu d'écrire une lettre à partir de rien.
    return erreurOpenAi(
      "cv.md introuvable : impossible de garantir une lettre sans invention",
      503,
    );
  }

  const prompt = promptLettre({
    offre,
    profilCv: profil,
    candidat: body.candidat ?? {},
    consigne: String(body.consigne ?? "").slice(0, 600),
  });

  const r = await executeLlm(prompt);
  if (!r.ok) return erreurOpenAi(r.message, r.status);

  try {
    const lettre = parseLettre(r.texte);
    return Response.json({ ...lettre, compte: r.compte });
  } catch (e) {
    return erreurOpenAi(e instanceof Error ? e.message : "lettre illisible", 502);
  }
}
