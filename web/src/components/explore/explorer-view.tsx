"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Compass, ChevronDown, RotateCcw, AlertTriangle, Sparkles, Settings } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { instrumentSerif } from "@/lib/fonts";
import type { Application, InboxJob } from "@/lib/career-ops";
import { paramsToFilters, paramsToAi, type ExploreFilters } from "@/lib/explore";
import { FilterBuilder } from "./filter-builder";
import { DiscoveringState } from "./discovering-state";
import { AiHuntView } from "./ai-hunt-view";
import { ExploreModeToggle } from "./explore-mode-toggle";
import { AiSearchBox } from "./ai-search-box";
import { ResultsList, type EnrichedOffer } from "./results-list";
import { useExplore } from "./explore-provider";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const CLI_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  copilot: "Copilot CLI",
  qwen: "Qwen CLI",
  antigravity: "Antigravity CLI",
};

export function ExplorerView({
  seed,
  inboxSnapshot,
  appsSnapshot,
  rootExists,
}: {
  seed: { filters: ExploreFilters; seededFrom: string[] };
  inboxSnapshot: InboxJob[];
  appsSnapshot: Application[];
  rootExists: boolean;
}) {
  const { filters, setFilters, initFilters, phase, running, offers, discover, status, error, mode, setMode, aiIntent, setAiIntent, discoverAI, companiesScanned, companiesAvailable, capHit, droppedNoDate, partial } = useExplore();
  const scanNote =
    companiesScanned > 0
      ? `${companiesScanned.toLocaleString("fr-FR")}${companiesAvailable > companiesScanned ? ` entreprise${companiesScanned === 1 ? "" : "s"} sur ${companiesAvailable.toLocaleString("fr-FR")}` : ` entreprise${companiesScanned === 1 ? "" : "s"}`} scannée${companiesScanned === 1 ? "" : "s"}${partial ? " · certaines sources étaient injoignables" : ""}.`
      : undefined;
  const inited = useRef(false);
  const [refineOpen, setRefineOpen] = useState(false);
  const [cli, setCli] = useState<{ id: string | null; name?: string }>({ id: null });
  const [firstRun, setFirstRun] = useState(false);

  useEffect(() => {
    try {
      const id = JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId || null;
      setCli({ id, name: id ? CLI_NAMES[id] || id : undefined });
    } catch {
      setCli({ id: null });
    }
  }, []);

  // Initialize once from the URL (shareable search) or the server seed — without
  // clobbering anything the assistant set before this mount.
  useEffect(() => {
    if (inited.current) return;
    inited.current = true;
    const sp = new URLSearchParams(window.location.search);
    const ai = paramsToAi(sp);
    if (ai !== null) {
      setMode("ai");
      setAiIntent(ai);
    } else {
      initFilters(sp.toString() ? paramsToFilters(sp) : seed.filters);
      // Onboarding hand-off: ?run=1 auto-fires the free scan + flags the first-run
      // banner (the "matches found from your CV, free" reveal).
      if (sp.get("run") === "1") {
        setFirstRun(true);
        void discover();
      }
    }
  }, [seed.filters, initFilters, setMode, setAiIntent, discover]);

  const inboxUrls = useMemo(() => new Set(inboxSnapshot.map((j) => j.url)), [inboxSnapshot]);
  const enriched: EnrichedOffer[] = useMemo(
    () =>
      offers.map((o) => {
        const inPipeline = inboxUrls.has(o.url);
        const c = norm(o.company);
        const t = norm(o.title);
        const ev = appsSnapshot.find((a) => {
          if (norm(a.company) !== c) return false;
          const ar = norm(a.role);
          return ar.length > 3 && (t.includes(ar) || ar.includes(t.split(" ").slice(0, 3).join(" ")));
        });
        return { ...o, inPipeline, evaluatedN: ev?.n };
      }),
    [offers, inboxUrls, appsSnapshot],
  );

  const isAi = mode === "ai";
  if (running) return isAi ? <AiHuntView cliName={cli.name} /> : <DiscoveringState />;

  const canDiscover = filters.ats.length > 0;
  const isResults = phase === "results";

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <Compass className="size-6 text-brand" />
            <h1 className={`${instrumentSerif.className} text-3xl text-foreground`}>Explorer</h1>
            <span className="rounded-full border border-brand/30 bg-brand-soft px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-text">Nouveau</span>
          </div>
          <div className="w-full sm:ml-auto sm:w-auto">
            <ExploreModeToggle mode={mode} onChange={setMode} cliConfigured={!!cli.id} />
          </div>
        </div>
        {!isResults && (
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-muted">
            {isAi
              ? "Décrivez le poste en langage courant — une IA le cherche sur le web ouvert, avec votre propre IA. Les candidats restent non vérifiés jusqu'à ce que vous les évaluiez."
              : "Scannez le réseau public des ATS — Greenhouse, Lever, Ashby, Workday. Des offres récentes qui vous correspondent, zéro jeton. Vous ne dépensez que si vous choisissez d'en évaluer une."}
          </p>
        )}
      </header>

      {!rootExists && (
        <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          Votre dossier career-ops n’est pas encore configuré — la découverte a besoin d’une installation avec un profil pour s’amorcer.
        </div>
      )}

      {isAi ? (
        phase === "blocked" ? (
          <BlockedCard />
        ) : (
          <div className="space-y-6">
            <AiSearchBox
              intent={aiIntent}
              onIntent={setAiIntent}
              onSubmit={() => void discoverAI()}
              cliConfigured={!!cli.id}
              cliName={cli.name}
              onRunScan={() => setMode("scan")}
            />
            {phase === "results" && <ResultsList offers={enriched} />}
            {phase === "empty-loose" && (
              <EmptyState
                tone="loose"
                title="Aucun résultat public — pour l'instant."
                body="La recherche IA ne lit que ce qui est public. Élargissez votre demande, ou lancez le scan gratuit sur le réseau des ATS."
                onRerun={() => setMode("scan")}
                rerunLabel="Lancer le scan gratuit"
              />
            )}
            {phase === "failed" && <FailedCard msg={error || status} onRetry={() => void discoverAI()} />}
          </div>
        )
      ) : (
        <>
          {isResults ? (
            <div className="mb-6 rounded-xl border border-border bg-surface/30">
              <button type="button" onClick={() => setRefineOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-foreground">
                <Compass className="size-4 text-brand" /> Affiner la recherche
                <ChevronDown className={cn("ml-auto size-4 text-muted transition-transform", refineOpen && "rotate-180")} />
              </button>
              {refineOpen && (
                <div className="space-y-4 border-t border-border p-4">
                  <FilterBuilder filters={filters} onChange={setFilters} seededFrom={seed.seededFrom} />
                  <DiscoverBar canDiscover={canDiscover} onDiscover={discover} label="Relancer (gratuit)" />
                </div>
              )}
            </div>
          ) : (
            <div className="mb-6 rounded-2xl border border-border bg-surface/30 p-5">
              <FilterBuilder filters={filters} onChange={setFilters} seededFrom={seed.seededFrom} />
              <div className="mt-5">
                <DiscoverBar canDiscover={canDiscover} onDiscover={discover} label="Découvrir (gratuit)" />
              </div>
            </div>
          )}

          {isResults && firstRun && (
            <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-emerald-500" />
              <p className="text-[13px] leading-relaxed text-foreground">
                Voici des postes réellement ouverts qui correspondent à votre CV. <span className="text-emerald-600 dark:text-emerald-400">Rien de tout ça ne vous a coûté un jeton.</span> Choisissez celui qui vous intrigue le plus — évaluez-le et je vous dirai exactement quel score vous obtenez, et pourquoi.
              </p>
            </div>
          )}

          {isResults && capHit && (
            <CappedBanner companiesScanned={companiesScanned} companiesAvailable={companiesAvailable} onRefine={() => setRefineOpen(true)} />
          )}
          {isResults && <ResultsList offers={enriched} />}

          {phase === "empty-current" && (
            <EmptyState
              tone="good"
              title="Vous êtes à jour."
              body="Rien de nouveau depuis votre dernier scan. Vos candidatures sont à jour — c'est le but."
              note={scanNote}
              onRerun={() => {
                setFilters({ ...filters, sinceDays: Math.max(filters.sinceDays, 30) });
                void discover();
              }}
              rerunLabel="Remonter à 30 jours"
            />
          )}
          {phase === "empty-loose" && (
            <EmptyState
              tone="loose"
              title="Aucune offre récente — pour l'instant."
              body="La découverte est gratuite — assouplissez et relancez autant que vous voulez."
              note={scanNote}
              onRerun={() => {
                setFilters({ ...filters, sinceDays: 30, block: [], allow: [] });
                void discover();
              }}
              rerunLabel="Élargir à 30 jours · effacer le lieu"
            />
          )}
          {phase === "degraded" && (
            <DegradedCard
              onRetry={() => void discover()}
              companiesScanned={companiesScanned}
              companiesAvailable={companiesAvailable}
              capHit={capHit}
              droppedNoDate={droppedNoDate}
              partial={partial}
            />
          )}
          {phase === "failed" && <FailedCard msg={error || status} onRetry={() => void discover()} />}
        </>
      )}
    </div>
  );
}

function DiscoverBar({ canDiscover, onDiscover, label }: { canDiscover: boolean; onDiscover: () => void; label: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={!canDiscover}
        onClick={onDiscover}
        className="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-brand-foreground shadow-sm transition-all hover:brightness-110 disabled:opacity-50 max-sm:min-h-[44px]"
      >
        <Compass className="size-4" /> {label}
      </button>
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
        <span className="size-1.5 rounded-full bg-emerald-500" />
        Évaluer un poste ensuite coûte des jetons. Découvrir, jamais.
      </span>
    </div>
  );
}

function EmptyState({ tone, title, body, note, onRerun, rerunLabel }: { tone: "good" | "loose"; title: string; body: string; note?: string; onRerun: () => void; rerunLabel: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface/30 px-6 py-12 text-center">
      <div className={cn("mx-auto grid size-12 place-items-center rounded-full", tone === "good" ? "bg-emerald-500/12 text-emerald-500" : "bg-brand-soft text-brand")}>
        <Sparkles className="size-6" />
      </div>
      <h2 className={`${instrumentSerif.className} mt-4 text-2xl text-foreground`}>{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">{body}</p>
      {note && <p className="mx-auto mt-1 max-w-md text-[12px] text-faint">{note}</p>}
      <button onClick={onRerun} className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface/50 px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:border-brand/40 hover:text-brand">
        <RotateCcw className="size-4" /> {rerunLabel}
      </button>
    </div>
  );
}

function DegradedCard({
  onRetry,
  companiesScanned,
  companiesAvailable,
  capHit,
  droppedNoDate,
  partial,
}: {
  onRetry: () => void;
  companiesScanned: number;
  companiesAvailable: number;
  capHit: boolean;
  droppedNoDate: number;
  partial: boolean;
}) {
  // 0 results, but the scan was NOT a clean full search → never "all caught up".
  // Pick the most informative reason (authoritative when the scanner's --json mode
  // is available; otherwise the 0-companies fallback).
  let title = "Le scan s’est lancé, mais n’a joint aucune source.";
  let body =
    "Les annuaires ATS publics n’ont pas répondu — généralement un incident réseau passager ou une limitation de débit, donc rien n’a pu être cherché. Ce n’est pas « vous êtes à jour » ; un nouvel essai dans un instant suffit le plus souvent.";
  if (companiesScanned > 0 && capHit) {
    title = "Aucun résultat dans la portion explorée.";
    body = `Le scan est plafonné : il n’a cherché que dans ${companiesScanned.toLocaleString("fr-FR")}${companiesAvailable > companiesScanned ? ` entreprises sur ${companiesAvailable.toLocaleString("fr-FR")}` : " entreprises"} — pas dans tout le réseau. Augmentez la profondeur de scan (Affiner la recherche) ou resserrez vos postes, puis relancez pour chercher plus loin.`;
  } else if (companiesScanned > 0 && droppedNoDate > 0) {
    title = "Des postes d’apparence récente ont été écartés faute de date.";
    body = `${droppedNoDate.toLocaleString("fr-FR")} offre${droppedNoDate === 1 ? "" : "s"} correspondai${droppedNoDate === 1 ? "t" : "ent"} mais n’avai${droppedNoDate === 1 ? "t" : "ent"} pas de date de publication claire : le filtre de fraîcheur les a écartées. Élargir la fenêtre de temps ramène souvent des équivalents datés.`;
  } else if (companiesScanned > 0 && partial) {
    title = "Certains sites d’offres étaient injoignables.";
    body = `Le scan a cherché dans ${companiesScanned.toLocaleString("fr-FR")} entreprises, mais une ou plusieurs sources n’ont pas répondu — c’est donc un résultat partiel, pas « vous êtes à jour ». Un nouvel essai suffit le plus souvent.`;
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-center">
      <AlertTriangle className="mx-auto size-6 text-amber-500" />
      <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{body}</p>
      <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand">
        <RotateCcw className="size-4" /> Relancer le scan
      </button>
    </div>
  );
}

function CappedBanner({ companiesScanned, companiesAvailable, onRefine }: { companiesScanned: number; companiesAvailable: number; onRefine: () => void }) {
  // Results ARE present, but the scan was capped — tell the user there's more, so a
  // partial list never reads as "everything there is".
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-2.5 text-[13px]">
      <span className="text-foreground">
        Affichage d’une portion plafonnée — {companiesScanned.toLocaleString("fr-FR")}
        {companiesAvailable > companiesScanned ? ` entreprises explorées sur ${companiesAvailable.toLocaleString("fr-FR")}` : " entreprises explorées"}.
      </span>
      <button onClick={onRefine} className="font-medium text-brand hover:underline">
        Augmenter la profondeur de scan pour chercher plus loin
      </button>
    </div>
  );
}

function FailedCard({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  // The scanner-missing 400 (data-only / pre-scan-ats-full checkout) must NOT
  // offer a "Try again" that re-fails forever — give a real next step instead.
  // ⚠️ Ce test doit rester aligné sur les messages d'erreur FR émis par
  // /api/explore, /api/run, lib/core/pipeline.ts et explore-provider.tsx.
  const scannerMissing = /n['’]est pas (encore )?disponible|que des données|installation career-ops complète|scanner/i.test(msg);
  if (scannerMissing) {
    return (
      <div className="rounded-2xl border border-border bg-surface/30 px-6 py-10 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
          <Compass className="size-6" />
        </div>
        <h2 className={`${instrumentSerif.className} mt-4 text-2xl text-foreground`}>La découverte nécessite l’outillage complet</h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
          Votre dossier career-ops semble ne contenir que des données, ou être sur une version plus ancienne. Le scanner
          gratuit est livré avec une installation complète — mettez career-ops à jour, ou collez l’URL d’une offre dans
          les candidatures pour l’évaluer directement.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href="/pipeline" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground transition hover:brightness-110">
            Ouvrir les candidatures
          </Link>
          <Link href="/config" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-foreground transition hover:border-brand/40 hover:text-brand">
            Ouvrir la configuration
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5 text-center">
      <AlertTriangle className="mx-auto size-6 text-amber-500" />
      <p className="mt-2 text-sm font-medium text-foreground">Impossible de terminer la recherche.</p>
      <p className="mt-1 text-[13px] text-muted">{msg}</p>
      <button onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand">
        <RotateCcw className="size-4" /> Réessayer
      </button>
    </div>
  );
}

function BlockedCard() {
  return (
    <div className="rounded-2xl border border-border bg-surface/30 px-6 py-12 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-full bg-brand-soft text-brand">
        <Sparkles className="size-6" />
      </div>
      <h2 className={`${instrumentSerif.className} mt-4 text-2xl text-foreground`}>La recherche IA nécessite un CLI</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-muted">
        Connectez Claude Code, Gemini ou n’importe quel CLI d’agent — votre clé, vos jetons, votre machine. Le scan gratuit reste disponible sans cela.
      </p>
      <Link href="/config" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-2 text-sm font-semibold text-brand-foreground transition hover:brightness-110">
        <Settings className="size-4" /> Ouvrir la configuration
      </Link>
    </div>
  );
}
