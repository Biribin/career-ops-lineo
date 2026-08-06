"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, FileText, Loader2, ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { CompanyLogo } from "@/components/company-logo";
import { scoreNum, scoreTone } from "@/lib/format";
import type { Application } from "@/lib/career-ops";

// Awaiting-decision row: a scored role with no terminal status. One-tap Apply /
// Skip writes back through the EXISTING /api/status (UPDATE-only, canonical states).
// Les valeurs "Applied" / "Discarded" sont les jetons canoniques du tracker —
// seuls les libellés des boutons sont traduits.
export function DecisionCard({ app }: { app: Application }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "Applied" | "Discarded">("");
  const [done, setDone] = useState<string | null>(null);
  const score = scoreNum(app.score);
  const tone = scoreTone(app.score);

  // Le tracker n'a PAS de colonne URL : ses champs sont n, date, company, via,
  // role, score, status, pdf, report, notes. L'annonce n'y est donc nulle part,
  // et cette carte n'avait aucun lien a afficher. On la retrouve depuis l'inbox
  // du scanner, ou l'URL existe encore, via /api/offer-link.
  //
  // Cet endpoint ne rend une URL « exacte » que si la correspondance est
  // CERTAINE ; sinon il rend un lien de recherche, et on l'affiche comme tel.
  // Envoyer Lineo lire la mauvaise annonce avant de decider serait pire que ne
  // rien lui donner.
  const [lien, setLien] = useState<{ url: string; certitude: string; nbCandidats: number } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ company: app.company ?? "", role: app.role ?? "" });
    let vivant = true;
    fetch(`/api/offer-link?${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (vivant && j?.url) setLien(j);
      })
      .catch(() => {
        /* pas de lien : la carte reste utilisable sans */
      });
    return () => {
      vivant = false;
    };
  }, [app.company, app.role]);

  const setStatus = async (status: "Applied" | "Discarded") => {
    setBusy(status);
    try {
      await fetch("/api/status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: app.n, status }) });
      setDone(status);
      router.refresh();
    } catch {
      /* ignore */
    } finally {
      setBusy("");
    }
  };

  if (done) return null;

  return (
    <div className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-surface/40 p-3.5 transition hover:border-brand/30">
      <div className="flex items-start gap-2.5">
        <CompanyLogo name={app.company} size={24} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{app.company}</p>
          <p className="truncate text-[13px] text-muted">{app.role}</p>
          {lien && (
            <a
              href={lien.url}
              target="_blank"
              rel="noreferrer"
              title={
                lien.certitude === "exacte"
                  ? "Ouvrir l’annonce"
                  : lien.nbCandidats > 1
                    ? `${lien.nbCandidats} offres de cette entreprise : impossible de savoir laquelle. Recherche pré-remplie.`
                    : "Annonce introuvable dans l’inbox : recherche pré-remplie."
              }
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-brand hover:underline"
            >
              {lien.certitude === "exacte" ? (
                <>
                  <ExternalLink className="size-3" /> Voir l&rsquo;annonce
                </>
              ) : (
                <>
                  <Search className="size-3" /> Chercher l&rsquo;annonce
                </>
              )}
            </a>
          )}
        </div>
        {Number.isFinite(score) && score > 0 && (
          <span
            className={cn(
              "shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums",
              tone === "good" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : tone === "warn" ? "bg-amber-500/10 text-amber-600 dark:text-amber-400" : "bg-surface-hover text-muted",
            )}
          >
            {app.score}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {/* brand-soft AT REST (not a solid fill, not hover-only): a calm-but-
            affirmative primary — a queue of these reads as gentle brand, not 6
            solid shouts (P5), while staying visibly the positive action next to
            the neutral Skip even on touch (no hover). */}
        <button
          type="button"
          disabled={!!busy}
          onClick={() => setStatus("Applied")}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brand-soft px-2.5 py-1.5 text-xs font-medium text-brand-text transition hover:bg-brand/15 disabled:opacity-60 max-sm:min-h-[44px]"
        >
          {busy === "Applied" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />} Marquer envoyée
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => setStatus("Discarded")}
          className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-60 max-sm:min-h-[44px] max-sm:px-4"
        >
          {busy === "Discarded" ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />} Écarter
        </button>
        <a href={`/pipeline/${app.n}`} title="Ouvrir le rapport" aria-label="Ouvrir le rapport" className="inline-flex shrink-0 items-center justify-center rounded p-1.5 text-faint transition hover:text-brand max-sm:min-h-[44px] max-sm:min-w-[44px]">
          <FileText className="size-4" />
        </a>
      </div>
    </div>
  );
}
