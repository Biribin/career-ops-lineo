import { spawn } from "node:child_process";
import { resolveCli } from "@/lib/clis";
import { careerOpsRoot } from "@/lib/career-ops";
import { nettoieSortie } from "@/lib/openai-shim.mjs";
import { comptesDisponibles, estPlafond } from "@/lib/llm-quota.mjs";

// Exécution d'un prompt par le CLI agentique local (Claude Code sur l'abonnement
// Max = coût marginal nul), partagée par les trois routes du shim :
//   /api/llm/v1/chat/completions   (Chat Completions)
//   /api/llm/v1/responses          (Responses API)
//   /api/llm/v1/models             (liste, pour la validation de modèle)
//
// POURQUOI TROIS ROUTES
// ---------------------
// Le sous-nœud « OpenAI Chat Model » de n8n n'appelle pas toujours le même
// endpoint : selon `responsesApiEnabled` il vise /chat/completions ou /responses,
// et il peut valider le modèle via /models. Au premier run réel (exécution
// 959526) il a pris un 404 et l'a traduit en « The model career-ops-cli does not
// exist » — un message trompeur, puisque le vrai problème était le CHEMIN.
// On implémente donc les trois plutôt que de deviner lequel, et on arrête de
// payer un cycle de redéploiement par hypothèse.

export const CLI_DEFAUT = "claude";

/**
 * Budget d'un appel au CLI.
 *
 * Porté de 280 s à 900 s le 2026-08-10. Ce qui commande cette valeur, c'est la
 * SORTIE, pas le prompt : le tri de la tournée demande jusqu'à 60 offres
 * retenues, donc 60 phrases `whyMatch` à rédiger. Mesuré à lot d'entrée
 * identique (409 offres brutes, 150 soumises au modèle) :
 *
 *   max=5   ->  60 s, réussi
 *   max=60  -> 285 s, CLI tué au plafond de 280 s
 *
 * `maxRetenues: 60` (nœud « ⚙️ Config » du workflow) et un plafond à 280 s
 * étaient donc incompatibles : la tournée de 9h échouait chaque jour.
 *
 * ⚠️ CES TROIS BUDGETS SE TIENNENT, NE JAMAIS EN BOUGER UN SEUL :
 *   1. ici, TIMEOUT_CLI_MS ................................ 900 s
 *   2. `maxDuration` de la route /api/rank ................ 950 s
 *   3. le timeout du nœud n8n « career-ops: tri des offres » 950 s
 * Relever le plus court sans les autres ne corrige rien : ça déplace juste
 * l'endroit où la chaîne casse.
 *
 * 900 s pour une tournée de fond déclenchée par un cron à 9h ne coûte rien :
 * personne n'attend devant l'écran.
 */
const TIMEOUT_CLI_MS = 900_000;

export type ResultatLlm =
  | { ok: true; texte: string; cliId: string; compte: string }
  | { ok: false; message: string; status: number };

/**
 * Exécute un prompt, en basculant automatiquement de compte si le premier est
 * plafonné.
 *
 * LE DANGER QU'ON DÉSAMORCE ICI : quand l'abonnement est épuisé, le CLI ne plante
 * pas, il RÉPOND « You've hit your weekly limit… » avec un code de sortie 0. Sans
 * la détection de `llm-quota.mjs`, ce texte devient le corps d'une lettre de
 * motivation, commitée dans le repo cv, rendue en PDF et envoyée à un recruteur.
 * On teste donc chaque sortie avant de la rendre.
 *
 * Comptes essayés dans l'ordre : l'environnement tel quel, puis
 * CLAUDE_CODE_OAUTH_TOKEN_2, _3… (convention déjà retenue par /api/forum-judge).
 * Aucune valeur de jeton ne transite par le code : seuls des NOMS de variables.
 */
export async function executeLlm(prompt: string, cliIdDemande?: string): Promise<ResultatLlm> {
  const cliId = (cliIdDemande || CLI_DEFAUT).trim();
  const resolved = resolveCli(cliId);
  if (!resolved) {
    return { ok: false, message: `CLI '${cliId}' introuvable sur cette machine`, status: 503 };
  }

  // BASCULE DE COMPTE : ACTIVE PAR DÉFAUT.
  //
  // Mesuré le 2026-08-06 sur le VPS, en comparant les empreintes SHA-256 des
  // jetons (jamais leurs valeurs) : les deux comptes ne sont PAS équivalents.
  // compte1 répond normalement, compte2 est plafonné pour la semaine. Basculer,
  // c'est donc « pointer vers le compte qui marche » — ce que la règle de
  // rotation de Linéo autorise explicitement — et non « cumuler du quota », ce
  // qu'elle interdit.
  //
  // Mettre LLM_BASCULE_SUR_PLAFOND=0 pour l'interdire et remonter un 429 sec.
  // À faire si on veut qu'un plafond soit BRUYANT plutôt que rattrapé : la
  // bascule a l'inconvénient de masquer un jeton mal configuré.
  const bascule = String(process.env.LLM_BASCULE_SUR_PLAFOND ?? "1").trim() !== "0";
  const tous = cliId === CLI_DEFAUT ? comptesDisponibles(process.env) : [{ id: "compte-1", varJeton: null }];
  const comptes = bascule ? tous : tous.slice(0, 1);

  let dernierPlafond = "";
  for (const compte of comptes) {
    const env = compte.varJeton
      ? { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: process.env[compte.varJeton] }
      : process.env;

    const r = await lanceUneFois(prompt, cliId, resolved, env);

    if (r.plafond) {
      // On garde la trace du message pour le rendre si TOUS les comptes sont
      // épuisés, mais on ne le rend jamais comme une réponse du modèle.
      dernierPlafond = r.message;
      continue;
    }
    if (!r.ok) return { ok: false, message: r.message, status: r.status };
    return { ok: true, texte: r.texte, cliId, compte: compte.id };
  }

  // Tous les comptes plafonnés → 429, pour que n8n retente plus tard et ne
  // marque RIEN comme traité. Une offre non traitée se rattrape ; une lettre
  // vide envoyée à un recruteur, non.
  return {
    ok: false,
    status: 429,
    message:
      `plafond atteint (${comptes.length} compte(s) essaye(s)) : ` +
      (dernierPlafond || "plafond atteint") +
      ". Verifier lequel des comptes est plafonne." +
      (bascule
        ? " Ajouter un compte via CLAUDE_CODE_OAUTH_TOKEN_2 dans Coolify."
        : " Bascule desactivee (LLM_BASCULE_SUR_PLAFOND=0) : un seul compte a ete essaye."),
  };
}

type Essai =
  | { ok: true; texte: string; plafond: false }
  | { ok: false; message: string; status: number; plafond: boolean };

function lanceUneFois(
  prompt: string,
  cliId: string,
  resolved: NonNullable<ReturnType<typeof resolveCli>>,
  env: NodeJS.ProcessEnv,
): Promise<Essai> {
  const { spec, binPath } = resolved;

  // Tous les outils coupés : le prompt contient déjà tout le contexte, le modèle
  // n'a qu'à répondre. Un agent qui lirait des fichiers ou ferait des recherches
  // web ici serait lent et imprévisible.
  //
  // LE PROMPT PART SUR STDIN, JAMAIS EN ARGUMENT
  // -------------------------------------------
  // Linux plafonne UN argument à 128 Ko (MAX_ARG_STRLEN = 32 pages), et ce
  // plafond est indépendant d'ARG_MAX (2 Mo dans le conteneur). Au-delà, `spawn`
  // échoue en E2BIG avant même de lancer le binaire.
  //
  // Reproduit le 2026-08-10 dans le conteneur career-ops : un prompt de 148 000
  // caractères passé en `-p <prompt>` rend E2BIG, le même sur stdin passe. C'est
  // exactement ce qui cassait la tournée depuis que MAX_OFFRES est monté à 150 :
  // 150 offres font ~148 Ko de prompt, /api/rank rendait « spawn E2BIG » en 500,
  // et la tournée n'enregistrait rien. À 60 offres (~63 Ko) le plafond ne mordait
  // pas, d'où un bug invisible jusqu'au passage en France entière.
  //
  // `claude -p` sans prompt positionnel lit stdin : vérifié dans le conteneur.
  const surStdin = cliId === CLI_DEFAUT;
  const args = surStdin
    ? [
        "-p",
        "--permission-mode",
        "acceptEdits",
        "--disallowedTools",
        "Bash,Write,Edit,NotebookEdit,Task,WebFetch,WebSearch,Read,Glob,Grep",
      ]
    : spec.args(prompt);

  return new Promise<Essai>((resolve) => {
    let child;
    try {
      child = spawn(binPath, args, { cwd: careerOpsRoot(), env });
    } catch (e) {
      resolve({ ok: false, message: e instanceof Error ? e.message : "spawn a échoué", status: 500, plafond: false });
      return;
    }

    if (surStdin) {
      // EPIPE si le CLI ferme son entrée avant qu'on ait fini d'écrire (cas du
      // plafond de quota, qui répond immédiatement). Ce n'est pas une panne :
      // la sortie est lue normalement et `estPlafond` la reconnaîtra.
      child.stdin.on("error", () => {});
      child.stdin.end(prompt, "utf8");
    }

    let out = "";
    let err = "";
    let coupeAuTimeout = false;
    const killer = setTimeout(() => {
      coupeAuTimeout = true;
      try {
        child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    }, TIMEOUT_CLI_MS);

    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      err += d.toString();
    });
    child.on("error", (e) => {
      clearTimeout(killer);
      resolve({ ok: false, message: e.message, status: 500, plafond: false });
    });
    child.on("close", (code) => {
      clearTimeout(killer);

      // COUPÉ AU TIMEOUT : la sortie partielle n'est PAS une réponse.
      //
      // C'est le piège qui a coûté une heure de diagnostic le 2026-08-10. Le CLI
      // tué avait déjà émis du JSON tronqué ; ce fragment repartait comme un
      // succès, et `parseRank` le refusait avec « reponse hors format (pas
      // d'objet avec une cle jobs) ». On cherchait donc un problème de format de
      // réponse là où il n'y avait qu'un dépassement de budget. Un timeout doit
      // se dire timeout, et porter sa durée.
      if (coupeAuTimeout) {
        resolve({
          ok: false,
          plafond: false,
          status: 504,
          message:
            `${spec.name} a été coupé après ${Math.round(TIMEOUT_CLI_MS / 1000)} s ` +
            `(TIMEOUT_CLI_MS). La sortie partielle est jetée : ce n'est pas une réponse du modèle. ` +
            `Si ça se reproduit, c'est le VOLUME DE SORTIE qu'il faut réduire — le nombre d'offres ` +
            `retenues (maxRetenues) commande la durée bien plus que la taille du prompt.`,
        });
        return;
      }

      // Est-ce un refus pour plafond ? Le CLI répond ce message avec un code de
      // sortie 0, donc c'est le seul endroit où on peut l'attraper avant qu'il
      // ne devienne « la réponse du modèle ».
      if (estPlafond(out, err)) {
        resolve({
          ok: false,
          plafond: true,
          status: 429,
          message: String(out || err).trim().slice(0, 200),
        });
        return;
      }

      const texte = nettoieSortie(out);
      if (!texte) {
        resolve({
          ok: false,
          message: err.trim() || `${spec.name} n'a rien renvoyé (code ${code})`,
          status: 502,
          plafond: false,
        });
        return;
      }
      resolve({ ok: true, texte, plafond: false });
    });
  });
}

/** Erreur au format OpenAI, pour que n8n l'affiche lisiblement. */
export function erreurOpenAi(message: string, status: number, type = "server_error") {
  return Response.json({ error: { message, type, code: null, param: null } }, { status });
}
