#!/usr/bin/env node
/**
 * sync-user-layer-tests.mjs — la regle de decision de la synchronisation.
 *
 * Ce qui est teste ici n'est pas le transport (ssh, docker cp) mais la SEULE
 * chose qui peut faire perdre du travail : decider quand ecraser le serveur.
 * Le 2026-08-07, portals.yml avait ete modifie cote serveur par un autre
 * chantier ; une synchronisation naive l'aurait efface.
 *
 * Run: node deploy/sync-user-layer-tests.mjs
 */

import { decide, empreinte, FICHIERS } from './sync-user-layer.mjs';

let passed = 0;
let failed = 0;
function ok(m) { console.log(`PASS ${m}`); passed++; }
function ko(m) { console.error(`FAIL ${m}`); failed++; }
function eq(a, b, m) { (a === b ? ok : () => ko(`${m} — attendu ${b}, obtenu ${a}`))(m); }

// ── Le cas nominal ─────────────────────────────────────────────────────────
eq(decide({ local: 'A', distant: 'A', dernier: 'A' }).action, 'rien',
  'identiques des deux cotes : rien a faire');

eq(decide({ local: 'B', distant: 'A', dernier: 'A' }).action, 'pousser',
  'seul le local a change : on pousse');

// ── Le cas qui protege le travail d'autrui ─────────────────────────────────
eq(decide({ local: 'B', distant: 'C', dernier: 'A' }).action, 'conflit',
  'modifie des DEUX cotes : conflit, on ne touche a rien');

eq(decide({ local: 'A', distant: 'C', dernier: 'A' }).action, 'distant-seul',
  'seul le serveur a change : on le signale, on ne l ecrase pas');

// ── Premiere synchronisation ───────────────────────────────────────────────
eq(decide({ local: 'A', distant: null, dernier: null }).action, 'pousser',
  'absent du serveur : on pousse');

eq(decide({ local: 'B', distant: 'A', dernier: null }).action, 'conflit',
  'jamais synchronise et versions differentes : conflit, pas un ecrasement');

// Le piege : un fichier deja identique mais jamais enregistre dans l'etat ne
// doit pas etre un conflit, sinon la premiere vraie modification en devient un.
eq(decide({ local: 'A', distant: 'A', dernier: null }).action, 'rien',
  'jamais synchronise mais deja identiques : rien a faire');

// ── Fichier local absent ───────────────────────────────────────────────────
eq(decide({ local: null, distant: 'A', dernier: 'A' }).action, 'absent',
  'pas de fichier local : on ne supprime jamais cote serveur');

eq(decide({ local: null, distant: null, dernier: null }).action, 'absent',
  'absent des deux cotes : non-evenement');

// ── L'empreinte ────────────────────────────────────────────────────────────
eq(empreinte('abc'), empreinte('abc'), 'empreinte stable pour un meme contenu');
(empreinte('abc') !== empreinte('abd') ? ok : () => ko('empreintes distinctes'))(
  'un octet de difference change l empreinte');

// ── La liste des fichiers ──────────────────────────────────────────────────
(FICHIERS.length >= 4 ? ok : () => ko('liste des fichiers'))(
  `${FICHIERS.length} fichiers de couche utilisateur declares`);
(FICHIERS.every((f) => f.distant.startsWith('/app/data/perso/')) ? ok : () => ko('chemins distants'))(
  'tous les chemins distants pointent dans le volume persistant');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
