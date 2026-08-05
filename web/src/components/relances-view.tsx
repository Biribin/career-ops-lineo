"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ClipboardList, Loader2, Mail, RefreshCw } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { daysHeatClass } from "@/lib/followups";
import { cn } from "@/lib/cn";

// La liste des relances dues, telle que n8n la voit. Cette page lit le MÊME
// contrat que lui (GET /api/followups → `due`), pas une vue parallèle : ce que
// Linéo a sous les yeux est exactement ce que le workflow va traiter.
//
// Lecture seule à dessein. Journaliser une relance, épingler une date, régler la
// cadence : tout ça vit déjà dans /followups (le tracker complet). Ici on répond
// à une seule question, « qui est à relancer maintenant ».

type Relance = {
  id: string;
  entreprise: string;
  poste: string;
  courriel_contact: string | null;
  jours_depuis_envoi: number;
};

type Reponse = { available: boolean; due: Relance[]; error: string | null };

export function RelancesView() {
  const [res, setRes] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(() => {
    setChargement(true);
    fetch("/api/followups")
      .then((r) => r.json())
      .then((j) =>
        setRes({
          available: Boolean(j?.available),
          due: Array.isArray(j?.due) ? j.due : [],
          error: typeof j?.error === "string" ? j.error : null,
        }),
      )
      .catch(() => setRes({ available: false, due: [], error: null }))
      .finally(() => setChargement(false));
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  const due = res?.due ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={charger}
          disabled={chargement}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {chargement ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Recalculer la cadence
        </button>
        <a
          href="/followups"
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
        >
          <ClipboardList className="size-4" />
          Journaliser une relance
        </a>
      </div>

      {res && !res.available && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-muted">
            Le moteur de cadence n&apos;a rien pu calculer. Vérifie que{" "}
            <code className="text-foreground">followup-cadence.mjs</code> et{" "}
            <code className="text-foreground">data/applications.md</code> sont bien là. Une liste vide ici ne veut donc
            pas dire «&nbsp;rien à relancer&nbsp;».
          </span>
        </p>
      )}

      {chargement && !res && (
        <p className="mt-6 flex items-center gap-2 text-sm text-faint">
          <Loader2 className="size-4 animate-spin" /> Calcul de la cadence…
        </p>
      )}

      {/* Le message du moteur, quand il en a un : une liste vide parce que le
          tracker est vide ne doit pas se lire comme « rien à relancer ». */}
      {res?.error && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Le moteur de cadence répond&nbsp;: <span className="text-foreground">{res.error}</span>
        </p>
      )}

      {res?.available && !res.error && due.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Aucune relance due aujourd&apos;hui. Les candidatures qui attendent encore leur échéance sont dans{" "}
          <a href="/followups" className="text-brand hover:underline">
            le tracker
          </a>
          .
        </p>
      )}

      <div className="mt-5 space-y-3">
        {due.map((r) => (
          <Carte key={r.id} relance={r} />
        ))}
      </div>
    </div>
  );
}

function Carte({ relance }: { relance: Relance }) {
  const jours = relance.jours_depuis_envoi;
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-border bg-surface/40 px-4 py-3">
      <CompanyLogo name={relance.entreprise || "?"} size={28} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{relance.poste || "poste inconnu"}</p>
        <p className="truncate text-xs text-muted">
          {relance.entreprise || "entreprise inconnue"}
          <span className="text-faint"> · candidature #{relance.id}</span>
        </p>
        {relance.courriel_contact ? (
          <a
            href={`mailto:${relance.courriel_contact}`}
            className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
          >
            <Mail className="size-3.5 shrink-0" />
            {relance.courriel_contact}
          </a>
        ) : (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <Mail className="size-3.5 shrink-0" />
            Aucun courriel au dossier : relance à faire sur le portail ou par LinkedIn.
          </p>
        )}
      </div>
      <span className={cn("shrink-0 text-xs tabular-nums", daysHeatClass(jours))}>
        {jours} j depuis l&apos;envoi
      </span>
    </div>
  );
}
