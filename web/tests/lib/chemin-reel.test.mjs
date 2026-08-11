// Tests de l'ecriture A TRAVERS un lien symbolique (chemin-reel.mjs).
//
// LE BUG D'ORIGINE, en production : sur le VPS, /app/portals.yml est un LIEN vers
// /app/data/perso/portals.yml, sur le volume persistant. Une ecriture atomique se
// termine par un rename, et renommer SUR le lien le remplace par un vrai fichier
// dans la couche du conteneur. L'ecriture reussissait, l'app affichait « ajoutee »,
// et l'entreprise disparaissait au redeploiement suivant sans le moindre message.
// La consigne etait donc : « recopie portals.yml dans /app/data/perso/ apres coup ».
//
// Ce qui est verifie ici : on ecrit dans la CIBLE, le lien survit, et le fichier
// du volume porte bien le nouveau contenu.
//
// Run:  node --test tests/lib/chemin-reel.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { cheminReel, droitsExistants } from "../../src/lib/core/chemin-reel.mjs";

/** Un bac a sable facon conteneur : un « volume » et un dossier « /app ». */
function bac() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), "co-lien-"));
  const volume = path.join(racine, "data", "perso");
  const app = path.join(racine, "app");
  fs.mkdirSync(volume, { recursive: true });
  fs.mkdirSync(app, { recursive: true });
  return { racine, volume, app };
}

/** Les liens symboliques demandent des droits particuliers sous Windows : on
 *  saute le test plutot que de le faire echouer sur un poste sans mode
 *  developpeur (la CI, elle, tourne sous Linux). */
function lier(cible, lien) {
  try {
    fs.symlinkSync(cible, lien);
    return true;
  } catch {
    return false;
  }
}

test("un lien vers le volume est suivi, pas remplace", (t) => {
  const { volume, app } = bac();
  const reel = path.join(volume, "portals.yml");
  const vu = path.join(app, "portals.yml");
  fs.writeFileSync(reel, "tracked_companies:\n");
  if (!lier(reel, vu)) return t.skip("liens symboliques indisponibles sur ce poste");

  assert.equal(cheminReel(vu), reel, "on ecrit dans le volume, pas sur le lien");
  // Simulation exacte de atomicWrite : temporaire dans le dossier de la CIBLE,
  // puis rename. C'est ce rename qui detruisait le lien avant.
  const tmp = `${cheminReel(vu)}.tmp-1`;
  fs.writeFileSync(tmp, "tracked_companies:\n  - name: Swile\n");
  fs.renameSync(tmp, cheminReel(vu));

  assert.ok(fs.lstatSync(vu).isSymbolicLink(), "le lien est toujours un lien");
  assert.match(fs.readFileSync(reel, "utf8"), /Swile/, "le volume a bien recu l'ecriture");
});

test("un fichier ordinaire n'est pas deplace", () => {
  const { app } = bac();
  const f = path.join(app, "portals.yml");
  fs.writeFileSync(f, "x");
  assert.equal(cheminReel(f), f);
});

test("un fichier absent rend son propre chemin", () => {
  const { app } = bac();
  const f = path.join(app, "pas-encore.yml");
  assert.equal(cheminReel(f), f);
});

test("un lien casse pointe la ou il faut creer le fichier", (t) => {
  // Volume vide au premier demarrage : le lien existe, sa cible pas encore.
  // Ecrire doit CREER la cible sur le volume, surement pas ecraser le lien.
  const { volume, app } = bac();
  const reel = path.join(volume, "portals.yml");
  const vu = path.join(app, "portals.yml");
  if (!lier(reel, vu)) return t.skip("liens symboliques indisponibles sur ce poste");
  assert.equal(cheminReel(vu), reel);
});

test("une chaine de liens est suivie jusqu'au bout", (t) => {
  const { volume, app } = bac();
  const reel = path.join(volume, "portals.yml");
  const milieu = path.join(app, "milieu.yml");
  const vu = path.join(app, "portals.yml");
  fs.writeFileSync(reel, "x");
  if (!lier(reel, milieu) || !lier(milieu, vu)) return t.skip("liens symboliques indisponibles sur ce poste");
  assert.equal(cheminReel(vu), reel);
});

test("les droits d'un fichier absent ne sont pas inventes", () => {
  const { app } = bac();
  assert.equal(droitsExistants(path.join(app, "rien.yml")), null);
});

test("le rename ne doit pas rendre un fichier 600 lisible par tous", (t) => {
  // MESURE EN PRODUCTION, 2026-08-11 : au premier ajout d'entreprise,
  // /app/data/perso/portals.yml est passe de -rw------- a -rw-r--r--. Un rename
  // remplace l'inode, donc le fichier renait avec les droits du umask et le 600
  // pose sur la couche utilisateur (CV, profil, recherches) disparait sans bruit.
  if (process.platform === "win32") return t.skip("droits POSIX indisponibles sous Windows");
  const { volume } = bac();
  const cible = path.join(volume, "portals.yml");
  fs.writeFileSync(cible, "avant\n");
  fs.chmodSync(cible, 0o600);
  assert.equal(droitsExistants(cible), 0o600);

  // La sequence exacte de atomicWrite.
  const droits = droitsExistants(cible);
  const tmp = `${cible}.tmp-test`;
  fs.writeFileSync(tmp, "apres\n");
  fs.chmodSync(tmp, droits);
  fs.renameSync(tmp, cible);

  assert.equal(droitsExistants(cible), 0o600, "les droits ont survecu au rename");
  assert.equal(fs.readFileSync(cible, "utf8"), "apres\n");
});

test("une boucle de liens s'arrete au lieu de tourner sans fin", (t) => {
  const { app } = bac();
  const a = path.join(app, "a.yml");
  const b = path.join(app, "b.yml");
  if (!lier(b, a) || !lier(a, b)) return t.skip("liens symboliques indisponibles sur ce poste");
  const rendu = cheminReel(a);
  assert.ok(rendu === a || rendu === b, "un chemin utilisable, pas un depassement de pile");
});
