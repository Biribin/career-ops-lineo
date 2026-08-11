import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import {
  entreeExistante,
  insererDansTrackedCompanies,
  lireEntreprisesSuivies,
  rendreEntree,
} from "@/lib/portails-suivies.mjs";

export type PortailTrackResult = {
  /** true = entreprise ajoutée à tracked_companies à l'instant */
  applique: boolean;
  /** true = déjà présente (aucune écriture, pas une erreur) */
  deja: boolean;
  erreur: string | null;
};

/** Une entrée du réseau public des ATS, telle que portals.yml la décrit. */
export type EntrepriseSuivie = {
  nom: string;
  careers_url: string;
  api: string;
  enabled: boolean;
  /** Ajoutée par l'app, ATS pas encore trouvé — à distinguer d'une entreprise
   *  désactivée volontairement, qui est aussi `enabled: false`. */
  enAttente: boolean;
  notes: string;
};

/** Ce qu'on veut inscrire dans `tracked_companies`. */
export type NouvelleEntree = {
  name: string;
  careers_url?: string;
  api?: string;
  provider?: string;
  enabled?: boolean;
  enAttente?: boolean;
  notes?: string;
};

export function cheminPortals(): string {
  return path.join(careerOpsRoot(), "portals.yml");
}

/** Le texte de portals.yml, ou à défaut celui du modèle livré — pour qu'un
 *  premier ajout parte du fichier d'exemple (et de ses commentaires) plutôt que
 *  d'un document nu. Aucun des deux → chaîne vide, l'insertion créera le bloc. */
function lireTextePortals(): string {
  for (const p of [cheminPortals(), path.join(careerOpsRoot(), "templates", "portals.example.yml")]) {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      /* fichier suivant */
    }
  }
  return "";
}

/** Les entreprises du réseau public des ATS, activées ou en attente. */
export function entreprisesSuivies(): EntrepriseSuivie[] {
  try {
    return lireEntreprisesSuivies(fs.readFileSync(cheminPortals(), "utf8"));
  } catch {
    return []; // pas encore de portals.yml : rien de suivi, ce n'est pas une erreur
  }
}

/**
 * Ajoute une entreprise à `tracked_companies` de portals.yml.
 *
 * Idempotent : dédup par nom (insensible casse/accents) ET par URL de board,
 * donc deux graphies du même employeur ne créent pas deux entrées.
 *
 * L'écriture est un DÉCOUPAGE DE TEXTE (voir portails-suivies.mjs) : les 2000
 * lignes de commentaires du fichier survivent à l'ajout, contrairement à un
 * aller-retour yaml.load/yaml.dump.
 *
 * Persistance : rien à recopier à la main. atomicWriteWithBackup résout le lien
 * symbolique du volume avant d'écrire (chemin-reel.mjs), donc l'ajout atterrit
 * dans /app/data/perso/ et survit au redéploiement. Cf. DEPLOY-VPS.md.
 */
export function ajouterEntrepriseSuivie(entree: NouvelleEntree): PortailTrackResult {
  const name = (entree.name || "").trim();
  if (!name) return { applique: false, deja: false, erreur: "nom d'entreprise vide : rien à suivre" };

  const texte = lireTextePortals();
  if (entreeExistante(lireEntreprisesSuivies(texte), { ...entree, name })) {
    return { applique: false, deja: true, erreur: null };
  }

  try {
    const snippet = rendreEntree({ ...entree, name });
    atomicWriteWithBackup(cheminPortals(), insererDansTrackedCompanies(texte, [snippet]));
  } catch (e) {
    return { applique: false, deja: false, erreur: e instanceof Error ? e.message : "écriture de portals.yml impossible" };
  }
  return { applique: true, deja: false, erreur: null };
}

/**
 * Ajoute une entreprise suivie depuis une candidature VALIDÉE (page « À
 * valider ») — pour que career-ops surveille désormais cette entreprise.
 *
 * `enabled: false` VOLONTAIRE : sans careers_url vérifié, le scanner sauterait
 * l'entrée (scan.mjs ~l.2088 `if (entry.enabled === false) continue;`) — donc
 * zéro risque de casser un scan ou de déclencher la suppression « lien mort »
 * de la page Portails. On garde l'URL de l'offre en indice ; le bouton
 * « Trouver l'ATS » de la page Portails (ou /api/portals/track) complète le vrai
 * careers_url puis passe enabled: true.
 */
export function trackCompanyInPortals(entreprise: string, urlOffre?: string): PortailTrackResult {
  const name = (entreprise || "").trim();
  if (!name) return { applique: false, deja: false, erreur: "fiche sans entreprise : rien à suivre" };
  return ajouterEntrepriseSuivie({
    name,
    careers_url: (urlOffre || "").trim(),
    enabled: false,
    enAttente: true,
    notes: "Ajouté automatiquement depuis une candidature validée. Compléter careers_url puis passer enabled: true.",
  });
}
