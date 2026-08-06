# Déploiement de l'app career-ops sur le VPS (Coolify)

But : l'app cockpit en ligne, accessible partout, qui enregistre tout — à côté de
n8n, sur le même serveur. Domaine cible : **career.balzac-info.online**.

## Ce qui est prêt (dans ce repo)

- `Dockerfile.web` — build de l'app Next (`web/`) + tout le repo (l'app exécute
  les `.mjs`). Image slim node+git. Build de prod **vérifié en local** (101 routes,
  0 erreur).
- `.dockerignore` — exclut `data/` (records → volume persistant), `node_modules`,
  `web/.next`.

## ⚠️ La couche utilisateur n'est PAS dans l'image

Une version antérieure de ce document affirmait que `cv.md`, `config/`,
`portals.yml` et `modes/_profile.md` étaient « embarqués dans l'image v1 ».
**C'est faux, et ça se voit en production** (constaté le 2026-08-05 : `POST
/api/tailor` répondait 503 `cv.md introuvable`).

Ces fichiers sont **gitignorés** (`.gitignore` : `cv.md` l.2, `config/profile.yml`
l.57, `data/*` l.9). Coolify construit depuis un **clone git** : ce que git ignore
n'est jamais dans le contexte de build, quoi que dise `.dockerignore`. Il faut donc
les fournir au conteneur autrement — c'est le rôle de `docker-entrypoint-web.sh`
(volume persistant + liens dans `/app`). Ils sont par ailleurs sauvegardés dans
**`Biribin/career-ops-data`** (privé, sync quotidien 12:30).

À l'inverse, **`data/applications.md` absent n'est PAS un problème à régler.** Le
tracker se crée à la première candidature réellement envoyée (`merge-tracker.mjs`),
et `/app/data` étant déjà le volume, il est persistant sans rien câbler. Tant qu'il
n'existe pas, `GET /api/followups` répond correctement
`{"due":[],"error":"No applications found in tracker."}` : c'est l'état normal
d'avant-premier-envoi, pas une panne de provisioning.

## Réglages Coolify (New Resource → Application)

| Champ | Valeur |
|---|---|
| Source | dépôt privé **Biribin/career-ops-lineo**, branche `feat/web-ui-francais` (ou `main` après merge) |
| Build Pack | **Dockerfile** |
| Dockerfile | `Dockerfile.web` |
| Base directory | `/` (racine du repo) |
| Port exposé | **3000** |
| Domaine | `https://career.balzac-info.online` |
| Volume persistant | monté sur **`/app/data`** (les records) |

### Variables d'environnement

```
PORT=3000
CAREER_OPS_TRACKER=/app/data/applications.md
CAREER_OPS_REPORTS_DIR=/app/data/reports
GEMINI_API_KEY=<clé Google AI Studio, projet SANS facturation>
```

`CAREER_OPS_TRACKER` et `CAREER_OPS_REPORTS_DIR` redirigent les données qui doivent
survivre aux redéploiements vers le volume `/app/data`.

`CLAUDE_CODE_OAUTH_TOKEN` est la variable à coller pour le CLI par défaut (voir
« Quel LLM fait tourner le VPS »). `CAREER_OPS_CLI`, `GEMINI_DEFAULT_AUTH_TYPE` et
`GEMINI_CLI_TRUST_WORKSPACE` sont figés dans `Dockerfile.web`, ce ne sont pas des
secrets.

`GEMINI_API_KEY` n'est utile que pour le repli Gemini, et **une seule** clé : une
liste séparée par des virgules ne fonctionne pas (voir la section suivante). Lineo a
un pool de clés en local, mais sa rotation est locale — en reprendre **une**, ou en
créer une sur <https://aistudio.google.com/apikey>.

> ⚠️ **`ANTHROPIC_API_KEY` : à SUPPRIMER des variables Coolify.** Elle y est encore
> (constaté le 2026-08-05) et c'est une clé **facturée au token**. Aucun script
> racine ne la lit — seul un CLI Claude s'en servirait, et depuis que
> `@anthropic-ai/claude-code` est dans l'image (commit `dab6902`) elle est devenue
> une vraie voie de facturation ouverte : il suffit qu'une session choisisse
> « Claude Code » dans Configuration pour que les appels partent sur cette clé au
> lieu de l'abonnement. La laisser ne fait courir qu'un risque, elle n'apporte rien.

## Quel LLM fait tourner le VPS

Le cockpit n'implémente aucun LLM : `web/src/lib/clis.ts` **lance un CLI agentique
réel** en headless (`/api/run` → `evaluate`, `pdf`, `fix-portal` ; `/api/assistant` ;
`/api/explore/ai`). Sans binaire de CLI dans l'image, `/api/run` répond
`404 CLI not found`. Deux voies gratuites étaient possibles :

| Voie | Coût | Statut |
|---|---|---|
| **A — Claude Code + abonnement Max** (`CAREER_OPS_CLI=claude` + `CLAUDE_CODE_OAUTH_TOKEN`) | 0 € marginal | ✅ **défaut du VPS** (arbitrage Lineo, 2026-08-05). Installé, vérifié (`claude 2.1.222`), et il marche. |
| **B — Gemini CLI + clé AI Studio free tier** (`CAREER_OPS_CLI=gemini` + `GEMINI_API_KEY`) | 0 € | Installé, gardé en repli. Aucun risque CGU ni facturation possible. |

### Pourquoi le défaut a changé

Le défaut était `gemini`, sur trois arguments qui restent valables : zone grise CGU
pour un service headless, consommation des quotas Max d'un compte peut-être partagé,
et pas de plafond de volume. **Lineo, propriétaire du compte, a tranché pour Claude
Code le 2026-08-05** — Gemini par défaut ne fonctionnait pas chez lui : plusieurs
clés avaient été collées dans `GEMINI_API_KEY` séparées par des virgules, en
attendant un basculement automatique qui **n'existe pas côté serveur**.

C'est un piège à documenter, pas juste une préférence : [gemini-eval.mjs
l.149](gemini-eval.mjs#L149) lit `process.env.GEMINI_API_KEY` et le passe **verbatim**
à `new GoogleGenerativeAI()` ([l.301](gemini-eval.mjs#L301)), et le Gemini CLI attend
lui aussi une valeur unique. Une liste séparée par des virgules part donc en entier
comme si c'était une seule clé : tout échoue en `INVALID_ARGUMENT` / 401, **pas** en
429. Le symptôme ne ressemble pas à un problème de quota. La rotation que Lineo
connaît (`gemini-rotate`, pool dans `~/.gemini/`, voir `modes/_custom.md`) est
**strictement locale** : ni le script, ni le pool, ni `~/.gemini/` ne sont dans
l'image. Pour remettre Gemini en défaut, il faut **une seule** clé dans la variable.

> ⚠️ **Ordre impératif : supprimer `ANTHROPIC_API_KEY` des variables Coolify AVANT
> de redéployer avec ce défaut.** Cette clé est facturée au token ; la laisser en
> place tout en promouvant Claude Code en défaut ferait du chemin par défaut une voie
> de facturation ouverte, au lieu de l'abonnement via `CLAUDE_CODE_OAUTH_TOKEN`.

Comment le défaut est réellement appliqué (ce n'est pas qu'un commentaire) :

- `Dockerfile.web` fixe `ENV CAREER_OPS_CLI=claude` ;
- `doctor.mjs` lit déjà cette variable (`resolveActiveCli`) ;
- `GET /api/clis` renvoie `defaultCliId` = ce CLI **s'il est réellement installé**
  ([route.ts l.17-18](web/src/app/api/clis/route.ts#L17)), et `config-form.tsx` le
  préfère à « le premier CLI installé de la liste ». Sans ça l'ordre de `KNOWN`
  décidait à notre place.

L'ordre de priorité réel, vérifié dans
[config-form.tsx l.74](web/src/components/config-form.tsx#L74) :

```
choix en localStorage  >  CAREER_OPS_CLI (si le CLI est installé)  >  premier installé
```

Un choix explicite dans la page Configuration reste prioritaire (il est stocké dans
le `localStorage` du navigateur, pas côté serveur) : c'est volontaire, mais ça veut
dire qu'un navigateur qui a déjà « Claude Code » en mémoire continuera de l'utiliser
pour `/api/assistant` et `/api/explore/ai`. Pour `/api/run` c'est sans conséquence :
la chaîne de résilience de `buildChain` bascule sur Gemini toute seule.

### ⚠️ Le Gemini CLI ne voit pas le CV sans `.gemini/settings.json`

Piège silencieux, trouvé en lançant une vraie évaluation A–F le 2026-08-05. Le
Gemini CLI **filtre ses lectures sur `.gitignore` par défaut**, et toute la couche
utilisateur de career-ops y est précisément :

```
Error executing tool read_file: File path '.../cv.md' is ignored by
configured ignore patterns.       (idem config/profile.yml, modes/_profile.md, jds/)
```

Le danger n'est pas l'erreur, c'est ce qui suit : **le modèle continue**, score
l'offre sans avoir lu le CV, et émet quand même sa ligne `VERDICT`. Un score faux
qui a l'air vrai. Corrigé par `.gemini/settings.json`
(`context.fileFiltering.respectGitIgnore: false`) + un `.geminiignore` qui reprend
la protection des secrets que `.gitignore` assurait par effet de bord.

**Ça concerne aussi le défaut Claude Code** : `buildChain` bascule sur Gemini dès
que le CLI primaire échoue, donc le repli produisait des scores non fondés.

### Modèles / quotas

- CLI : `GEMINI_MODEL` (optionnel) surcharge le modèle du Gemini CLI.
- Scripts autonomes sans CLI : `node gemini-eval.mjs --file jds/offre.txt`
  (défaut `gemini-3.6-flash`, lit la même `GEMINI_API_KEY`).
- La clé **doit** venir d'un projet Google **sans facturation activée** : c'est ce
  qui garantit qu'un dépassement de quota renvoie une erreur 429 au lieu de basculer
  silencieusement en tier payant.
- **Le free tier est étroit** : `limit: 5, model: gemini-3-flash` sur
  `generate_content_free_tier_requests`, avec des reprises annoncées à ~37 s. Une
  évaluation agentique enchaîne beaucoup d'appels : comptez plusieurs minutes par
  offre et **une seule évaluation à la fois**. C'est utilisable pour du fond de
  tâche, pas pour un batch. (Ce plafond est aussi la preuve qu'on est bien sur le
  tier gratuit : l'erreur nomme la métrique `..._free_tier_requests`.)

## Couche utilisateur : comment elle arrive dans le conteneur

`docker-entrypoint-web.sh` (branché en `ENTRYPOINT`, derrière `tini`) relie à chaque
démarrage les quatre fichiers gitignorés depuis le volume persistant :

```
/app/data/perso/cv.md       -> /app/cv.md
/app/data/perso/portals.yml -> /app/portals.yml
/app/data/perso/profile.yml -> /app/config/profile.yml
/app/data/perso/_profile.md -> /app/modes/_profile.md
/app/data/perso/career-ops.env -> /app/.env        (optionnel)
```

Le volume survit aux redéploiements, donc c'est à provisionner **une seule fois**.
Depuis le clone `career-ops-data` (la sauvegarde canonique, sync 12:30) :

```bash
V=/var/lib/docker/volumes/<volume-coolify>-career-data/_data
ssh balzac-vps "mkdir -p $V/perso && chmod 700 $V/perso"
cd career-ops-data/career-ops
for p in cv.md:cv.md portals.yml:portals.yml config/profile.yml:profile.yml modes/_profile.md:_profile.md; do
  ssh balzac-vps "cat > $V/perso/${p##*:} && chmod 600 $V/perso/${p##*:}" < "${p%%:*}"
done
```

> ⚠️ **Limite connue.** Une écriture *atomique* de l'app
> (`web/src/lib/core/safe-write.ts` : write-temp + `rename`) **remplace le lien par
> un fichier réel**, qui vit alors dans la couche du conteneur et disparaît au
> redéploiement suivant. Concerne l'upload de CV et les « notes durables » écrites
> dans `modes/_profile.md`. La source de vérité de ces quatre fichiers reste
> `career-ops-data` + le volume ; après une modification faite depuis l'app, la
> recopier dans `/app/data/perso/`.

## Vérification (fait le 2026-08-05)

```bash
C=$(for c in $(docker ps --format '{{.Names}}'); do docker exec "$c" test -f /app/doctor.mjs 2>/dev/null && echo "$c" && break; done)
docker exec -w /app $C node doctor.mjs                                  # attendu : exit 0
docker exec -w /app $C node scan-ats-full.mjs --dry-run --ats greenhouse --limit 15 --since 7
curl -s -X POST https://career.balzac-info.online/api/tailor \
  -H 'Content-Type: application/json' \
  -d '{"jobTitle":"Développeur Full Stack","company":"TestCorp","jobDescription":"TypeScript React Next.js Node.js PostgreSQL Docker n8n"}'
docker exec -w /app $C node gemini-eval.mjs --file jds/offre-test.txt    # nécessite GEMINI_API_KEY
```

Résultats obtenus :

| Contrôle | Avant | Après |
|---|---|---|
| `node doctor.mjs` | exit 0, **4 warnings** (`cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml` absents) | **exit 0, 0 warning** |
| Scan ATS (0 token) | ✅ déjà bon | ✅ 15 boards greenhouse, 7 injoignables, 0 nouvelle offre |
| `POST /api/tailor` | ❌ `503 cv.md introuvable` | ✅ `200` + 7 mots-clés réels |
| CLI agentique dans le conteneur | ❌ aucun (`/api/run` → 404) | ✅ `gemini` 0.53.1 + `claude` 2.1.222 |
| Gemini headless répond (`-p`) | ❌ pas de binaire | ✅ **dans le conteneur** : `PONG` |
| `GEMINI_API_KEY` exploitable | ❌ liste séparée par des virgules | ✅ une seule clé (53 car., 0 virgule) |
| Gemini lit la couche utilisateur | ❌ `ignored by configured ignore patterns` | ✅ **dans le conteneur** : `CV_LU: CV — Linéo Biribin` |

Le dernier contrôle est celui qui compte : il prouve **sur le VPS**, tier gratuit,
que le CLI lit un fichier gitignoré (`cv.md`) — donc que `.gemini/settings.json`
fait son travail et qu'une évaluation ne scorera pas une offre à l'aveugle. Le run
traverse quand même des `retryWithBackoff` (plafond des 5 req/min) : compter
plusieurs minutes, et une évaluation à la fois.

Reste non exécuté de bout en bout : une évaluation A–F **complète avec persistance**
(`reserve-report-num` → `reports/` → `merge-tracker`). Elle écrirait une vraie ligne
dans le tracker, ce qui n'a pas sa place dans un test. À faire sur une offre réelle :

```bash
docker exec -w /app $C node gemini-eval.mjs --file jds/<offre>.txt
```

Avec `CAREER_OPS_CLI=gemini`, `doctor.mjs` garde 1 warning **informatif** :
« Playwright MCP check skipped for CLI: gemini » — `doctor` ne sait scanner les
configs MCP que de `claude` et `opencode`. Sans effet ici : en headless le prompt
d'évaluation utilise `WebFetch`, pas le MCP navigateur.

## Prérequis côté Coolify (à confirmer)

1. Le dépôt privé `career-ops-lineo` doit être accessible par Coolify (même
   GitHub App / clé de déploiement que pour aef-web).
2. DNS : `career.balzac-info.online` doit pointer sur le serveur Coolify
   (wildcard `*.balzac-info.online` probablement déjà en place pour aef-web).

## Étape 3 (après mise en ligne) : relances + tailoring career-ops

Une fois l'app en ligne sur le VPS, career-ops tourne à côté de n8n :

- **Relances** : n8n (cron) appelle `node followup-cadence.mjs --overdue-only`
  via Execute Command → prépare les brouillons de relance dues → porte de
  validation « À valider » (comme les candidatures) → envoi.
- **Tailoring** : n8n appelle le tailoring career-ops (`openai-tailor.mjs` /
  Claude via `CAREER_OPS_CLI`) au lieu de l'unique agent « Adapt CV » — le
  « meilleur des 2 ».
- Le **pont GitHub (inbox)** devient inutile : n8n et l'app partagent le disque,
  les décisions sont des lectures/écritures de fichiers locales.
