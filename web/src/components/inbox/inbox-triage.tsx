"use client";

import { useEffect, useMemo, useState } from "react";
import { Undo2 } from "lucide-react";
import { useJobs } from "@/components/jobs/job-store";
import type { InboxJob } from "@/lib/career-ops";
import type { AtsSource } from "@/lib/explore";
import { ATS_SOURCES } from "@/lib/explore";
import { daysSince, seniorityFromTitle, sourceFromUrl, SENIORITY_ORDER, type Seniority } from "@/lib/inbox";
import { FacetChips } from "./facet-chips";
import { TriageRow, type RowScore } from "./triage-row";

/**
 * D'où vient une ligne de `data/pipeline.md`. Se déduit de l'URL, seule donnée
 * disponible : le fichier ne porte pas de champ de provenance, et lui en ajouter
 * un demanderait de passer par son écrivain sanctionné.
 */
function provenance(url: string): "forum" | "scanner" {
  return (url || "").includes("community.n8n.io") ? "forum" : "scanner";
}

const GROUPES_PROVENANCE = [
  { cle: "scanner" as const, libelle: "Trouvées par career-ops", detail: "scanner local, data/pipeline.md" },
  { cle: "forum" as const, libelle: "n8n community", detail: "posts du forum — se répondent par un message" },
];

const HIDDEN_KEY = "career-ops:hidden";
const BATCH = 20;

// The inbox as a TRIAGE surface: Abundance → Triage → Opt-in Score.
// Default is a small fresh batch (never the full wall); free facets + Skip narrow it.
// 🔴 The shell is agnostic to what makes a role relevant — order is freshness with a
// single documented plug point.
//
// La SÉLECTION (mise de côté + barre du bas + évaluation en lot) a été retirée le
// 2026-08-14 à la demande de Linéo. Ce qui reste : chaque ligne s'évalue seule
// (« Lire l'annonce » gratuit, puis évaluation complète depuis son panneau), ou
// s'écarte. La clé `career-ops:shortlist` peut traîner dans les navigateurs déjà
// ouverts : plus personne ne la lit.
export function InboxTriage({ inbox }: { inbox: InboxJob[] }) {
  const { jobs, startJob } = useJobs();

  // facets
  const [within, setWithin] = useState<number | null>(null);
  const [sources, setSources] = useState<Set<AtsSource>>(() => new Set());
  const [seniorities, setSeniorities] = useState<Set<Seniority>>(() => new Set());
  const [locQ, setLocQ] = useState("");
  const [kw, setKw] = useState("");
  const [showAll, setShowAll] = useState(false);

  // persisted triage state + ephemeral undo
  const [hidden, setHidden] = useState<string[]>([]);
  const [undo, setUndo] = useState<{ label: string; fn: () => void } | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const h = localStorage.getItem(HIDDEN_KEY);
      if (h) setHidden(JSON.parse(h));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (loaded) try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden)); } catch { /* quota */ }
  }, [hidden, loaded]);
  // auto-dismiss the undo toast
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 5000);
    return () => clearTimeout(t);
  }, [undo]);

  // stable "now" for freshness (per mount)
  const now = useMemo(() => Date.now(), []);

  // Dedupe by URL — pipeline.md can list the same posting twice; it's one job, so it
  // triages once (and Save/Skip/score, all keyed by URL, act on it coherently).
  const enriched = useMemo(() => {
    const seen = new Set<string>();
    const out: { job: InboxJob; source: AtsSource | null; seniority: Seniority | null; age: number | null }[] = [];
    for (const job of inbox) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      out.push({ job, source: sourceFromUrl(job.url), seniority: seniorityFromTitle(job.role), age: daysSince(job.postedAt, now) });
    }
    return out;
  }, [inbox, now]);

  // EVALUADA lookup: the latest evaluate worker per posting URL (running → badge).
  const scoreByUrl = useMemo(() => {
    const best = new Map<string, (typeof jobs)[number]>();
    for (const j of jobs) {
      if (!j.input || j.kind !== "evaluate") continue;
      const ex = best.get(j.input);
      if (!ex || j.startedAt > ex.startedAt) best.set(j.input, j);
    }
    const m = new Map<string, RowScore>();
    for (const [url, j] of best) {
      m.set(url, { score: j.result?.score ?? null, tone: j.result?.tone ?? "muted", jobId: j.id, running: j.status === "running" });
    }
    return m;
  }, [jobs]);

  // facet options — only surface what's actually present in the (non-hidden) data
  const availSources = useMemo(() => {
    const set = new Set<AtsSource>();
    for (const e of enriched) if (e.source && !hidden.includes(e.job.url)) set.add(e.source);
    return ATS_SOURCES.filter((s) => set.has(s));
  }, [enriched, hidden]);
  const availSeniorities = useMemo(() => {
    const set = new Set<Seniority>();
    for (const e of enriched) if (e.seniority && !hidden.includes(e.job.url)) set.add(e.seniority);
    return SENIORITY_ORDER.filter((s) => set.has(s));
  }, [enriched, hidden]);

  const filtered = useMemo(
    () =>
      enriched.filter((e) => {
        if (hidden.includes(e.job.url)) return false;
        if (within != null && (e.age == null || e.age > within)) return false;
        if (sources.size && (!e.source || !sources.has(e.source))) return false;
        if (seniorities.size && (!e.seniority || !seniorities.has(e.seniority))) return false;
        if (locQ.trim() && !(e.job.location || "").toLowerCase().includes(locQ.trim().toLowerCase())) return false;
        if (kw.trim() && !`${e.job.company} ${e.job.role}`.toLowerCase().includes(kw.trim().toLowerCase())) return false;
        return true;
      }),
    [enriched, hidden, within, sources, seniorities, locQ, kw],
  );

  // 🔴 SINGLE ORDER PLUG POINT — freshness only (newest first_seen first; unknown last).
  // A smarter ranker replaces ONLY this comparator; facets/triage/shortlist/score never
  // touch relevance. This is the whole firewall in one line.
  const ordered = useMemo(() => [...filtered].sort((a, b) => (a.age ?? Infinity) - (b.age ?? Infinity)), [filtered]);

  const anyFacet = within != null || sources.size > 0 || seniorities.size > 0 || locQ.trim() !== "" || kw.trim() !== "";
  const capped = !showAll && !anyFacet;
  const visible = capped ? ordered.slice(0, BATCH) : ordered;
  const hiddenCount = hidden.length;

  const skip = (job: InboxJob) => {
    setHidden((h) => (h.includes(job.url) ? h : [...h, job.url]));
    setUndo({ label: `${job.company} écartée`, fn: () => setHidden((h) => h.filter((u) => u !== job.url)) });
  };

  // Évaluation complète d'UNE offre — désormais le SEUL chemin vers une note.
  // Elle se déclenche depuis le panneau de « Lire l'annonce », c'est-à-dire au
  // moment précis où l'on sait que la dépense vaut le coup, et elle reste gatée
  // par une confirmation explicite dans la ligne : jamais de dépense par surprise.
  const evaluerUneOffre = (job: { url: string; company: string; role: string }) => {
    startJob({ title: `Évaluation · ${job.company}`, subtitle: job.role, kind: "evaluate", input: job.url, page: "/pipeline" });
  };

  // The parent (PipelineView) renders the rich empty-inbox card; here we always
  // have ≥1 raw posting.
  if (inbox.length === 0) return null;

  return (
    <div className="mx-auto mt-4 max-w-3xl">
      <FacetChips
        within={within}
        setWithin={setWithin}
        sources={sources}
        toggleSource={(s) => setSources((set) => { const n = new Set(set); n.has(s) ? n.delete(s) : n.add(s); return n; })}
        seniorities={seniorities}
        toggleSeniority={(s) => setSeniorities((set) => { const n = new Set(set); n.has(s) ? n.delete(s) : n.add(s); return n; })}
        locQ={locQ}
        setLocQ={setLocQ}
        kw={kw}
        setKw={setKw}
        availSources={availSources}
        availSeniorities={availSeniorities}
        resultCount={filtered.length}
        totalCount={enriched.length - hiddenCount}
        anyActive={anyFacet}
        onClear={() => { setWithin(null); setSources(new Set()); setSeniorities(new Set()); setLocQ(""); setKw(""); }}
      />

      {/* batch header: fresh slice by default, or the full filtered set */}
      <div className="mt-4 flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          {capped
            ? "Récentes — à regarder"
            : anyFacet
              ? `${filtered.length} résultat${filtered.length === 1 ? "" : "s"}`
              : "Tous les postes"}
        </p>
        {hiddenCount > 0 && (
          <button type="button" onClick={() => setHidden([])} className="text-xs text-faint transition-colors hover:text-foreground">
            {hiddenCount} masquée{hiddenCount === 1 ? "" : "s"} · rétablir
          </button>
        )}
      </div>

      {visible.length > 0 ? (
        /* Sous-tableaux par PROVENANCE. Ne pas confondre avec `source`, qui
           désigne l'ATS (Workday, Greenhouse…) : ici c'est « d'où vient cette
           ligne ». Un post du forum n8n et une annonce trouvée par le scanner
           ne se traitent pas pareil — le premier se répond par un message, la
           seconde par une candidature — et les voir mélangés sans étiquette
           obligeait à deviner à chaque ligne. */
        <div className="mt-3 space-y-5">
          {GROUPES_PROVENANCE.map(({ cle, libelle, detail }) => {
            const lot = visible.filter((e) => provenance(e.job.url) === cle);
            if (lot.length === 0) return null;
            return (
              <div key={cle}>
                <p className="mb-1.5 text-sm font-medium text-foreground">
                  {libelle} <span className="tabular-nums text-faint">{lot.length}</span>
                  <span className="ml-2 text-xs font-normal text-faint">{detail}</span>
                </p>
                <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
                  {lot.map((e) => (
                    <TriageRow
                      key={e.job.url}
                      job={e.job}
                      source={e.source}
                      age={e.age}
                      scored={scoreByUrl.get(e.job.url)}
                      onSkip={() => skip(e.job)}
                      onEvaluationComplete={() => evaluerUneOffre(e.job)}
                    />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-2xl border border-dashed border-border bg-surface/30 px-6 py-10 text-center">
          <p className="font-display text-lg">Aucun résultat</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">Assouplissez les filtres pour voir plus d&apos;offres à trier.</p>
        </div>
      )}

      {/* "See all N" — only when the fresh batch is capping a larger list */}
      {capped && ordered.length > BATCH && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 inline-flex w-full items-center justify-center gap-1 rounded-xl border border-border bg-surface/40 py-2.5 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[44px]"
        >
          Voir les {ordered.length} offres à trier →
        </button>
      )}

      <p className="mt-4 text-center text-xs text-faint">
        « Lire l&apos;annonce » est gratuit et cherche les exigences bloquantes ; l&apos;évaluation complète, qui donne
        la note et le rapport, se lance depuis ce panneau.
      </p>

      {/* undo toast */}
      {undo && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="inline-flex items-center gap-3 rounded-full border border-border bg-surface px-4 py-2 text-sm shadow-lg">
            <span className="text-muted">{undo.label}</span>
            <button type="button" onClick={() => { undo.fn(); setUndo(null); }} className="inline-flex items-center gap-1 font-medium text-brand max-sm:min-h-[44px]">
              <Undo2 className="size-3.5" /> Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
