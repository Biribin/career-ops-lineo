// The cost-honesty taxonomy — a single source for the FREE vs $ boundary that the
// Explorer teaches by repetition. Discovery (finding roles) is structurally free:
// it calls no LLM. Only evaluation (scoring a role against your CV) spends tokens,
// and only when the user chooses it. The framing is always local-first: "your key,
// your AI, your machine."

export type CostClass = "free" | "free-network" | "spend" | "free-gemini";

// Les CLÉS sont des identifiants de classe de coût — jamais traduites.
export const COST_META: Record<CostClass, { label: string; tip: string }> = {
  "free-network": {
    label: "Gratuit",
    tip: "Scanne le réseau public des ATS en HTTP. Aucune IA, aucun jeton, rien d'envoyé — et rien n'est écrit avant que vous choisissiez d'ajouter un poste.",
  },
  free: {
    label: "Gratuit",
    tip: "Aucun jeton. Lit ou écrit uniquement des fichiers locaux.",
  },
  spend: {
    label: "Consomme des jetons",
    tip: "Lance une vraie évaluation notée sur votre propre IA. C'est la seule chose qui consomme des jetons — et seulement quand vous choisissez un poste.",
  },
  "free-gemini": {
    label: "Gratuit · Gemini",
    tip: "Évaluez avec l'offre gratuite Gemini de Google — sans coût en jetons.",
  },
};
