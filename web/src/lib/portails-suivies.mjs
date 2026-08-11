// Le « réseau public des ATS » de career-ops : le bloc `tracked_companies` de
// portals.yml. Chaque entrée est une entreprise dont scan.mjs relit la page
// carrières à chaque tournée, via les API publiques des ATS (Greenhouse, Ashby,
// Lever, Workday…) — zéro jeton, zéro authentification.
//
// Partie pure et testable : on reçoit le TEXTE de portals.yml, on rend du texte.
// Aucun accès disque ici (voir portals-track.ts pour la lecture/écriture).
//
// POURQUOI UN DÉCOUPAGE DE TEXTE ET NON UN yaml.dump()
// portals.yml est écrit à la main et fait plus de 2000 lignes dont l'essentiel
// est du COMMENTAIRE : la stratégie de scan, le piège des URL d'ATS, le
// classement par secteur, les entreprises volontairement désactivées. Un
// aller-retour yaml.load → yaml.dump rendrait un fichier valide et ILLISIBLE :
// tous les commentaires perdus, tout réordonné, les guillemets normalisés. On
// insère donc les nouvelles entrées à la fin du bloc `tracked_companies:` et on
// ne touche pas un octet du reste.
//
// Même contrat que `insertIntoTrackedCompanies` de discover-ats.mjs, recopié
// volontairement plutôt qu'importé : le cœur vit hors du dossier web/, sa racine
// est résolue à l'exécution (CAREER_OPS_ROOT) et Next ne peut pas l'empaqueter.

import yaml from "js-yaml";

/** Normalise un nom d'entreprise pour la déduplication : sans accents, sans
 *  casse, espaces réduits. « Éditions Belin » et « editions  belin » = un seul. */
export function normaliserNom(s) {
  return String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // diacritiques combinants
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Normalise une URL pour la déduplication : minuscules, sans barre finale. */
export function normaliserUrl(u) {
  return String(u ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * Une entreprise du réseau, telle qu'elle vit dans portals.yml.
 * @typedef {{nom: string, careers_url: string, api: string, enabled: boolean, enAttente: boolean, notes: string}} EntrepriseSuivie
 */

/**
 * Le marqueur qui distingue « ajoutée, ATS pas encore trouvé » de « désactivée
 * exprès ».
 *
 * Les deux s'écrivent `enabled: false`, mais ce ne sont pas les mêmes choses :
 * le fichier livré désactive volontairement une quinzaine d'entreprises (le
 * marché turc, par exemple), toutes avec une vraie page carrières. Les ranger
 * sous « en attente d'ATS » les proposerait à la réparation alors qu'elles n'ont
 * rien de cassé. D'où une clé à nous, ignorée par le scanner, qui dit ce qu'elle
 * veut dire. La note reste reconnue en repli, pour les entrées écrites avant
 * l'existence du marqueur.
 */
const CLE_ATTENTE = "en_attente_ats";
const NOTE_ATTENTE = /compl[ée]ter careers_url/i;

/**
 * Les entreprises déjà suivies, lues depuis le texte de portals.yml.
 * Tolérant par construction : fichier vide, YAML cassé ou bloc absent → liste
 * vide. Une lecture ne doit jamais faire tomber la page Portails.
 *
 * @param {string} texte
 * @returns {EntrepriseSuivie[]}
 */
export function lireEntreprisesSuivies(texte) {
  let doc;
  try {
    doc = yaml.load(String(texte ?? ""));
  } catch {
    return [];
  }
  const liste = doc && typeof doc === "object" && Array.isArray(doc.tracked_companies) ? doc.tracked_companies : [];
  const out = [];
  for (const e of liste) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const nom = typeof e.name === "string" ? e.name.trim() : "";
    if (!nom) continue;
    // `enabled` absent = activée : c'est la règle de scan.mjs
    // (`if (entry.enabled === false) continue;`), pas l'inverse.
    const enabled = e.enabled !== false;
    const notes = typeof e.notes === "string" ? e.notes : "";
    out.push({
      nom,
      careers_url: typeof e.careers_url === "string" ? e.careers_url.trim() : "",
      api: typeof e.api === "string" ? e.api.trim() : "",
      enabled,
      // Une entrée réactivée n'est plus en attente, quoi qu'il reste écrit à
      // côté : c'est `enabled` qui fait foi, le marqueur ne fait que qualifier.
      enAttente: !enabled && (e[CLE_ATTENTE] === true || NOTE_ATTENTE.test(notes)),
      notes,
    });
  }
  return out;
}

/**
 * L'entrée déjà présente pour ce nom ou cette URL, sinon null.
 * On dédoublonne AUSSI par URL : deux graphies du même employeur (« Decathlon »
 * et « Décathlon France ») qui pointent le même board ne doivent pas produire
 * deux entrées que le scanner lirait deux fois.
 *
 * @param {EntrepriseSuivie[]} entrees
 * @param {{name?:string, careers_url?:string, api?:string}} candidat
 * @returns {EntrepriseSuivie|null}
 */
export function entreeExistante(entrees, candidat) {
  const nom = normaliserNom(candidat?.name);
  const urls = [candidat?.careers_url, candidat?.api].map(normaliserUrl).filter(Boolean);
  for (const e of entrees) {
    if (nom && normaliserNom(e.nom) === nom) return e;
    const siennes = [e.careers_url, e.api].map(normaliserUrl).filter(Boolean);
    if (urls.some((u) => siennes.includes(u))) return e;
  }
  return null;
}

/**
 * Un scalaire YAML sûr. Non cité tant que c'est inoffensif (pour rester dans le
 * style du fichier écrit à la main), cité et échappé dès qu'un caractère peut
 * changer le sens du document. C'est la barrière d'injection : un nom
 * d'entreprise vient d'une annonce France Travail, donc d'une saisie tierce.
 */
export function scalaireYaml(valeur) {
  const s = [...String(valeur ?? "")].map((c) => (c.codePointAt(0) < 32 ? " " : c)).join("");
  const aCiter = s === "" || /^\s|\s$/.test(s) || /[:#"'{}[\],&*!|>%@`]/.test(s);
  if (!aCiter) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Une URL http(s) sans espace ni « # » passe telle quelle (style du fichier) ;
 *  tout le reste est cité. Une valeur qui n'est pas une URL est refusée. */
export function urlYaml(u) {
  const s = String(u ?? "").trim();
  if (!/^https?:\/\//i.test(s)) return null;
  return /^https?:\/\/[^\s#"']+$/i.test(s) ? s : scalaireYaml(s);
}

/**
 * Rend UNE entrée `tracked_companies` prête à être insérée. Commence par un
 * saut de ligne pour se poser proprement contre l'entrée précédente.
 *
 * @param {{name:string, careers_url?:string, api?:string, provider?:string, enabled?:boolean, enAttente?:boolean, notes?:string}} entree
 * @returns {string}
 */
export function rendreEntree(entree) {
  const lignes = [`  - name: ${scalaireYaml(entree.name)}`];
  const url = urlYaml(entree.careers_url);
  // `careers_url` est obligatoire côté scanner (cf. l'en-tête de portals.yml) :
  // une entrée sans URL exploitable garde la clé, vide, pour que la ligne à
  // compléter saute aux yeux plutôt que de manquer silencieusement.
  lignes.push(`    careers_url: ${url ?? '""'}`);
  const api = urlYaml(entree.api);
  if (api) lignes.push(`    api: ${api}`);
  if (entree.provider) lignes.push(`    provider: ${scalaireYaml(entree.provider)}`);
  lignes.push(`    enabled: ${entree.enabled === false ? "false" : "true"}`);
  if (entree.enabled === false && entree.enAttente) lignes.push(`    ${CLE_ATTENTE}: true`);
  if (entree.notes) lignes.push(`    notes: ${scalaireYaml(entree.notes)}`);
  return "\n" + lignes.join("\n") + "\n";
}

/**
 * Insère des entrées rendues à la fin du bloc `tracked_companies`, en
 * préservant tout le reste du fichier (commentaires, ordre, autres blocs).
 * Le document n'est JAMAIS re-sérialisé.
 *
 * @param {string} texte  Contenu actuel de portals.yml.
 * @param {string[]} entrees  Sorties de rendreEntree().
 * @returns {string}
 */
export function insererDansTrackedCompanies(texte, entrees) {
  const fichier = String(texte ?? "");
  if (!entrees.length) return fichier;
  // portals.yml se modifie à la main. Un fichier en CRLF (le cas d'un clone
  // Windows) qui reçoit des lignes en LF s'affiche de travers dans les éditeurs
  // qui ne devinent pas les fins de ligne mélangées — on suit donc la convention
  // du fichier plutôt que la nôtre. YAML accepte les deux, c'est le lecteur
  // humain qu'on ménage ici.
  const crlf = (fichier.match(/\r\n/g) || []).length > (fichier.match(/(^|[^\r])\n/g) || []).length;
  const fin = crlf ? "\r\n" : "\n";
  const bloc = entrees.join("").replace(/\r?\n/g, fin);

  const entete = fichier.match(/^tracked_companies:[ \t]*$/m);
  if (!entete) {
    // Aucun bloc : on en crée un à la fin, sans toucher au reste.
    const sep = fichier === "" ? "" : /\r?\n$/.test(fichier) ? fin : fin + fin;
    return `${fichier}${sep}tracked_companies:${bloc}`;
  }

  const finEntete = entete.index + entete[0].length;
  const reste = fichier.slice(finEntete);
  // Fin du bloc = la prochaine clé de premier niveau (ligne commençant par un
  // caractère non blanc, non « # », et contenant deux-points). Commentaires et
  // lignes indentées restent dans le bloc. Le `\r?` compte : sans lui, la coupe
  // tomberait ENTRE le \r et le \n d'un fichier CRLF, et l'insertion laisserait
  // un \r orphelin au milieu du document.
  const frontiere = reste.match(/\r?\n[^\s#\r][^\n]*:/);
  const insertion = frontiere ? finEntete + frontiere.index : fichier.length;

  let avant = fichier.slice(0, insertion);
  const apres = fichier.slice(insertion);
  // Nos entrées commencent par un saut de ligne : on absorbe les lignes vides
  // de fin de bloc pour ne pas empiler les blancs avant la clé suivante.
  avant = avant.replace(/\r?\n[ \t]*(?=(\r?\n)*$)/g, (m, _g, off) => (off >= finEntete ? fin : m));

  return avant + bloc + apres;
}
