#!/usr/bin/env node
/**
 * sync-user-layer.mjs — pousser la couche utilisateur vers le VPS.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `cv.md`, `config/profile.yml`, `modes/_profile.md` et `portals.yml` sont
 * GITIGNORÉS — c'est voulu, ce sont des données personnelles. Mais Coolify
 * construit l'image depuis un clone git : ces fichiers n'y sont donc jamais, et
 * rien ne les emmène sur le serveur.
 *
 * Conséquence constatée le 2026-08-07 : le `cv.md` du VPS datait du 5 août et
 * annonçait « 203 workflows » pendant que la version locale, plus riche de 3 Ko,
 * en annonçait 213. Pendant deux jours, chaque lettre de motivation et chaque
 * adaptation de CV a été rédigée sur un profil périmé, sans que rien ne le
 * signale. C'est le pire mode de panne : silencieux et plausible.
 *
 * CE QU'IL NE FAIT PAS : écraser à l'aveugle.
 * -------------------------------------------
 * Le serveur n'est pas qu'un miroir. `portals.yml` y a été modifié le
 * 2026-08-07 par un autre chantier (il en reste un `.bak-avant-scraper`).
 * Écraser aurait perdu ce travail. D'où l'état de synchronisation : on retient
 * l'empreinte de ce qui a été poussé la dernière fois, et
 *
 *   - le distant a bougé depuis, et le local aussi  → CONFLIT, on ne touche à rien
 *   - seul le local a bougé                          → on pousse
 *   - seul le distant a bougé                        → on le signale, on ne l'écrase pas
 *   - rien n'a bougé                                 → rien à faire
 *
 * Une sauvegarde horodatée est déposée à côté du fichier distant avant chaque
 * écriture. Un `--dry-run` dit ce qui partirait sans rien envoyer.
 *
 * Usage :
 *   node deploy/sync-user-layer.mjs [--dry-run] [--force] [--json]
 *
 *   --force  pousse malgré un conflit (la sauvegarde distante reste faite)
 *
 * Réglages (variables d'environnement) :
 *   CAREER_OPS_VPS_HOST      hôte ssh          (défaut : balzac-vps)
 *   CAREER_OPS_VPS_APP_GLOB  préfixe du conteneur Coolify
 *                            (défaut : ceb24qa8tw5f4zvvlakyuza6)
 *
 * ⚠️ Le nom du conteneur change à CHAQUE déploiement : il est résolu à chaque
 * exécution depuis le préfixe, jamais codé en dur.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOTE = process.env.CAREER_OPS_VPS_HOST || 'balzac-vps';
const PREFIXE = process.env.CAREER_OPS_VPS_APP_GLOB || 'ceb24qa8tw5f4zvvlakyuza6';
const ETAT = join(ROOT, '.career-ops-web', 'sync-user-layer.json');

/** local (relatif à la racine) → distant (dans le conteneur). */
export const FICHIERS = [
  { local: 'cv.md', distant: '/app/data/perso/cv.md' },
  { local: 'modes/_profile.md', distant: '/app/data/perso/_profile.md' },
  { local: 'config/profile.yml', distant: '/app/data/perso/profile.yml' },
  { local: 'portals.yml', distant: '/app/data/perso/portals.yml' },
];

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const FORCE = args.includes('--force');
const JSON_OUT = args.includes('--json');

export function empreinte(contenu) {
  return createHash('sha256').update(contenu).digest('hex').slice(0, 16);
}

/**
 * Décide quoi faire d'un fichier. Partie PURE : c'est elle qui porte la règle,
 * donc elle est testable sans VPS ni conteneur.
 *
 * @param {{local: string|null, distant: string|null, dernier: string|null}} e
 *   Empreintes. `null` = fichier absent.
 * @returns {{action: 'pousser'|'rien'|'conflit'|'distant-seul'|'absent', motif: string}}
 */
export function decide({ local, distant, dernier }) {
  if (local == null) return { action: 'absent', motif: 'pas de fichier local' };
  if (local === distant) return { action: 'rien', motif: 'identiques' };

  // Jamais synchronisé : on ne peut pas savoir qui a raison. Si le distant
  // existe et diffère, c'est un conflit — pas une occasion d'écraser.
  if (dernier == null) {
    return distant == null
      ? { action: 'pousser', motif: 'absent du serveur' }
      : { action: 'conflit', motif: 'jamais synchronise et les deux versions different' };
  }

  const distantABouge = distant !== dernier;
  const localABouge = local !== dernier;

  if (distantABouge && localABouge) {
    return { action: 'conflit', motif: 'modifie des deux cotes depuis la derniere synchro' };
  }
  if (distantABouge) {
    return { action: 'distant-seul', motif: 'seul le serveur a change, le local est en retard' };
  }
  return { action: 'pousser', motif: 'seul le local a change' };
}

// ── À partir d'ici : les effets de bord ────────────────────────────────────

function sh(cmd, argv) {
  return execFileSync(cmd, argv, { encoding: 'utf-8', timeout: 120000 }).trim();
}

/** Le conteneur Coolify du moment. Son nom change à chaque déploiement. */
function conteneur() {
  const noms = sh('ssh', [HOTE, `docker ps --format '{{.Names}}'`])
    .split('\n')
    .map((s) => s.trim())
    .filter((n) => n.startsWith(PREFIXE));
  if (noms.length === 0) throw new Error(`aucun conteneur commencant par ${PREFIXE} sur ${HOTE}`);
  return noms[0];
}

function empreinteDistante(ct, chemin) {
  const out = sh('ssh', [HOTE, `docker exec ${ct} sh -lc 'sha256sum ${chemin} 2>/dev/null || true'`]);
  const m = out.match(/^([0-9a-f]{64})/);
  return m ? m[1].slice(0, 16) : null;
}

function litEtat() {
  try {
    return JSON.parse(readFileSync(ETAT, 'utf-8'));
  } catch {
    return {};
  }
}

function ecritEtat(etat) {
  mkdirSync(dirname(ETAT), { recursive: true });
  writeFileSync(ETAT, JSON.stringify(etat, null, 2) + '\n', 'utf-8');
}

function main() {
  const ct = conteneur();
  const etat = litEtat();
  const horodatage = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '');
  const rapport = [];

  for (const f of FICHIERS) {
    const chemin = join(ROOT, f.local);
    const local = existsSync(chemin) ? empreinte(readFileSync(chemin)) : null;
    const distant = empreinteDistante(ct, f.distant);
    const { action, motif } = decide({ local, distant, dernier: etat[f.local] ?? null });

    let fait = action;
    if ((action === 'pousser' || (action === 'conflit' && FORCE)) && !DRY) {
      // Sauvegarde AVANT toute ecriture, y compris en --force : un conflit force
      // reste recuperable.
      if (distant != null) {
        sh('ssh', [HOTE, `docker exec ${ct} sh -lc 'cp ${f.distant} ${f.distant}.bak-${horodatage}'`]);
      }
      sh('scp', ['-q', chemin, `${HOTE}:/tmp/sync-user-layer.tmp`]);
      sh('ssh', [
        HOTE,
        `docker cp /tmp/sync-user-layer.tmp ${ct}:${f.distant} && ` +
          `docker exec ${ct} sh -lc 'chmod 600 ${f.distant}' && rm -f /tmp/sync-user-layer.tmp`,
      ]);
      etat[f.local] = local;
      fait = 'pousse';
    } else if (action === 'rien') {
      // Aligner l'etat meme sans ecriture : sinon un fichier deja identique
      // resterait eternellement « jamais synchronise » et le premier vrai
      // changement passerait pour un conflit.
      etat[f.local] = local;
    }

    rapport.push({ fichier: f.local, action: fait, motif, local, distant });
  }

  if (!DRY) ecritEtat(etat);

  if (JSON_OUT) {
    console.log(JSON.stringify({ conteneur: ct, dryRun: DRY, fichiers: rapport }, null, 2));
  } else {
    console.log(`Conteneur : ${ct}${DRY ? '   (essai a blanc)' : ''}`);
    for (const r of rapport) {
      const icone = { pousse: '↑', rien: '=', conflit: '!', 'distant-seul': '<', absent: '?', pousser: '↑' }[r.action] ?? '·';
      console.log(`  ${icone} ${r.fichier.padEnd(22)} ${r.action.padEnd(13)} ${r.motif}`);
    }
    const conflits = rapport.filter((r) => r.action === 'conflit');
    if (conflits.length) {
      console.error(
        `\n⚠ ${conflits.length} conflit(s) : le serveur a change de son cote. ` +
          `Comparer avant de trancher, puis --force pour imposer le local ` +
          `(une sauvegarde distante est faite dans tous les cas).`,
      );
    }
  }

  // Un conflit non resolu doit se voir dans un ordonnanceur : code de sortie 2.
  return rapport.some((r) => r.action === 'conflit') ? 2 : 0;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href) {
  try {
    process.exit(main());
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}
