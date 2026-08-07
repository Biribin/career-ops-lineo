#!/usr/bin/env node
// Fait entrer les offres trouvées par n8n (France Travail) dans le MÊME univers
// de déduplication que le scanner local.
//
// LE PROBLÈME QUE ÇA RÈGLE. Il y avait deux files de triage qui s'ignoraient :
// data/pipeline.md (scanner local) et data/offres-n8n.jsonl (France Travail).
// Une offre vue des deux côtés apparaissait deux fois, et chaque source
// continuait de la resservir puisque aucune ne connaissait l'autre.
//
// POURQUOI L'HISTORIQUE DE SCAN ET NON `## Pending`. Verser ces offres dans la
// section Pending de pipeline.md aurait été la lecture littérale de « fusionner
// les deux files » — et une erreur. Pending est une file de TRAITEMENT : le mode
// `/career-ops pipeline` évalue chaque URL, produit un PDF et candidate. Or ces
// offres-là ont déjà leur propre générateur (le workflow n8n 2, déclenché par le
// bouton « Générer la candidature »). Les mettre dans Pending, c'est deux
// générateurs indépendants sur la même annonce, donc le risque de postuler deux
// fois chez le même employeur.
//
// loadSeenUrls() lit scan-history.tsv ET pipeline.md. Écrire dans l'historique
// suffit donc à fusionner les deux mondes — sans rien mettre dans la file de
// traitement de l'autre générateur.
//
// Écriture par appendToScanHistory(), l'écrivain exporté par scan.mjs : aucune
// écriture directe dans le fichier, comme l'exige le contrat de données.
//
// Entrée  (stdin)  : {"offers": [{url, title, company, location}]}
// Sortie  (stdout) : {"nouvelles": [url], "deja": [url], "enregistrees": n}

import { appendToScanHistory, loadSeenUrls, normalizeUrlForDedup } from './scan.mjs';

/** Tout statut autre que `added` déduplique définitivement (cf.
 *  shouldDedupScanHistoryRow) : une offre n8n ne doit jamais être resservie par
 *  le scanner local. Le libellé dit d'où elle vient, pour l'audit. */
const STATUT = 'n8n_france_travail';

function lisEntree() {
  return new Promise((resolve, reject) => {
    let brut = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => {
      brut += c;
      // Un stdin qui ne se ferme pas ne doit pas faire gonfler la mémoire.
      if (brut.length > 2_000_000) reject(new Error('entrée trop volumineuse'));
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(brut || '{}'));
      } catch (e) {
        reject(new Error(`JSON invalide en entrée : ${e.message}`));
      }
    });
    process.stdin.on('error', reject);
  });
}

const sec = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const { offers } = await lisEntree();
  const liste = Array.isArray(offers) ? offers : [];

  // La politique par défaut suffit : on ne veut pas qu'une offre n8n
  // redevienne « à revoir » au bout de N jours, elle a déjà été triée.
  //
  // L'ensemble couvre scan-history.tsv, pipeline.md ET applications.md — donc
  // une annonce chez qui Linéo a déjà postulé ne peut pas revenir par n8n.
  const { seen: vues } = loadSeenUrls();

  const nouvelles = [];
  const deja = [];
  const aEcrire = [];
  for (const o of liste) {
    const url = sec(o?.url);
    if (!url) continue;
    let cle;
    try {
      cle = normalizeUrlForDedup(url);
    } catch {
      continue;
    }
    if (vues.has(cle)) {
      deja.push(url);
      continue;
    }
    // Deux offres du même lot peuvent porter la même URL : on ne l'écrit
    // qu'une fois, sinon l'historique gagne un doublon dès le premier passage.
    vues.add(cle);
    nouvelles.push(url);
    aEcrire.push({
      url,
      title: sec(o?.title),
      company: sec(o?.company),
      location: sec(o?.location),
    });
  }

  if (aEcrire.length && !dryRun) {
    appendToScanHistory(aEcrire, new Date().toISOString().slice(0, 10), STATUT);
  }

  process.stdout.write(
    JSON.stringify({ nouvelles, deja, enregistrees: dryRun ? 0 : aEcrire.length, dryRun }),
  );
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ error: e?.message || String(e) }));
  process.exit(1);
});
