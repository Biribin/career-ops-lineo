import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { careerOpsRoot, readInbox, rootScript } from "@/lib/career-ops";
import { paramsToFilters } from "@/lib/explore";
import { classerOffres } from "@/lib/scan-rank.mjs";
import { titresCibles } from "@/lib/tailor.mjs";
import { lireFiltresPortals } from "@/lib/core/portals";

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
// GRATUIT, zéro token. Le scanner (`scan-ats-full.mjs`) ne fait que du HTTP et du
// JSON ; le classement est déterministe (@/lib/scan-rank.mjs). L'évaluation par
// LLM — la vraie note de fit sur 5 — reste une étape séparée et explicite.
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
// quel — instantané et sans réseau).
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
      { cwd: careerOpsRoot(), timeout: 280_000, maxBuffer: 64 * 1024 * 1024 },
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

  let charge: ChargeScanner | null = null;
  let error: string | null = null;
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
    ({ charge, error } = await lancerScan(args));
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
