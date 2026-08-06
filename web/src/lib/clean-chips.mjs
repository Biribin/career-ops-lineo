// Pure JS implementation of cleanChips — no TypeScript types so it can be
// imported directly by both explore.ts (which re-exports it) and by
// clean-chips.test.mjs (which can't import .ts without a runner).
// This is the single source of truth for the chip-cleaning logic.

// Pas de plafond. Il y en avait un (16) parce que la rangée de chips servait à
// une poignée de mots-clés tapés à la main ; en pratique un profil de recherche
// réel en compte 40+ (n8n, IA, intégration, variantes FR/EN), et la troncature
// supprimait silencieusement les plus spécifiques — donc les plus discriminants.
// Voir lireFiltresPortals() dans lib/core/portals.ts, qui existait uniquement
// pour contourner ce plafond côté classement.

/** Trim, drop empties, de-dupe case-insensitively. */
export function cleanChips(v) {
  if (v == null) return [];
  const arr = Array.isArray(v) ? v : [v];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const k = item.trim();
    if (!k) continue;
    if (!/[\p{L}\p{N}]/u.test(k)) continue; // drop punctuation-only junk (e.g. a stray "*")
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}