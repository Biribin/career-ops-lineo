/** @type {import('next').NextConfig} */
const nextConfig = {
  // Image Docker autonome pour le déploiement VPS (Coolify) : Next copie un
  // serveur minimal dans .next/standalone. N'affecte QUE `next build`, jamais
  // `next dev` — le dev local de Lineo est intact. Voir DEPLOY-VPS.md.
  output: "standalone",
  // Le serveur standalone vit dans web/ mais l'app shell-out vers ../*.mjs : on
  // trace le monorepo entier pour que la sortie standalone n'oublie rien.
  outputFileTracingRoot: import.meta.dirname + "/..",
  // Two lockfiles exist on purpose (repo root + web/), so Next would infer the
  // repo root as the workspace root. On Windows that misinference can send
  // Turbopack's postcss workers into an unbounded respawn loop that exhausts
  // all RAM (vercel/next.js#92978) — pin the root to this app.
  turbopack: { root: import.meta.dirname },
  // Allow a throwaway build dir (e.g. BUILD_DIST=.next-prod) so a production
  // `next build` can run without clobbering a live `next dev` .next.
  ...(process.env.BUILD_DIST ? { distDir: process.env.BUILD_DIST } : {}),
};

export default nextConfig;
