import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

// Le profil du candidat, lu CÔTÉ SERVEUR depuis cv.md.
//
// Volontairement pas un champ de requête : n8n ne doit pas pouvoir injecter un
// faux profil, ni dans un tri d'offres ni dans une lettre. cv.md est la source
// de vérité du candidat, et c'est elle qui borne ce qu'on peut affirmer.
//
// Deux emplacements essayés : la racine (poste de Linéo) puis data/perso/ (le
// conteneur, où la couche utilisateur est montée depuis le volume).
export function profilCv(): string {
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
