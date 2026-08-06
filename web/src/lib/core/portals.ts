import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { DEFAULT_FILTERS, cleanChips, type ExploreFilters } from "@/lib/explore";

/**
 * ACL for portals.yml — the core's scan-filter config (a CONTRACT entry-point,
 * see reference_web_core_sync_protocol). The Explorer NEVER mutates the user's
 * real portals.yml: it writes an EPHEMERAL filter file and points the scanner at
 * it via CAREER_OPS_PORTALS, so an ad-hoc search can't clobber the curated config.
 * We also read the real portals.yml + config/profile.yml (tolerantly) only to
 * SEED sensible defaults for the first search.
 *
 * Filter semantics mirror scan.mjs::buildTitleFilter / buildLocationFilter:
 *   title positive → substring match (empty = everything matches)
 *   title negative → substring reject
 *   location always_allow > block > allow (case-insensitive substring)
 */
type FilterLists = Pick<ExploreFilters, "positive" | "negative" | "allow" | "block" | "alwaysAllow">;

function listFrom(v: unknown): string[] {
  return cleanChips(v);
}

/** Serialize filters into a minimal, valid portals.yml. Scalars go through
 *  JSON.stringify (a valid YAML double-quoted scalar) so arbitrary keywords —
 *  colons, quotes, leading dashes — can never break the document or inject YAML. */
export function serializePortals(f: FilterLists): string {
  const block = (key: string, items: string[]) =>
    items.length ? `  ${key}:\n` + items.map((k) => `    - ${JSON.stringify(k)}`).join("\n") + "\n" : "";

  let out = "# Ephemeral Explorer filters — generated per-search, safe to delete.\n";
  if (f.positive.length || f.negative.length) {
    out += "title_filter:\n";
    out += block("positive", f.positive);
    out += block("negative", f.negative);
  }
  if (f.allow.length || f.block.length || f.alwaysAllow.length) {
    out += "location_filter:\n";
    out += block("always_allow", f.alwaysAllow);
    out += block("allow", f.allow);
    out += block("block", f.block);
  }
  return out;
}

/** Write the ephemeral filter file to a temp path; caller cleans it up. */
export function writeTempPortals(f: FilterLists): string {
  const file = path.join(os.tmpdir(), `career-ops-explore-${randomUUID()}.yml`);
  fs.writeFileSync(file, serializePortals(f), "utf8");
  return file;
}

export function cleanupTempPortals(file: string): void {
  try {
    if (file.startsWith(os.tmpdir()) && file.includes("career-ops-explore-")) fs.unlinkSync(file);
  } catch {
    /* best-effort */
  }
}

function loadYaml(rel: string): Record<string, unknown> | null {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(careerOpsRoot(), rel), "utf8"));
    return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Tolerantly seed first-search defaults from the user's real config. Reads
 * portals.yml (title_filter / location_filter) and falls back to
 * config/profile.yml (target_roles, location) for the positive keywords when
 * portals has none. Never throws — a bare checkout just yields DEFAULT_FILTERS.
 *
 * portals.yml s'AJOUTE au socle de DEFAULT_FILTERS, il ne le remplace pas. Les
 * deux décrivent la même intention de recherche mais ne voyagent pas ensemble :
 * portals.yml est gitignoré et provisionné sur le volume du VPS, le socle est
 * embarqué dans le code et suit chaque déploiement. Remplacer ferait disparaître
 * le socle dès que portals.yml existe — c'est-à-dire précisément en production.
 */
export function seedExploreFilters(): { filters: ExploreFilters; seededFrom: string[] } {
  const filters: ExploreFilters = { ...DEFAULT_FILTERS, ats: [...DEFAULT_FILTERS.ats] };
  const seededFrom: string[] = [];

  const portals = loadYaml("portals.yml");
  if (portals) {
    const tf = (portals.title_filter ?? {}) as Record<string, unknown>;
    const lf = (portals.location_filter ?? {}) as Record<string, unknown>;
    // Union socle + portals.yml, dans cet ordre : cleanChips dédoublonne sans
    // tenir compte de la casse, donc « n8n » et « N8N » ne font qu'un chip.
    const union = (base: string[], extra: unknown) => listFrom([...base, ...listFrom(extra)]);
    filters.positive = union(DEFAULT_FILTERS.positive, tf.positive);
    filters.negative = union(DEFAULT_FILTERS.negative, tf.negative);
    filters.allow = union(DEFAULT_FILTERS.allow, lf.allow);
    filters.block = union(DEFAULT_FILTERS.block, lf.block);
    filters.alwaysAllow = union(DEFAULT_FILTERS.alwaysAllow, lf.always_allow);
    if (filters.positive.length || filters.allow.length || filters.block.length) seededFrom.push("portals.yml");
  }

  if (filters.positive.length === 0) {
    const profile = loadYaml("config/profile.yml");
    const roles = (profile?.target_roles ?? {}) as Record<string, unknown>;
    const fromRoles = listFrom([
      ...(typeof roles.primary === "string" ? [roles.primary] : []),
      ...(Array.isArray(roles.archetypes) ? roles.archetypes : []),
    ]);
    if (fromRoles.length) {
      filters.positive = fromRoles;
      seededFrom.push("profile.yml");
    }
  }

  return { filters, seededFrom };
}

export { listFrom as normalizeKeywords };

/**
 * Les filtres de portals.yml AU COMPLET, sans le plafond de 16 « chips ».
 *
 * `seedExploreFilters()` ne convient PAS pour ça : il passe par `cleanChips`, qui
 * coupe à 16 entrées (CHIP_CAP) parce qu'il alimente une rangée de chips
 * éditables dans l'Explorateur. Les 42 mots-clés de Linéo y perdent les 26
 * derniers — dont « Integration Engineer », « AI Automation », « Solutions
 * Engineer », « Ingénieur IA », c'est-à-dire les plus spécifiques, ceux qui
 * distinguent une offre vraiment ciblée d'une offre qui dit juste « AI ».
 * Acceptable pour préremplir un formulaire ; inacceptable pour CLASSER, où la
 * troncature ferait silencieusement disparaître le signal le plus fin.
 *
 * Même nettoyage que `cleanChips` (trim, vide et ponctuation seule écartés,
 * dédoublonnage insensible à la casse) mais SANS plafond.
 */
export function lireFiltresPortals(): {
  positive: string[];
  negative: string[];
  allow: string[];
  block: string[];
  alwaysAllow: string[];
} {
  const vide = { positive: [], negative: [], allow: [], block: [], alwaysAllow: [] };
  const doc = loadYaml("portals.yml");
  if (!doc) return vide;

  const liste = (v: unknown): string[] => {
    const arr = Array.isArray(v) ? v : v == null ? [] : [v];
    const vus = new Set<string>();
    const out: string[] = [];
    for (const item of arr) {
      if (typeof item !== "string") continue;
      const k = item.trim();
      if (!k || !/[\p{L}\p{N}]/u.test(k)) continue;
      const cle = k.toLowerCase();
      if (vus.has(cle)) continue;
      vus.add(cle);
      out.push(k);
    }
    return out;
  };

  const tf = (doc.title_filter ?? {}) as Record<string, unknown>;
  const lf = (doc.location_filter ?? {}) as Record<string, unknown>;
  return {
    positive: liste(tf.positive),
    negative: liste(tf.negative),
    allow: liste(lf.allow),
    block: liste(lf.block),
    alwaysAllow: liste(lf.always_allow),
  };
}
