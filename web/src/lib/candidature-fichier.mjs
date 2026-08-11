// Ce qu'il faut savoir pour servir le CV ou la lettre d'une candidature en
// telechargement : ou est le fichier, et sous quel nom il doit arriver.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// La fiche n8n porte `cv_url` et `lettre_url`, qui pointent vers
// `github.com/Biribin/cv/blob/<branche>/dist/…`. Trois problemes, constates le
// 2026-08-11 :
//   1. `/blob/` est une PAGE GitHub, pas un telechargement. Pour un .docx elle ne
//      propose qu'un « View raw » ;
//   2. le depot `cv` est PRIVE, donc le lien exige d'etre connecte a GitHub avec
//      les droits — depuis une app derriere basic_auth, ca n'a rien d'evident ;
//   3. la branche s'appelle `cv/devoteam-…`, avec une barre oblique : dans
//      `/blob/cv/devoteam-…/dist/…`, GitHub doit devenir la reference de la
//      partie chemin, ce qui est ambigu et fragile.
//
// La reponse est de servir le fichier DEPUIS l'app, avec le jeton serveur qui lit
// deja l'inbox. Linteo clique, le fichier arrive. Ici on ne garde que la partie
// pure et testable : resolution du chemin, du type MIME et du nom de fichier.

/** Ce que Linéo doit voir dans son dossier de telechargements. */
export const NOM_CV = "BIRIBIN Lineo.pdf";
export const NOM_LETTRE = "BIRIBIN Lineo - lettre de motivation.docx";

const TYPES = {
  cv: {
    champ: "cv_pdf",
    defaut: "dist/pdf/cv-fr-ats.pdf",
    nom: NOM_CV,
    mime: "application/pdf",
  },
  lettre: {
    champ: "lettre_docx",
    defaut: "dist/docx/lettre-fr.docx",
    nom: NOM_LETTRE,
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
};

/**
 * Resout quoi servir pour une fiche et un type demande.
 *
 * Rend un verdict au lieu de jeter : l'appelant doit pouvoir repondre 400 ou 404
 * avec un message lisible. Un lien mort doit dire POURQUOI il est mort — une
 * branche supprimee et un type inconnu demandent des reactions opposees.
 *
 * @param {{fiche: {branche_github?: string, cv_pdf?: string, lettre_docx?: string}|null|undefined, type: string}} args
 * @returns {{ok: true, chemin: string, branche: string, nom: string, mime: string}
 *         | {ok: false, statut: number, motif: string}}
 */
export function resoudFichierCandidature({ fiche, type }) {
  const t = TYPES[String(type ?? "").trim().toLowerCase()];
  if (!t) {
    return { ok: false, statut: 400, motif: `type inconnu : attendu « cv » ou « lettre »` };
  }
  if (!fiche) {
    return { ok: false, statut: 404, motif: "aucune candidature ne porte cet identifiant" };
  }
  const branche = String(fiche.branche_github ?? "").trim();
  if (!branche) {
    return {
      ok: false,
      statut: 409,
      motif: "cette fiche ne référence aucune branche : le CV et la lettre n'ont pas été rendus",
    };
  }
  // Le chemin de la fiche fait loi ; le defaut ne sert qu'aux fiches anciennes
  // ecrites avant que n8n ne le renseigne.
  const chemin = String(fiche[t.champ] ?? "").trim() || t.defaut;
  // Garde-fou anti-traversee : le chemin vient d'un JSON du depot, donc d'une
  // source qu'on ne veut pas croire aveuglement quand on la concatene dans une URL.
  if (chemin.includes("..") || chemin.startsWith("/")) {
    return { ok: false, statut: 400, motif: `chemin de fichier refusé : « ${chemin} »` };
  }
  return { ok: true, chemin, branche, nom: t.nom, mime: t.mime };
}

/**
 * URL de l'API contents pour un blob, sur une branche donnee.
 *
 * `encodeURIComponent` sur la branche est INDISPENSABLE : elle contient une barre
 * oblique (`cv/devoteam-…`), et c'est precisement l'ambiguite qui rend les liens
 * `github.com/blob/…` fragiles.
 *
 * @param {{owner: string, repo: string, chemin: string, branche: string}} args
 * @returns {string}
 */
export function urlContenuGitHub({ owner, repo, chemin, branche }) {
  const segments = chemin.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${owner}/${repo}/contents/${segments}?ref=${encodeURIComponent(branche)}`;
}

/**
 * Valeur d'en-tete `Content-Disposition` pour un telechargement.
 *
 * Le nom contient une espace et un tiret, donc il est entre guillemets. On fournit
 * aussi `filename*` en UTF-8, sans quoi un accent futur arriverait mutile.
 *
 * @param {string} nom
 * @returns {string}
 */
export function enteteTelechargement(nom) {
  const propre = nom.replace(/["\\]/g, "");
  return `attachment; filename="${propre}"; filename*=UTF-8''${encodeURIComponent(nom)}`;
}
