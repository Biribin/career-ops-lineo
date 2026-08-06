"use client";

import { useState } from "react";
import { Loader2, Search } from "lucide-react";

// Bouton « Lancer la recherche » : déclenche le workflow n8n
// « 1. Decouverte des offres » via /api/search/launch.
//
// Une tournée dure plusieurs minutes (une requête France Travail par mot-clé,
// puis le tri par le LLM local). n8n répond donc immédiatement et travaille en
// arrière-plan : ce bouton confirme le lancement, il n'attend pas le résultat.
// C'est volontaire — attendre bloquerait le navigateur et finirait en timeout.

type Etat = { type: "ok" | "erreur"; message: string } | null;

export function LancerRechercheBouton({ onLance }: { onLance?: () => void }) {
  const [enCours, setEnCours] = useState(false);
  const [etat, setEtat] = useState<Etat>(null);

  async function lancer() {
    setEnCours(true);
    setEtat(null);
    try {
      const rep = await fetch("/api/search/launch", { method: "POST" });
      const j = (await rep.json()) as { ok?: boolean; error?: string; message?: string };
      if (rep.ok && j.ok) {
        setEtat({ type: "ok", message: j.message || "Recherche lancée." });
        onLance?.();
      } else {
        setEtat({ type: "erreur", message: j.error || `n8n a répondu ${rep.status}` });
      }
    } catch (e) {
      setEtat({ type: "erreur", message: e instanceof Error ? e.message : "appel impossible" });
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={lancer}
          disabled={enCours}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {enCours ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Lancer la recherche
        </button>
        {enCours && <span className="text-xs text-faint">appel à n8n…</span>}
      </div>

      {etat && (
        <p
          className={
            etat.type === "ok"
              ? "rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-muted"
              : "rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted"
          }
        >
          {etat.type === "ok" ? (
            <>
              {etat.message} Les offres apparaîtront ici dans quelques minutes, le temps d’interroger France
              Travail et de les trier.
            </>
          ) : (
            <>
              <span className="font-medium text-amber-700 dark:text-amber-400">Lancement impossible</span>{" "}
              <span>— {etat.message}</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}
