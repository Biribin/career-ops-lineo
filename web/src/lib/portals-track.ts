import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

export type PortailTrackResult = {
  /** true = entreprise ajoutée à tracked_companies à l'instant */
  applique: boolean;
  /** true = déjà présente (aucune écriture, pas une erreur) */
  deja: boolean;
  erreur: string | null;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Normalise pour dédup : sans accents, sans casse, espaces réduits. */
function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // diacritiques combinants
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Ajoute une entreprise à `tracked_companies` de portals.yml — appelé quand Lineo
 * VALIDE l'envoi d'une candidature, pour que career-ops surveille désormais cette
 * entreprise (elle apparaît alors sur la page Portails).
 *
 * Idempotent : dédup par nom (insensible casse/accents), aucun doublon.
 *
 * `enabled: false` VOLONTAIRE : sans careers_url vérifié, le scanner sauterait
 * l'entrée (scan.mjs ~l.2088 `if (entry.enabled === false) continue;`) — donc
 * zéro risque de casser un scan ou de déclencher la suppression « lien mort » de
 * la page Portails. On garde l'URL de l'offre en indice ; Lineo (ou le flux
 * /api/run « fix-portal ») complète le vrai careers_url puis passe enabled: true.
 *
 * ⚠️ Persistance : atomicWriteWithBackup fait un rename → il REMPLACE le lien
 * symbolique du volume par un fichier réel de la couche conteneur (limitation
 * connue, cf. DEPLOY-VPS.md). La source de vérité reste `career-ops-data` + le
 * volume ; recopier portals.yml dans /app/data/perso/ après coup si besoin.
 */
export function trackCompanyInPortals(entreprise: string, urlOffre?: string): PortailTrackResult {
  const name = (entreprise || "").trim();
  if (!name) return { applique: false, deja: false, erreur: "fiche sans entreprise : rien à suivre" };

  const root = careerOpsRoot();
  const file = path.join(root, "portals.yml");

  // Lire portals.yml ; s'il n'existe pas encore, partir de l'exemple pour ne pas
  // perdre les autres blocs (title_filter, location_filter…) au premier ajout.
  let doc: Record<string, unknown> = {};
  try {
    doc = (yaml.load(fs.readFileSync(file, "utf8")) as Record<string, unknown>) || {};
  } catch {
    try {
      doc = (yaml.load(fs.readFileSync(path.join(root, "templates", "portals.example.yml"), "utf8")) as Record<string, unknown>) || {};
    } catch {
      doc = {};
    }
  }

  const companies = Array.isArray(doc.tracked_companies) ? [...(doc.tracked_companies as unknown[])] : [];
  const already = companies.some((c) => isObj(c) && typeof c.name === "string" && norm(c.name) === norm(name));
  if (already) return { applique: false, deja: true, erreur: null };

  companies.push({
    name,
    careers_url: (urlOffre || "").trim(),
    enabled: false,
    notes: "Ajouté automatiquement depuis une candidature validée. Compléter careers_url puis passer enabled: true.",
  });
  doc.tracked_companies = companies;

  try {
    atomicWriteWithBackup(file, yaml.dump(doc, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return { applique: false, deja: false, erreur: e instanceof Error ? e.message : "écriture de portals.yml impossible" };
  }
  return { applique: true, deja: false, erreur: null };
}
