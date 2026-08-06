"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { LancerRechercheBouton } from "@/components/lancer-recherche-bouton";

// Les offres rapportées par le workflow n8n « 1. Decouverte des offres », avec
// le bouton qui le déclenche.
//
// À NE PAS CONFONDRE AVEC « À valider » : ici ce sont des OFFRES à choisir
// (sortie du workflow 1). La page « À valider » liste des CANDIDATURES déjà
// rédigées qui attendent le feu vert avant envoi (sortie du workflow 2). Deux
// files distinctes, deux moments différents.

type Offre = {
  jobId: string;
  title?: string;
  company?: string;
  url?: string;
  location?: string;
  whyMatch?: string;
  score?: number | null;
  statut?: string;
  vu_le?: string;
};

export function OffresDecouvertes() {
  const [offres, setOffres] = useState<Offre[]>([]);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(() => {
    setChargement(true);
    fetch("/api/offers")
      .then((r) => r.json())
      .then((j: { offres?: Offre[] }) => setOffres(Array.isArray(j.offres) ? j.offres : []))
      .catch(() => setOffres([]))
      .finally(() => setChargement(false));
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  return (
    <section className="mb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-foreground">Offres trouvées</h2>
          <p className="text-sm text-muted">
            Cherchées sur France&nbsp;Travail avec les mots-clés de <code>portals.yml</code>, puis triées.
          </p>
        </div>
        <button
          onClick={charger}
          disabled={chargement}
          className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          {chargement ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Rafraîchir
        </button>
      </div>

      <div className="mt-4">
        {/* Après un lancement, la tournée dure quelques minutes : on ne recharge
            donc pas tout de suite, c'est le bouton Rafraîchir qui sert. */}
        <LancerRechercheBouton />
      </div>

      {!chargement && offres.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Aucune offre pour l’instant. Clique sur «&nbsp;Lancer la recherche&nbsp;», puis sur
          «&nbsp;Rafraîchir&nbsp;» dans quelques minutes.
        </p>
      )}

      {offres.length > 0 && (
        <ul className="mt-4 space-y-3">
          {offres.map((o) => (
            <li key={o.jobId} className="rounded-xl border border-border bg-surface/30 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {typeof o.score === "number" && (
                  <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
                    {o.score}
                  </span>
                )}
                <span className="font-medium text-foreground">{o.title || "poste non précisé"}</span>
                <span className="text-sm text-muted">
                  {o.company || "entreprise non précisée"}
                  {o.location ? ` · ${o.location}` : ""}
                </span>
              </div>
              {o.whyMatch && <p className="mt-2 text-sm text-muted">{o.whyMatch}</p>}
              {o.url && (
                <a
                  href={o.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-xs text-brand hover:underline"
                >
                  Voir l’offre
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
