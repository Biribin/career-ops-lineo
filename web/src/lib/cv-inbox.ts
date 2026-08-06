import fs from "node:fs";
import { cvRepoRoot, inboxDir } from "@/lib/n8n-decisions";
import { lireFiches, type Fiche } from "@/lib/n8n-decisions.mjs";
import { fichesDepuisGitHub } from "@/lib/cv-inbox.mjs";

// Résolution de la SOURCE des fiches n8n. Deux modes, un seul contrat de sortie.
//
//  - « local »  : clone du repo cv voisin de career-ops. C'est la disposition du
//                 PC de Linéo, et le mode historique du pont.
//  - « github » : lecture directe par l'API contents. C'est le mode utile en
//                 conteneur sur le VPS, où il n'y a ni clone ni credential git.
//
// En « auto » (défaut) : le clone gagne s'il existe, sinon on bascule sur GitHub
// dès qu'un token est configuré. Cet ordre est volontaire — sur le poste de
// Linéo, le clone local reste la vérité la plus fraîche (n8n y pousse, il tire).

export type ModeInbox = "local" | "github";

export type SourceInbox = {
  mode: ModeInbox;
  fiches: Fiche[];
  /** Conservé pour l'affichage : la page « À valider » explique où elle a cherché. */
  repo: { racine: string; present: boolean; inbox: string };
  /** Libellé lisible de la source, affiché tel quel. */
  origine: string;
  /** Non-null seulement en cas de vraie panne (pas quand il n'y a rien à valider). */
  erreur: string | null;
  /** Fiches ignorées faute de place, et fiches hors-schéma. Jamais tronqué en silence. */
  tronquees: number;
  illisibles: number;
};

function conf() {
  const owner = process.env.CV_REPO_OWNER?.trim() || "Biribin";
  const repo = process.env.CV_REPO_NAME?.trim() || "cv";
  const branch = process.env.CV_REPO_BRANCH?.trim() || "main";
  const token = process.env.CV_GITHUB_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || "";
  return { owner, repo, branch, token };
}

/** Le mode retenu, et pourquoi. Exporté pour /api/doctor et les diagnostics. */
export function modeInbox(): { mode: ModeInbox; raison: string } {
  const demande = process.env.CV_INBOX_SOURCE?.trim().toLowerCase();
  const clonePresent = fs.existsSync(cvRepoRoot());
  const { token } = conf();

  if (demande === "github") return { mode: "github", raison: "CV_INBOX_SOURCE=github" };
  if (demande === "local") return { mode: "local", raison: "CV_INBOX_SOURCE=local" };

  if (clonePresent) return { mode: "local", raison: "clone du repo cv trouvé sur le disque" };
  if (token) return { mode: "github", raison: "pas de clone local, mais un token GitHub est configuré" };
  return { mode: "local", raison: "ni clone local ni token GitHub" };
}

/**
 * Lit les fiches en attente, quelle que soit la source.
 *
 * Ne jette jamais : une panne de lecture remonte dans `erreur` pour être
 * affichée. La page « À valider » doit pouvoir dire « je n'ai pas pu lire »,
 * ce qui n'est pas la même chose que « il n'y a rien » — c'était exactement
 * l'ambiguïté du message « clone introuvable ».
 */
export async function lireInbox(): Promise<SourceInbox> {
  const { mode, raison } = modeInbox();
  const racine = cvRepoRoot();
  const inbox = inboxDir();

  if (mode === "local") {
    const present = fs.existsSync(racine);
    return {
      mode,
      fiches: present ? lireFiches(inbox) : [],
      repo: { racine, present, inbox },
      origine: `clone local ${racine} (${raison})`,
      erreur: present ? null : `clone du repo cv introuvable à ${racine}`,
      tronquees: 0,
      illisibles: 0,
    };
  }

  const { owner, repo, branch, token } = conf();
  const res = await fichesDepuisGitHub({ fetch: globalThis.fetch, owner, repo, branch, token });

  return {
    mode,
    fiches: res.fiches,
    // `present` reste vrai tant que la lecture a fonctionné : c'est ce que la vue
    // utilise pour décider d'afficher un avertissement.
    repo: { racine: `${owner}/${repo}@${branch}`, present: res.erreur === null, inbox: `${owner}/${repo}:data-inbox` },
    origine: `API GitHub ${owner}/${repo}@${branch} (${raison})`,
    erreur: res.erreur,
    tronquees: res.tronquees,
    illisibles: res.illisibles,
  };
}
