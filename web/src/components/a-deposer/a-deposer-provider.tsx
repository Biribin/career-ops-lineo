"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

// Le compte de la file « À déposer », partagé par la barre latérale, la nav
// mobile et la page elle-même — trois sous-arbres différents, un seul nombre.
//
// Sans ce rappel, la file grossit en silence : une candidature validée dont le
// dépôt n'est pas confirmé n'entre ni dans « Envoyées » ni dans les relances, et
// rien à l'écran ne le dit. C'est la seule raison d'être de ce fournisseur.
//
// Miroir de PipelineProvider (hydratation au montage + refetch au retour de
// focus), avec un ajout : `rafraichir(true)` force la relecture côté serveur
// après une écriture, pour que le badge ne contredise pas la page qui vient de
// le faire bouger.

type Etat = {
  /** null = pas encore su, ou lecture en panne. Jamais 0 par défaut. */
  compte: number | null;
  rafraichir: (frais?: boolean) => void;
};

const Ctx = createContext<Etat | null>(null);

export function useADeposer(): Etat {
  const c = useContext(Ctx);
  if (!c) throw new Error("useADeposer doit être utilisé dans <ADeposerProvider>");
  return c;
}

export function ADeposerProvider({ children }: { children: React.ReactNode }) {
  const [compte, setCompte] = useState<number | null>(null);

  const rafraichir = useCallback((frais = false) => {
    fetch(`/api/a-deposer/count${frais ? "?frais=1" : ""}`)
      .then((r) => r.json())
      .then((d) => setCompte(typeof d?.count === "number" ? d.count : null))
      // Un badge muet est le bon échec : c'est la page qui explique une panne de
      // lecture, pas une pastille dans la marge.
      .catch(() => setCompte(null));
  }, []);

  useEffect(() => {
    rafraichir();
  }, [rafraichir]);

  // Le retour de focus est LE moment utile : Linéo quitte l'onglet pour déposer
  // sur l'ATS et revient. La TTL du serveur absorbe les alt-tab rapides.
  useEffect(() => {
    const onFocus = () => rafraichir();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [rafraichir]);

  return <Ctx.Provider value={{ compte, rafraichir }}>{children}</Ctx.Provider>;
}

/**
 * La pastille de la navigation. Rien à afficher tant que le compte est inconnu
 * ou nul : un « 0 » permanent deviendrait du décor, et c'est l'attention qu'on
 * essaie d'obtenir.
 *
 * Ambre, comme le bandeau de la page : ce n'est pas une nouveauté à découvrir
 * (la puce « Nouveau » est en couleur de marque), c'est un geste qui manque.
 */
export function BadgeADeposer() {
  const { compte } = useADeposer();
  if (!compte) return null;
  return (
    <span
      title={`${compte} candidature(s) validée(s) en attente de dépôt`}
      className="ml-auto rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-amber-700 dark:text-amber-400"
    >
      {compte}
    </span>
  );
}
