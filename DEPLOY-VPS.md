# Déploiement de l'app career-ops sur le VPS (Coolify)

But : l'app cockpit en ligne, accessible partout, qui enregistre tout — à côté de
n8n, sur le même serveur. Domaine cible : **career.balzac-info.online**.

## Ce qui est prêt (dans ce repo)

- `Dockerfile.web` — build de l'app Next (`web/`) + tout le repo (l'app exécute
  les `.mjs`). Image slim node+git. Build de prod **vérifié en local** (101 routes,
  0 erreur).
- `.dockerignore` — exclut `data/` (records → volume persistant), `node_modules`,
  `web/.next`. La config (`cv.md`, `config/`, `portals.yml`, `modes/_profile.md`)
  est embarquée dans l'image v1.

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
