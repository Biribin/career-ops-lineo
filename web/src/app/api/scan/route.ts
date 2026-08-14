import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot, readInbox, rootScript } from "@/lib/career-ops";
import { paramsToFilters } from "@/lib/explore";
import { classerOffres } from "@/lib/scan-rank.mjs";
import { titresCibles } from "@/lib/tailor.mjs";
import { lireFiltresPortals } from "@/lib/core/portals";
import { compteur, derniereLigneRun } from "@/lib/scan-runs.mjs";

export const runtime = "nodejs";
// Un balayage d'annuaires ATS est borné par le réseau, pas par le CPU. Même
// plafond que /api/explore, qui lance le même scanner.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// GET /api/scan — déclenche un scan puis renvoie les meilleures offres en attente.
//
//   { offres: [{ url, entreprise, poste, lieu, publiee_le, pertinence, raisons, mots_cles }],
//     scan: {...}|null, pipeline: {...}, error: string|null }
//
// Ce n'est PAS un des deux contrats figés pour n8n (seuls GET /api/followups et
// POST /api/tailor le sont) : la forme peut encore bouger, et la session n8n ne
// doit pas s'y accrocher sans se resynchroniser.
//
// TROIS BALAYAGES, trois gisements. `scan-ats-full.mjs` parcourt les ANNUAIRES
// d'ATS (découverte inversée : des entreprises qu'on ne suit pas encore) ;
// `scan.mjs --only boards` interroge les BOARDS déclarés dans portals.yml (APEC,
// Choisir le Service Public, Emploi Territorial, HelloWork, SolidJobs…) ;
// `scan.mjs --only companies` interroge les ENTREPRISES SUIVIES.
//
// Les deux derniers manquaient, et leur absence était totale : `scan-ats-full.mjs`
// ne lit ni `job_boards` ni `tracked_companies` (zéro occurrence), donc une entrée
// activée n'était jamais balayée par une tournée automatique — seulement par un
// `node scan.mjs` lancé à la main. Coupables avec `boards=0` et `companies=0`.
//
// GRATUIT, zéro token. Les deux scanners ne font que du HTTP et du JSON ; le
// classement est déterministe (@/lib/scan-rank.mjs). L'évaluation par LLM — la
// vraie note de fit sur 5 — reste une étape séparée et explicite.
//
// Un GET qui ÉCRIT, c'est voulu : c'est la forme qu'un cron n8n sait appeler sans
// corps de requête. Ce qu'il écrit est borné et passe par l'écrivain sanctionné —
// `scan-ats-full.mjs` ajoute les nouvelles offres à data/pipeline.md sous
// `pipeline-lock.mjs`, exactement comme le CLI. Rien d'autre n'est touché : ni le
// tracker, ni portals.yml (contrairement à /api/explore, on lit ici les VRAIS
// filtres de Linéo, pas un fichier éphémère). `?dry=1` prévisualise sans écrire.
//
// Paramètres : `since` (jours, 1-60, défaut 7), `limit` (entreprises par ATS,
// 50-500, défaut 150), `ats` (sous-ensemble), `top` (offres rendues, défaut 10),
// `dry=1` (aucune écriture), `rescan=0` (ne relance rien, classe pipeline.md tel
// quel — instantané et sans réseau), `boards=0` et `companies=0` (sautent chacun
// un des deux balayages de portals.yml).
//
// Le plafond `limit` n'est pas cosmétique : sans `--limit`, le scanner balaie TOUS
// les annuaires (des heures). Le défaut de l'Explorer est repris tel quel pour que
// les deux surfaces ne divergent pas.

type ChargeScanner = {
  date?: string;
  /** BOOLÉEN côté cœur — « les résultats ont-ils été écrits », pas un compteur.
   *  Le nombre d'offres, c'est `postingsKept`. */
  saved?: boolean;
  postingsKept?: number;
  postingsDroppedNoDate?: number;
  capHit?: boolean;
  stoppedByOutage?: boolean;
  datasetStatus?: Record<string, string>;
  unreachableBoards?: number;
  companiesScanned?: number;
  companiesAvailable?: number;
};

/** Lance `scan-ats-full.mjs --json`. En mode JSON, stdout ne porte QUE l'objet
 *  machine (les logs humains vont sur stderr), donc on parse stdout entier.
 *  Renvoie aussi le message d'erreur du process quand il a échoué : un scan qui
 *  casse doit se distinguer d'un scan qui n'a rien trouvé. */
async function lancerScan(
  args: string[],
  timeoutMs = 280_000,
): Promise<{ charge: ChargeScanner | null; error: string | null }> {
  const script = rootScript("scan-ats-full");
  if (!fs.existsSync(script)) {
    return { charge: null, error: "Le scanner scan-ats-full.mjs est absent de cette installation." };
  }
  return new Promise((resolve) => {
    execFile(
      "node",
      [script, "--json", ...args],
      // Un balayage complet peut rendre beaucoup de JSON : le maxBuffer par
      // défaut (1 Mo) tronquerait la sortie et on ne verrait qu'un JSON invalide.
      { cwd: careerOpsRoot(), timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const brut = String(stdout || "").trim();
        const debut = brut.indexOf("{");
        if (debut !== -1) {
          try {
            return resolve({ charge: JSON.parse(brut.slice(debut)) as ChargeScanner, error: null });
          } catch {
            /* JSON illisible → on retombe sur le message d'erreur ci-dessous */
          }
        }
        // stderr porte la progression humaine ; on n'en garde que la fin, et
        // seulement en cas d'échec, pour ne pas noyer la réponse.
        const fin = String(stderr || "").trim().split("\n").filter(Boolean).slice(-3).join(" · ");
        resolve({
          charge: null,
          error:
            (err && /timed out|ETIMEDOUT/i.test(String(err.message))
              ? "Le scan a dépassé le temps imparti — relance avec un `limit` plus bas, ou `rescan=0` pour classer l'existant."
              : fin || "Le scan n'a rien renvoyé d'exploitable.") ,
        });
      },
    );
  });
}

// ── Le balayage des BOARDS de portals.yml ────────────────────────────────────
//
// Il manquait, et l'angle mort était total : `job_boards` n'est lu que par
// `scan.mjs`, alors que cette route lance `scan-ats-full.mjs`, qui parcourt les
// ANNUAIRES d'ATS (découverte inversée) et ne lit ni `job_boards` ni
// `tracked_companies`. Un board pouvait donc être configuré et activé depuis des
// mois sans qu'une seule tournée automatique ne le touche — constaté le
// 2026-08-14 sur `SolidJobs IT` (activé de longue date) et sur les quatre
// sources françaises tout juste ajoutées.
//
// D'où `--only boards` : la route ne peut pas lancer un `scan.mjs` complet, dont
// les 116 entreprises suivies dépassent son plafond de 300 s.

/** Les compteurs que `scan.mjs` persiste lui-même, une ligne par tournée non-dry. */
type LigneRun = Record<string, string>;

/** Le seul accès disque : la logique de lecture vit dans `scan-runs.mjs`, pure et
 *  testée (colonnes lues par en-tête, ligne d'une AUTRE tournée refusée). */
function dernierRun(depuis: number): LigneRun | null {
  try {
    const brut = fs.readFileSync(path.join(careerOpsRoot(), "data", "scan-runs.tsv"), "utf8");
    return derniereLigneRun(brut, depuis) as LigneRun | null;
  } catch {
    // Fichier absent = aucune tournée jamais enregistrée. État normal.
    return null;
  }
}

/**
 * Lance `scan.mjs --only <section>` pour UNE des deux sections de portals.yml.
 * Les nouvelles offres atterrissent dans `data/pipeline.md` par l'écrivain
 * sanctionné du cœur (sous `pipeline-lock`), exactement comme au terminal —
 * cette route n'écrit rien elle-même.
 *
 * Une fonction pour les deux sections, et deux appels séquentiels plutôt qu'un
 * `scan.mjs` complet : les compteurs restent séparés, donc on sait lequel des
 * deux gisements rapporte, et un timeout sur l'un n'emporte pas l'autre.
 */
async function lancerScanSection(
  section: "boards" | "companies",
  { dry, timeoutMs }: { dry: boolean; timeoutMs: number },
): Promise<{ run: LigneRun | null; error: string | null; lance: boolean }> {
  const script = rootScript("scan");
  if (!fs.existsSync(script)) {
    return { run: null, error: "Le scanner scan.mjs est absent de cette installation.", lance: false };
  }
  const depuis = Date.now();
  const quoi = section === "boards" ? "boards" : "entreprises suivies";
  return new Promise((resolve) => {
    execFile(
      "node",
      [script, "--only", section, "--quiet", ...(dry ? ["--dry-run"] : [])],
      { cwd: careerOpsRoot(), timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        // Un `--dry-run` ne persiste RIEN par construction : ne pas aller chercher
        // une ligne de compteurs qui n'existera pas, et le dire.
        const run = dry ? null : dernierRun(depuis);
        if (!err) return resolve({ run, error: null, lance: true });
        const fin = String(stderr || "").trim().split("\n").filter(Boolean).slice(-2).join(" · ");
        resolve({
          run,
          error: /timed out|ETIMEDOUT/i.test(String(err.message))
            ? `Le balayage des ${quoi} a dépassé le temps imparti — réduis le nombre d'entrées actives dans portals.yml.`
            : fin || String(err.message),
          lance: true,
        });
      },
    );
  });
}

/** Les intitulés visés, depuis config/profile.yml. Absent ou illisible => aucun
 *  signal d'intitulé, jamais une cible devinée. */
function ciblesProfil(): string[] {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(careerOpsRoot(), "config", "profile.yml"), "utf8"));
    return titresCibles(doc).map((t: { nom: string }) => t.nom);
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const filtres = paramsToFilters(sp);
  const top = Math.min(50, Math.max(1, Number(sp.get("top")) || 10));
  const dry = sp.get("dry") === "1";
  const rescan = sp.get("rescan") !== "0";

  // `boards=0` / `companies=0` coupent les balayages de portals.yml. Activés par
  // défaut tous les deux : une entrée configurée et jamais balayée est le défaut
  // qu'on corrige ici, pas une option à réactiver.
  const avecBoards = sp.get("boards") !== "0";
  const avecEntreprises = sp.get("companies") !== "0";

  let charge: ChargeScanner | null = null;
  let error: string | null = null;
  let boards: Awaited<ReturnType<typeof lancerScanSection>> | null = null;
  let entreprises: Awaited<ReturnType<typeof lancerScanSection>> | null = null;

  // TROIS GISEMENTS, dans cet ordre, et l'ordre porte une décision de budget.
  //
  //   1. les boards de portals.yml      — liste finie, ~40 s mesurées
  //   2. les entreprises suivies        — 88 entrées routées, 22 s mesurées
  //   3. les annuaires d'ATS            — le seul qui sature son propre `limit`
  //
  // Les trois se partagent le plafond de 300 s de la route. Le balayage
  // d'annuaires passe donc en DERNIER avec le temps restant : c'est lui qui rend
  // une moisson partielle, ce qu'il annonce déjà par `plafond_atteint`, au lieu
  // de faire sauter les deux autres en silence.
  //
  // ⚠️ Le balayage des ENTREPRISES a été ajouté le 2026-08-14, et son absence
  // était un angle mort complet : `scan-ats-full.mjs` ne lit pas
  // `tracked_companies` (zéro occurrence), donc les 119 entreprises suivies
  // n'étaient balayées par AUCUNE automatisation — seulement par un
  // `node scan.mjs` lancé à la main. Mesuré avant de le brancher : 22 s,
  // 5 325 offres lues, 144 offres neuves qui n'entraient jamais dans le pipeline.
  // La PR précédente justifiait leur absence par un dépassement du plafond de
  // 300 s ; c'était une supposition, et elle était fausse.
  //
  // Séquentiel et non parallèle : les trois écrivent dans data/pipeline.md, et
  // même si `pipeline-lock` le rend sûr, des balayages concurrents se
  // disputeraient le verrou pour ne rien gagner (leur coût est le réseau).
  const debut = Date.now();
  if (rescan && avecBoards) {
    boards = await lancerScanSection("boards", { dry, timeoutMs: 120_000 });
  }
  if (rescan && avecEntreprises) {
    entreprises = await lancerScanSection("companies", { dry, timeoutMs: 120_000 });
  }

  if (rescan) {
    const args = [
      "--since",
      String(filtres.sinceDays),
      "--limit",
      String(filtres.limitPerAts),
      "--ats",
      filtres.ats.join(","),
      ...(dry ? ["--dry-run"] : []),
    ];
    // Le reste du budget, jamais moins de 30 s : un plafond dérisoire ferait
    // échouer le balayage sur un timeout plutôt que sur son propre plafond.
    const restant = Math.max(30_000, 280_000 - (Date.now() - debut));
    ({ charge, error } = await lancerScan(args, restant));
  }

  // pipeline.md est relu APRÈS le scan : c'est là que les nouvelles offres ont
  // atterri, et la liste rendue est donc l'état réel du pipeline (nouvelles +
  // restes des scans précédents), pas seulement la moisson de cette minute.
  //
  // `lireFiltresPortals` et non `seedExploreFilters` : ce dernier plafonne à 16
  // mots-clés (CHIP_CAP, pour la rangée de chips de l'Explorateur) et amputerait
  // la liste de Linéo de ses 26 entrées les plus précises — le classement
  // deviendrait plus grossier que sa config, sans rien dire.
  const filtres_portails = lireFiltresPortals();
  const cibles = ciblesProfil();
  const { classees, exclues, dejaTraitees } = classerOffres(readInbox(), {
    positifs: filtres_portails.positive,
    negatifs: filtres_portails.negative,
    lieuxOk: [...filtres_portails.alwaysAllow, ...filtres_portails.allow],
    lieuxBloques: filtres_portails.block,
    cibles,
    // La date du scanner quand il en a rendu une (elle datera la fraîcheur
    // exactement comme lui) ; sinon celle du serveur.
    aujourdhui: charge?.date ?? new Date().toISOString().slice(0, 10),
  });

  return Response.json({
    offres: classees.slice(0, top).map((o) => ({
      url: o.url,
      entreprise: o.company,
      poste: o.role,
      lieu: o.location ?? null,
      publiee_le: o.postedAt ?? null,
      pertinence: o.pertinence,
      raisons: o.raisons,
      mots_cles: o.motsCles,
    })),
    // `null` = aucun scan lancé (rescan=0). À distinguer d'un scan lancé qui n'a
    // rien trouvé, où tous les compteurs valent 0.
    scan: charge
      ? {
          date: charge.date ?? null,
          entreprises_scannees: charge.companiesScanned ?? 0,
          // Le dénominateur rend `plafond_atteint` interprétable : « 50 sur 8333 »
          // dit tout de suite qu'on a effleuré l'annuaire, pas qu'il est vide.
          entreprises_disponibles: charge.companiesAvailable ?? 0,
          offres_gardees: charge.postingsKept ?? 0,
          // Booléen, pas un compteur — c'est la sémantique du cœur (`saved`), et
          // un `--dry-run` n'écrit par construction jamais rien.
          enregistre: dry ? false : Boolean(charge.saved),
          sans_date_ecartees: charge.postingsDroppedNoDate ?? 0,
          annuaires_injoignables: charge.unreachableBoards ?? 0,
          // Trois façons dont un scan peut être INCOMPLET sans être en erreur.
          // Sans elles, « 0 offre » se lit comme « rien à trouver ». `plafond_atteint`
          // est vrai dès que `limit` borne le balayage — donc presque toujours ici,
          // et c'est exact : un scan borné n'a pas vu tout l'annuaire.
          plafond_atteint: Boolean(charge.capHit),
          interrompu: Boolean(charge.stoppedByOutage),
          dataset: charge.datasetStatus ?? null,
          apercu: dry,
        }
      : null,
    // Le balayage des `job_boards` de portals.yml — APEC, Choisir le Service
    // Public, Emploi Territorial, HelloWork, SolidJobs… Distinct de `scan`
    // ci-dessus, qui parcourt les annuaires d'ATS : deux gisements différents,
    // deux jeux de compteurs, et les mélanger empêcherait de savoir lequel
    // rapporte.
    //
    // `null` = non lancé (rescan=0 ou boards=0). Compteurs `null` en aperçu :
    // un --dry-run ne persiste aucune ligne de tournée, et inventer des zéros
    // ferait passer un aperçu pour une tournée vide.
    boards: boards
      ? {
          lance: boards.lance,
          apercu: dry,
          erreur: boards.error,
          balayes: compteur(boards.run?.boards),
          offres_trouvees: compteur(boards.run?.found),
          ajoutees_au_pipeline: compteur(boards.run?.new_added),
          ecartees_par_intitule: compteur(boards.run?.filtered_title),
          ecartees_par_lieu: compteur(boards.run?.filtered_location),
          doublons: compteur(boards.run?.dupes),
          erreurs_de_source: compteur(boards.run?.errors),
        }
      : null,
    // Les `tracked_companies` de portals.yml — le gisement qu'AUCUNE
    // automatisation ne touchait avant le 2026-08-14. Compteurs distincts de
    // `scan` et de `boards` : trois gisements, trois mesures, sinon on ne sait
    // plus lequel rapporte.
    entreprises: entreprises
      ? {
          lance: entreprises.lance,
          apercu: dry,
          erreur: entreprises.error,
          balayees: compteur(entreprises.run?.companies),
          offres_trouvees: compteur(entreprises.run?.found),
          ajoutees_au_pipeline: compteur(entreprises.run?.new_added),
          ecartees_par_intitule: compteur(entreprises.run?.filtered_title),
          ecartees_par_lieu: compteur(entreprises.run?.filtered_location),
          doublons: compteur(entreprises.run?.dupes),
          erreurs_de_source: compteur(entreprises.run?.errors),
        }
      : null,
    pipeline: {
      en_attente: classees.length,
      rendues: Math.min(top, classees.length),
      deja_traitees: dejaTraitees,
      exclues_par_les_filtres: exclues,
      // Sans mots-clés ni intitulés cibles, tout sort à 0 et l'ordre n'a plus de
      // sens : il faut le dire plutôt que de servir un classement vide de sens.
      classement_actif: filtres_portails.positive.length > 0 || cibles.length > 0,
    },
    error,
  });
}
