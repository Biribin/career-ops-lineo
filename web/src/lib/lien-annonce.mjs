// Retrouver le lien d'une annonce à partir d'une ligne du tracker.
//
// LE PROBLÈME : le tracker (data/applications.md) n'a pas de colonne URL. Ses
// champs sont n, date, company, via, role, score, status, pdf, report, notes.
// L'URL existe en amont, dans data/pipeline.md, mais elle est perdue au passage
// inbox → tracker. Les cartes « À valider » n'avaient donc aucun lien à afficher.
//
// LE PRINCIPE, ET IL EST NON NÉGOCIABLE : on ne rend une URL que si la
// correspondance est CERTAINE. Une mauvaise URL sur une candidature est pire que
// pas d'URL du tout — elle enverrait Linéo lire la mauvaise annonce avant de
// décider, ou pire, de candidater. En cas d'ambiguïté ou d'absence, on rend un
// lien de RECHERCHE, clairement identifié comme tel.

const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(h\/f|f\/h|m\/f|\(h\/f\)|\(f\/h\))\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Résout le lien d'une annonce.
 *
 * @param {{company?: string, role?: string}} ligne  la ligne du tracker
 * @param {Array<{company?: string, role?: string, url?: string}>} candidats  offres connues (pipeline)
 * @returns {{url: string, certitude: "exacte"|"recherche", ambigu: boolean, nbCandidats: number}}
 */
export function resoudreLien(ligne, candidats) {
  const entreprise = norm(ligne?.company);
  const poste = norm(ligne?.role);
  const liste = Array.isArray(candidats) ? candidats : [];

  // 1) Correspondance sur l'entreprise ET le poste : c'est la seule qu'on tient
  //    pour certaine.
  let trouves = liste.filter(
    (c) => c?.url && norm(c.company) === entreprise && norm(c.role) === poste,
  );

  // 2) À défaut, entreprise seule — mais uniquement si elle ne ramène QU'UNE
  //    offre. Deux offres de la même boîte se confondraient, et on refuse de
  //    deviner laquelle.
  //
  //    On COMPTE quand même les candidates écartées : sans ça, l'ambiguïté serait
  //    invisible et l'interface ne pourrait pas expliquer pourquoi elle n'a pas de
  //    lien (« 2 offres chez cette entreprise, laquelle ? »). Un test a attrapé
  //    cette perte d'information.
  let ecarteesPourAmbiguite = 0;
  if (trouves.length === 0 && entreprise) {
    const memeBoite = liste.filter((c) => c?.url && norm(c.company) === entreprise);
    const urlsBoite = [...new Set(memeBoite.map((c) => String(c.url)))];
    if (urlsBoite.length === 1) trouves = memeBoite;
    else ecarteesPourAmbiguite = urlsBoite.length;
  }

  // Dédoublonnage : la même URL vue par deux scans n'est pas une ambiguïté.
  const urls = [...new Set(trouves.map((c) => String(c.url)))];

  if (urls.length === 1) {
    return { url: urls[0], certitude: "exacte", ambigu: false, nbCandidats: 1 };
  }

  return {
    url: lienRecherche(ligne),
    certitude: "recherche",
    // Plusieurs candidates : on le DIT, pour que l'interface n'affiche pas un
    // lien de recherche en le faisant passer pour l'annonce.
    ambigu: ecarteesPourAmbiguite > 1,
    nbCandidats: ecarteesPourAmbiguite,
  };
}

/** Lien de repli : une recherche pré-remplie, jamais présentée comme l'annonce. */
export function lienRecherche(ligne) {
  const termes = [ligne?.company, ligne?.role].map((v) => String(v ?? "").trim()).filter(Boolean);
  if (termes.length === 0) return "";
  const q = encodeURIComponent(termes.join(" ") + " offre emploi");
  return `https://duckduckgo.com/?q=${q}`;
}
