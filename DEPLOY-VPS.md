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
ANTHROPIC_API_KEY=<clé Claude>        # pour le tailoring career-ops (étape 3)
```

`CAREER_OPS_TRACKER` et `CAREER_OPS_REPORTS_DIR` redirigent les données qui doivent
survivre aux redéploiements vers le volume `/app/data`.

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
