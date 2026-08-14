// Lecture des compteurs de tournée écrits par le cœur (`data/scan-runs.tsv`,
// une ligne par tournée non-dry, écrite par `appendScanRunSummary` dans
// scan.mjs). Partie pure : le texte est INJECTÉ, aucun accès disque ici.
//
// POURQUOI LIRE CE FICHIER PLUTÔT QUE LA SORTIE DU PROCESSUS
// ----------------------------------------------------------
// `scan.mjs` n'a pas de mode `--json` (contrairement à scan-ats-full.mjs) : ses
// chiffres ne sortent que sous forme de tableau humain (« Total jobs found: 1276 »).
// Parser ces libellés casserait au premier changement de formulation, et
// dupliquerait une source de vérité qui existe déjà : ce TSV est ce que lit
// `stats.mjs`, donc ce que Linéo voit dans `/stats`. Les mêmes chiffres,
// au même endroit, pour tout le monde.
//
// Les colonnes sont lues PAR NOM d'en-tête, jamais par position : le cœur en a
// ajouté plusieurs au fil du temps (filtered_visa, filtered_posted_date,
// filtered_country_eligibility…) et un lecteur positionnel afficherait
// silencieusement la mauvaise colonne au prochain ajout.

/**
 * La dernière ligne du TSV, sous forme d'objet indexé par en-tête — mais
 * SEULEMENT si elle a été écrite après `depuis`.
 *
 * La borne temporelle est le cœur de cette fonction, pas une précaution. Le
 * fichier est partagé : le CLI de Linéo, une session parallèle ou un cron
 * peuvent en avoir écrit la dernière ligne. Sans cette borne, l'appelant
 * afficherait les chiffres d'une AUTRE tournée comme étant les siens — une
 * erreur invisible, puisque les chiffres seraient plausibles.
 *
 * Renvoie `null` quand il n'y a pas de ligne à nous : « je ne sais pas » doit se
 * distinguer de « zéro ».
 *
 * @param {string} brut   contenu de data/scan-runs.tsv
 * @param {number} depuis horodatage (ms) du lancement du scanner
 * @returns {Record<string, string>|null}
 */
export function derniereLigneRun(brut, depuis) {
  const lignes = String(brut ?? "")
    .trim()
    .split("\n")
    .filter((l) => l.trim());
  // Une seule ligne = l'en-tête seul, donc aucune tournée enregistrée.
  if (lignes.length < 2) return null;

  const entetes = lignes[0].split("\t").map((h) => h.trim());
  const cellules = lignes[lignes.length - 1].split("\t");
  /** @type {Record<string, string>} */
  const ligne = {};
  entetes.forEach((cle, i) => {
    if (cle) ligne[cle] = (cellules[i] ?? "").trim();
  });

  const t = Date.parse(ligne.timestamp ?? "");
  if (!Number.isFinite(t)) return null;
  // `>=` et non `>` : une tournée assez rapide pour s'inscrire dans la même
  // milliseconde que son lancement est la nôtre, et l'exclure ferait perdre les
  // compteurs d'un balayage qui a parfaitement fonctionné.
  if (t < depuis) return null;
  return ligne;
}

/**
 * Un compteur du TSV en nombre, ou `null` si la colonne est absente ou illisible.
 *
 * Jamais `0` par défaut : un compteur manquant et un compteur nul ne disent pas
 * la même chose, et « 0 offre trouvée » est précisément ce qu'on ne veut pas
 * afficher quand on n'a rien mesuré.
 *
 * @param {string|undefined} v
 * @returns {number|null}
 */
export function compteur(v) {
  if (v === undefined || v === null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
