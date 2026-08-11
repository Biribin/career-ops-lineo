import fs from "node:fs";
import path from "node:path";

/**
 * Le fichier RÉEL derrière un chemin, en suivant les liens symboliques.
 *
 * POURQUOI ÇA EXISTE : sur le VPS, les quatre fichiers de la couche utilisateur
 * (cv.md, portals.yml, config/profile.yml, modes/_profile.md) ne sont PAS dans
 * l'image — ils sont gitignorés. `docker-entrypoint-web.sh` les relie au volume
 * persistant à chaque démarrage :
 *
 *     /app/portals.yml  ->  /app/data/perso/portals.yml
 *
 * Or une écriture atomique est un `rename` : renommer un fichier temporaire SUR
 * `/app/portals.yml` ne suit pas le lien, il le REMPLACE. La modification atterrit
 * alors dans la couche du conteneur, hors du volume, et disparaît au redéploiement
 * suivant — sans rien signaler, puisque l'écriture a réussi. C'est ce qui obligeait
 * à recopier le fichier à la main dans `/app/data/perso/` après chaque ajout.
 *
 * En résolvant la cible d'abord, le temporaire naît et se renomme DANS le dossier
 * du volume : le lien reste intact, l'écriture est durable, et elle reste atomique
 * (le rename se fait sur le même système de fichiers, condition indispensable).
 *
 * Ne lève jamais et ne suppose rien :
 *   - fichier absent ou illisible → le chemin d'origine (l'appelant le créera) ;
 *   - lien cassé → sa cible, pour créer le fichier au bon endroit plutôt que
 *     d'écraser le lien ;
 *   - chaîne de liens → suivie, avec une borne contre les boucles.
 *
 * @param {string} fichier
 * @param {number} [sauts]
 * @returns {string}
 */
export function cheminReel(fichier, sauts = 0) {
  // Une chaîne de 8 liens est déjà anormale ; au-delà c'est une boucle, et on
  // préfère rendre un chemin utilisable qu'épuiser la pile.
  if (sauts >= 8) return fichier;
  let etat;
  try {
    etat = fs.lstatSync(fichier);
  } catch {
    return fichier; // n'existe pas encore : c'est là qu'il faut écrire
  }
  if (!etat.isSymbolicLink()) return fichier;
  let cible;
  try {
    cible = fs.readlinkSync(fichier);
  } catch {
    return fichier;
  }
  return cheminReel(path.resolve(path.dirname(fichier), cible), sauts + 1);
}
