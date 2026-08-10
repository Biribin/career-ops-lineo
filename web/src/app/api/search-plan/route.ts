import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { lireFiltresPortals } from "@/lib/core/portals";
import { planRecherche } from "@/lib/search-plan.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Le plan de recherche France Travail, dérivé de portals.yml. AUCUN LLM.
//
// Remplace les deux agents en cascade du workflow n8n (« Profile Generation » →
// « Search Urls generation »), morts depuis que le crédit Anthropic est épuisé,
// et qui constituaient de toute façon une seconde source de vérité sur « quoi
// chercher » à côté des 42 mots-clés de portals.yml.
//
// n8n appelle cette route en direct sur le réseau Docker
// (http://career-ops:3000/api/search-plan) : le site public est derrière
// basic_auth côté Caddy.

/** Le bloc optionnel `france_travail:` de portals.yml. Absent = valeurs par défaut. */
function blocFranceTravail(): {
  mots_cles?: string[];
  communes?: string[];
  /** km autour de chaque commune. `rayon` est l'ancien nom, que l'API ignorait. */
  distance?: number;
  rayon?: number;
  /** codes paysContinent : 991 = Europe hors France (Belgique, Suisse…). */
  continents?: string[];
  /** libellés de pays gardés parmi les résultats `continents`. */
  pays_gardes?: string[];
  max_urls?: number;
} {
  try {
    const p = path.join(careerOpsRoot(), "portals.yml");
    const doc = yaml.load(fs.readFileSync(p, "utf8")) as Record<string, unknown> | null;
    const bloc = doc?.france_travail;
    if (!bloc || typeof bloc !== "object") return {};
    return bloc as ReturnType<typeof blocFranceTravail>;
  } catch {
    // portals.yml absent ou illisible : on reste sur les filtres, pas de crash.
    return {};
  }
}

export async function GET() {
  const filtres = lireFiltresPortals();
  const ft = blocFranceTravail();
  const plan = planRecherche({ filtres, ft });

  return Response.json({
    ...plan,
    // Explicite pour que n8n (et un humain qui lit la réponse) sache d'où vient
    // chaque partie, sans avoir à ouvrir le code.
    config: {
      motsClesConfig: ft.mots_cles ?? [],
      // `communes: []` = France entière. C'est le cas normal depuis le
      // 2026-08-10 : Linéo est mobile partout en France.
      communes: ft.communes ?? [],
      distance: ft.distance ?? ft.rayon ?? 30,
      continents: ft.continents ?? [],
      paysGardes: ft.pays_gardes ?? [],
      maxUrls: ft.max_urls ?? 12,
      blocPresent: Object.keys(ft).length > 0,
    },
  });
}
