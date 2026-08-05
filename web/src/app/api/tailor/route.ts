import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { jdEnBlocRequis, motsClesVrais, titresCibles, titreVrai } from "@/lib/tailor.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CONTRAT FIGÉ (la session n8n s'appuie dessus) :
//   POST { jobTitle, company, jobDescription } -> 200 { keywords: string[], titre?: string }
//
// Des DONNÉES, pas du HTML : n8n injecte `keywords` dans le champ ATS du CV Typst
// et `titre` dans son intitulé. C'est pour ça que openai-tailor.mjs n'est PAS
// appelé ici — il rend un cv-template.html rempli, exige un rapport d'évaluation
// préalable et une clé d'API. Le tailoring utile à ce contrat est celui de
// jd-skill-gap.mjs : zéro LLM, déterministe, et anti-invention par construction.
//
// ANTI-INVENTION : tout mot-clé rendu est écrit dans la section « Skills » de
// cv.md ET mentionné par l'offre. Tout `titre` rendu sort de config/profile.yml →
// target_roles. Rien ne se déduit. La logique vit dans @/lib/tailor.mjs (pure et
// testée) ; cette route ne fait que lire les fichiers et lancer le classifieur.

/** Le bucket `existing` de jd-skill-gap.mjs, ou null si le classifieur n'a pas
 *  pu rendre son verdict. Null n'est pas une panne : la source cv.md ∩ offre est
 *  locale et suffit, on perd seulement la canonicalisation d'alias (k8s ↔ Kubernetes). */
async function classifier(jdText: string): Promise<{ existing?: string[] } | null> {
  const script = rootScript("jd-skill-gap");
  if (!fs.existsSync(script)) return null;

  // jd-skill-gap.mjs lit un FICHIER d'offre et résout `cv.md` relativement au cwd.
  let dossier: string | null = null;
  try {
    dossier = fs.mkdtempSync(path.join(os.tmpdir(), "co-tailor-"));
    const fichier = path.join(dossier, "offre.md");
    fs.writeFileSync(fichier, jdEnBlocRequis(jdText), "utf8");
    const stdout = await new Promise<string>((resolve) => {
      execFile("node", [script, fichier], { cwd: careerOpsRoot(), timeout: 15_000 }, (_e, out) => resolve(out || ""));
    });
    const debut = stdout.indexOf("{");
    if (debut === -1) return null;
    const j = JSON.parse(stdout.slice(debut));
    return j && Array.isArray(j.existing) ? j : null;
  } catch {
    return null;
  } finally {
    if (dossier) fs.rmSync(dossier, { recursive: true, force: true });
  }
}

/** config/profile.yml désérialisé, ou null. Absent ou illisible => pas de `titre`,
 *  jamais un intitulé deviné. */
function profil(): unknown {
  try {
    return yaml.load(fs.readFileSync(path.join(careerOpsRoot(), "config", "profile.yml"), "utf8"));
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  let body: { jobTitle?: unknown; company?: unknown; jobDescription?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }

  const jobTitle = String(body.jobTitle ?? "").trim();
  const jobDescription = String(body.jobDescription ?? "").trim();
  // `company` fait partie du contrat d'entrée mais ne sert à rien ici : le nom de
  // l'entreprise n'est ni une compétence ni un intitulé. Accepté et ignoré, plutôt
  // que refusé — n8n l'envoie, et le rejeter casserait l'appel pour rien.
  if (!jobDescription) {
    return Response.json({ error: "jobDescription requis" }, { status: 400 });
  }

  // cv.md est la BORNE de tout ce que cette route peut affirmer. Sans lui, la
  // seule sortie honnête serait une liste vide — qui passerait pour « cette offre
  // ne matche rien ». On échoue fort pour que n8n le voie.
  let cvText: string;
  try {
    cvText = fs.readFileSync(path.join(careerOpsRoot(), "cv.md"), "utf8");
  } catch {
    return Response.json(
      { error: "cv.md introuvable — impossible de garantir des mots-clés vrais" },
      { status: 503 },
    );
  }

  const keywords = motsClesVrais({ cvText, jdText: jobDescription, classification: await classifier(jobDescription) });
  const titre = titreVrai(jobTitle, titresCibles(profil()));

  // `titre` est OMIS quand aucun intitulé déclaré ne colle : le CV garde alors le
  // sien. Une chaîne vide serait injectée telle quelle dans le Typst.
  return Response.json(titre ? { keywords, titre } : { keywords });
}
