"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock, Loader2, Radar, Wrench } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { useJobs, type Job } from "@/components/jobs/job-store";
import { cn } from "@/lib/cn";

type Company = { name: string; status: string; detail: string };
type Result = { available: boolean; configured: boolean; companies: Company[] };
/** Une entrée de portals.yml telle quelle — y compris `enabled: false`, que le
 *  contrôle de santé ne voit JAMAIS (verify-portals.mjs saute ces entrées).
 *  `enAttente` isole celles qu'on a ajoutées sans ATS, des entreprises
 *  désactivées volontairement (qui ont, elles, une vraie page carrières). */
type Suivie = { nom: string; careers_url: string; enabled: boolean; enAttente: boolean; notes: string };

// Les CLÉS sont les statuts renvoyés par /api/portals/verify — jamais traduites.
const TONE: Record<string, { dot: string; label: string; chip: string }> = {
  live: { dot: "bg-emerald-500", label: "active", chip: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" },
  empty: { dot: "bg-amber-500", label: "active · vide", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-400" },
  broken: { dot: "bg-red-500", label: "cassée", chip: "bg-red-500/15 text-red-700 dark:text-red-400" },
  skipped: { dot: "bg-zinc-400", label: "sans ATS", chip: "bg-surface-hover text-muted" },
};
const ORDER: Record<string, number> = { broken: 0, empty: 1, live: 2, skipped: 3 };

export function PortalsView() {
  const [res, setRes] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [suivies, setSuivies] = useState<Suivie[]>([]);
  const { jobs, startJob } = useJobs();

  // Les entreprises en attente d'ATS s'affichent À L'OUVERTURE : une lecture de
  // fichier, aucune sonde. Sans ça, une entreprise ajoutée depuis une offre
  // France Travail resterait invisible ici (elle est `enabled: false`, donc le
  // contrôle de santé ne la teste pas) — ajoutée nulle part, du point de vue de
  // l'utilisateur.
  useEffect(() => {
    fetch("/api/portals/track")
      .then((r) => r.json())
      .then((j: { entreprises?: Suivie[] }) => setSuivies(Array.isArray(j.entreprises) ? j.entreprises : []))
      .catch(() => setSuivies([]));
  }, []);

  // map the agentic "fix-portal" workers to the company they're repairing
  const fixByCompany = useMemo(() => {
    const m = new Map<string, (typeof jobs)[number]>();
    for (const j of jobs) {
      if (j.kind !== "fix-portal" || !j.input) continue;
      const ex = m.get(j.input);
      if (!ex || j.startedAt > ex.startedAt) m.set(j.input, j);
    }
    return m;
  }, [jobs]);

  function check() {
    setLoading(true);
    fetch("/api/portals/verify")
      .then((r) => r.json())
      .then(setRes)
      .catch(() => setRes({ available: false, configured: false, companies: [] }))
      .finally(() => setLoading(false));
  }

  const enAttente = suivies.filter((e) => e.enAttente);
  const companies = res?.companies ?? [];
  const broken = companies.filter((c) => c.status === "broken");
  const liveN = companies.filter((c) => c.status === "live" || c.status === "empty").length;
  const sorted = [...companies].sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));

  return (
    <div>
      <div className="flex items-center gap-3">
        <button
          onClick={check}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />}
          Contrôler la santé des portails
        </button>
        {loading && <span className="text-xs text-faint">Test de l&apos;ATS de chaque entreprise… (~30–60 s)</span>}
      </div>

      {enAttente.length > 0 && (
        <div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-amber-600 dark:text-amber-400" />
            <h2 className="text-sm font-medium text-foreground">
              En attente d&apos;ATS <span className="tabular-nums text-faint">{enAttente.length}</span>
            </h2>
          </div>
          <p className="mt-1.5 text-sm text-muted">
            Ajoutées depuis une offre ou une candidature, mais aucun board public (Greenhouse, Ashby, Lever) ne
            répondait à leur nom. Elles sont <strong>désactivées</strong>
            {" — donc jamais scannées, et sans risque pour les tournées. "}
            Confiez la recherche à l&apos;agent, ou complétez <code>careers_url</code> dans{" "}
            <code>portals.yml</code>.
          </p>
          <ul className="mt-3 divide-y divide-amber-500/20 overflow-hidden rounded-xl border border-amber-500/20 bg-surface/40">
            {enAttente.map((e) => (
              <li key={e.nom} className="flex items-center gap-3 px-4 py-2.5">
                <CompanyLogo name={e.nom} size={20} />
                <span className="shrink-0 text-sm font-medium">{e.nom}</span>
                <span className="truncate font-mono text-xs text-faint">{e.careers_url || "careers_url à compléter"}</span>
                <div className="ml-auto shrink-0">
                  <FixAffordance
                    company={e.nom}
                    job={fixByCompany.get(e.nom)}
                    label="Trouver l’ATS"
                    onFix={() =>
                      startJob({
                        title: `Recherche d'ATS · ${e.nom}`,
                        subtitle: "trouver la page carrières scannable",
                        kind: "fix-portal",
                        input: e.nom,
                        page: "/portals",
                      })
                    }
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {res && !res.available && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          <code className="text-foreground">verify-portals.mjs</code> introuvable — cela nécessite une installation
          career-ops complète (l’interface web orchestre le validateur du cœur).
        </p>
      )}
      {res && res.available && !res.configured && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Pas encore de <code className="text-foreground">portals.yml</code> — demandez à l’assistant de définir les entreprises à scanner.
        </p>
      )}

      {res && res.configured && (
        <div className="mt-5">
          <p className="text-sm text-muted">
            <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{liveN}</span> actives ·{" "}
            <span className="tabular-nums text-red-600 dark:text-red-400">{broken.length}</span> cassées ·{" "}
            <span className="tabular-nums">{companies.length}</span> suivies
          </p>
          {broken.length > 0 && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
              <span className="font-medium text-red-700 dark:text-red-400">
                {broken.length} entreprise{broken.length === 1 ? "" : "s"} disparaî{broken.length === 1 ? "t" : "ssent"}{" "}
                silencieusement de chaque scan
              </span>{" "}
              <span className="text-muted">
                — leur lien carrières est cassé. Corrigez <code>careers_url</code> dans <code>portals.yml</code> (ou
                demandez à l’assistant de les réparer).
              </span>
            </div>
          )}
          <ul className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface/40">
            {sorted.map((c) => {
              const t = TONE[c.status] ?? TONE.skipped;
              return (
                <li key={c.name} className="flex items-center gap-3 px-4 py-2.5">
                  <CompanyLogo name={c.name} size={20} />
                  <span className={cn("size-1.5 shrink-0 rounded-full", t.dot)} />
                  <span className="shrink-0 text-sm font-medium">{c.name}</span>
                  <span className="truncate font-mono text-xs text-faint">{c.detail}</span>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
                    {c.status === "broken" && <FixAffordance company={c.name} job={fixByCompany.get(c.name)} onFix={() => startJob({ title: `Réparation · ${c.name}`, subtitle: "corriger l'identifiant du portail", kind: "fix-portal", input: c.name, page: "/portals" })} />}
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", t.chip)}>{t.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function FixAffordance({
  company,
  job,
  onFix,
  label = "Réparer",
}: {
  company: string;
  job?: Job;
  onFix: () => void;
  /** « Réparer » pour un lien cassé, « Trouver l'ATS » pour une entreprise
   *  ajoutée sans board : même agent, deux points de départ. */
  label?: string;
}) {
  if (job?.status === "running")
    return (
      <Link href={`/jobs/${job.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand">
        <Loader2 className="size-3 animate-spin" /> Recherche…
      </Link>
    );
  if (job?.status === "done")
    return (
      <Link href={`/jobs/${job.id}`} className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
        traitée · re-tester
      </Link>
    );
  return (
    <button
      onClick={onFix}
      title={`Demander à l'agent de retrouver la page carrières scannable de ${company}`}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-brand/40 hover:text-brand"
    >
      <Wrench className="size-3" /> {label}
    </button>
  );
}
