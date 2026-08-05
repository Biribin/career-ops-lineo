import { ChevronDown, ExternalLink } from "lucide-react";

// Transparency = our differentiator ("why it's a 4.0 for YOU"). The wording is
// the CANONICAL public text from career-ops.org/methodology + /docs — rendered
// verbatim, NOT a web reinterpretation of the rubric (whose weights live in the
// core, modes/_shared.md). Native <details> → no client JS.

const DIMENSIONS: [string, string][] = [
  ["Adéquation", "à quel point votre CV correspond aux exigences du poste"],
  ["Alignement avec votre cap", "dans quelle mesure le poste vous rapproche de votre objectif de carrière déclaré"],
  ["Rémunération", "l'offre face aux salaires du marché (indique « données insuffisantes » si la rémunération est absente — n'invente jamais de chiffres)"],
  ["Signaux culturels", "les signaux d'équipe, de valeurs et de méthodes de travail présents dans l'offre"],
  ["Signaux d'alerte", "avertissements : offre fantôme, arnaque ou inadéquation"],
  ["Global", "le jugement unique qui synthétise tout ce qui précède en un score"],
];

// Les lettres A–G sont les identifiants de blocs écrits par le cœur — non traduites.
const BLOCKS: [string, string][] = [
  ["A", "Résumé du poste en langage clair"],
  ["B", "Un tableau de la correspondance entre votre CV et chaque exigence, avec les écarts"],
  ["C", "Stratégie — comment vous positionner sur ce poste"],
  ["D", "Étude de rémunération, comparant l'offre aux salaires du marché"],
  ["E", "Notes de personnalisation pour votre candidature"],
  ["F", "Préparation d'entretien — récits STAR adaptés à cette offre"],
  ["G", "Légitimité de l'offre — vérification qu'elle est réelle, ni arnaque ni offre fantôme"],
];

export function ScoreMethodology() {
  return (
    <details className="group mt-10 overflow-hidden rounded-2xl border border-border bg-surface/30">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-5 py-3.5 text-sm font-medium transition-colors hover:bg-surface-hover">
        Comment career-ops a noté cette offre — et pourquoi c&apos;est pour <span className="text-landing">vous</span>
        <ChevronDown className="ml-auto size-4 text-faint transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-5 border-t border-border px-5 py-4 text-sm">
        <p className="text-muted">
          Chaque poste est noté de <strong className="text-foreground">1,0 à 5,0</strong> sur six dimensions.{" "}
          <strong className="text-brand">4,0</strong> est le seuil candidater / ne pas candidater — en dessous,
          career-ops déconseille de candidater.
        </p>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">Les six dimensions</div>
          <ul className="space-y-1.5">
            {DIMENSIONS.map(([k, v]) => (
              <li key={k}>
                <span className="font-medium text-foreground">{k}</span> <span className="text-muted">— {v}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-faint">Ce que signifie chaque bloc du rapport</div>
          <ul className="space-y-2">
            {BLOCKS.map(([k, v]) => (
              <li key={k} className="flex items-start gap-2.5">
                <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded bg-brand-soft text-xs font-semibold text-brand">
                  {k}
                </span>
                <span className="text-muted">{v}</span>
              </li>
            ))}
          </ul>
        </div>
        <a
          href="https://career-ops.org/methodology"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-brand transition-colors hover:underline"
        >
Méthodologie complète <ExternalLink className="size-3" />
        </a>
      </div>
    </details>
  );
}
