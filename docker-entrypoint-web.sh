#!/bin/sh
# Entrypoint du cockpit web career-ops (VPS Coolify).
#
# Pourquoi il existe : cv.md, config/profile.yml, portals.yml et modes/_profile.md
# sont GITIGNORES (PII). Coolify construit l'image depuis le depot git -> ces
# quatre fichiers sont ABSENTS de l'image, et sans eux le coeur ne fonctionne pas :
#   - /api/run kind=evaluate refuse de scorer (400 "Ajoutez d'abord votre CV")
#   - /api/tailor repond 503 (pas de cv.md = pas de mots-cles vrais garantis)
#   - doctor.mjs les liste en warnings
#
# Solution : ils vivent sur le VOLUME persistant (monte sur /app/data), dans
# $CAREER_OPS_PERSO_DIR, et on les relie dans /app a chaque demarrage. Le volume
# survit aux redeploys, l'image ne contient toujours aucune donnee personnelle.
#
# Idempotent et non destructif : si le volume n'a pas le fichier mais que /app
# l'a (installation locale complete), on amorce le volume depuis /app au lieu
# d'ecraser quoi que ce soit.
#
# Les ecritures de l'app suivent ces liens : safe-write.ts resout la cible AVANT
# d'ecrire (chemin-reel.mjs), donc le temporaire et le rename se font dans $PERSO
# et le lien reste un lien. Jusqu'au 2026-08-11 le rename se faisait SUR le lien
# et le remplacait par un fichier reel de la couche conteneur : l'ecriture
# reussissait et disparaissait au redeploy suivant, sans un mot.
#
# ATTENTION quand meme : un script du coeur lance A LA MAIN qui renomme sur /app
# (par ex. `node discover-ats.mjs --write`) casse toujours le lien. Viser $PERSO.

set -e

PERSO="${CAREER_OPS_PERSO_DIR:-/app/data/perso}"

# lier <chemin relatif dans /app> <nom du fichier sur le volume>
lier() {
  dest="/app/$1"
  cible="$PERSO/$2"

  # Amorcage : le volume est vide mais l'image/le conteneur a un vrai fichier.
  if [ ! -e "$cible" ] && [ -f "$dest" ] && [ ! -L "$dest" ]; then
    mkdir -p "$PERSO"
    cp "$dest" "$cible"
    echo "entrypoint: $2 copie vers le volume (amorcage)"
  fi

  # Rien sur le volume -> on ne touche a rien (doctor le signalera en warning).
  [ -e "$cible" ] || { echo "entrypoint: $2 absent du volume - ignore"; return 0; }

  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  ln -s "$cible" "$dest"
  echo "entrypoint: /app/$1 -> $cible"
}

lier cv.md              cv.md
lier portals.yml        portals.yml
lier config/profile.yml profile.yml
lier modes/_profile.md  _profile.md

# Cle(s) d'API optionnelles posees sur le volume plutot que dans Coolify.
# Les .mjs racine chargent dotenv, et le Gemini CLI lit aussi le fichier depuis
# son cwd (/app). Les variables d'environnement Coolify restent prioritaires.
lier .env               career-ops.env

exec "$@"
