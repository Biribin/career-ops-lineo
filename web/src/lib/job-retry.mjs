/**
 * job-retry.mjs — relancer un traitement déjà terminé, à l'identique.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * La page d'un traitement (`/jobs/[id]`) affiche un résultat, et jusqu'ici on ne
 * pouvait rien en faire : un agent qui rend « 1/5, rien trouvé » laissait
 * l'utilisateur remonter jusqu'à la page d'origine pour relancer. Pire, la vue
 * portails promet déjà « traitée · re-tester » en lien vers cette page, qui
 * n'offrait aucun re-test.
 *
 * La décision « peut-on relancer, et avec quels arguments » est ici, en module
 * pur, parce que c'est la seule partie qui mérite des tests : la page, elle, ne
 * fait qu'appeler startJob() et naviguer.
 */

/**
 * Un traitement, vu par ce module. Volontairement structurel (pas d'import du
 * type `Job` de job-store.tsx) : ce fichier doit rester chargeable par
 * `node --test`, sans TypeScript ni React.
 *
 * @typedef {object} TraitementRejouable
 * @property {string} [status] - "running" | "done" | "error" | "detached".
 * @property {string} [title]
 * @property {string} [subtitle]
 * @property {string} [kind] - Type d'action côté /api/run.
 * @property {string} [input] - L'URL ou le nom que l'agent a traité.
 * @property {string} [page] - Route d'où le traitement a été lancé.
 */

/**
 * Un relancement est-il légitime pour ce traitement ?
 *
 * Trois refus, chacun pour une raison distincte :
 *
 *   - `running` : c'est encore en cours. Un second agent sur la même entrée
 *     n'apporte rien et écrit la même ligne de suivi deux fois.
 *   - `detached` : l'onglet a été rechargé, mais le traitement CONTINUE côté
 *     serveur et écrira lui-même son rapport (voir le commentaire de `status`
 *     dans job-store.tsx). C'est le même doublon que ci-dessus, avec en plus un
 *     message à l'écran qui dit explicitement de ne pas relancer.
 *   - pas de `kind` ou pas de `input` : /api/run n'a alors rien à exécuter. Les
 *     traitements restaurés du localStorage d'une version antérieure peuvent
 *     manquer de ces champs — un bouton qui échoue en 400 est pire qu'un bouton
 *     absent.
 *
 * @param {TraitementRejouable|null|undefined} job
 * @returns {boolean}
 */
export function peutReessayer(job) {
  if (!job) return false;
  if (job.status !== "done" && job.status !== "error") return false;
  return Boolean(job.kind) && Boolean(job.input);
}

/**
 * Les arguments de startJob() pour rejouer ce traitement à l'identique.
 *
 * `batchId` n'est JAMAIS repris : un lot groupe des traitements lancés
 * ensemble (« évalue toute cette liste »), et une relance manuelle n'en fait
 * pas partie — sinon la carte de lot de l'assistant gagnerait un membre
 * après coup, sans que personne ne l'ait demandé.
 *
 * @param {TraitementRejouable|null|undefined} job
 * @returns {{title: string, subtitle: string|undefined, kind: string, input: string, page: string|undefined}|null}
 *   `null` quand le traitement n'est pas rejouable — le seul contrat que
 *   l'appelant doit vérifier.
 */
export function optionsReessai(job) {
  if (!peutReessayer(job) || !job) return null;
  return {
    title: job.title || "Nouvel essai",
    subtitle: job.subtitle,
    kind: /** @type {string} */ (job.kind),
    input: /** @type {string} */ (job.input),
    page: job.page,
  };
}
