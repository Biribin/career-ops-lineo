"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, BookmarkCheck, Check, Copy, ExternalLink, Loader2, MessageSquarePlus, X } from "lucide-react";
import type { InboxJob } from "@/lib/career-ops";
import type { AtsSource } from "@/lib/explore";
import { ATS_LABEL } from "@/lib/explore";
import { Badge } from "@/components/ui/badge";
import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";

export type RowScore = { score: number | null; tone: "good" | "warn" | "bad" | "muted"; jobId: string; running: boolean };

function agoLabel(age: number | null): string | null {
  if (age == null) return null;
  if (age <= 0) return "aujourd'hui";
  if (age === 1) return "hier";
  if (age < 7) return `il y a ${age} j`;
  if (age < 30) return `il y a ${Math.floor(age / 7)} sem.`;
  return `il y a ${Math.floor(age / 30)} mois`;
}

// One raw posting in the triage list. Shows ONLY cheap, free signals + an honest
// "not scored" (CRUDA) — never a fake match%. Once its shortlist eval finishes it
// flips to EVALUADA (a real A–F badge). Save→shortlist / Skip→hidden are free + undoable.
export function TriageRow({
  job,
  source,
  age,
  scored,
  selected,
  shortlisted,
  onToggleSelect,
  onSave,
  onSkip,
}: {
  job: InboxJob;
  source: AtsSource | null;
  age: number | null;
  scored?: RowScore;
  selected: boolean;
  shortlisted: boolean;
  onToggleSelect: () => void;
  onSave: () => void;
  onSkip: () => void;
}) {
  const ago = agoLabel(age);
  const evaluated = !!scored && (scored.running || scored.score != null);
  // Un post du forum n8n → on répond par un message (pas de CV/lettre). Les
  // offres classiques passent par le flux d'évaluation/candidature habituel.
  const isN8n = (job.url || "").includes("community.n8n.io");

  // Génération d'un brouillon de réponse (message d'approche) via /api/offer-reply
  // (Claude Code / Max). Panneau de résultat inline + copie. Le fetch est
  // same-origin : le navigateur renvoie tout seul le Basic Auth de la session.
  const [reply, setReply] = useState<string | null>(null);
  const [gen, setGen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function generateReply() {
    setGen(true);
    setReply(null);
    try {
      const res = await fetch("/api/offer-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: job.url, company: job.company, role: job.role }),
      });
      const data = (await res.json()) as { text?: string; error?: string };
      setReply(data.text || data.error || "(réponse vide)");
      // Enregistre le brouillon dans le module « Réponses n8n » (suivi + relance).
      if (data.text) {
        void fetch("/api/n8n-replies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "save", url: job.url, titre: job.role, company: job.company, message: data.text }),
        });
      }
    } catch (e) {
      setReply(e instanceof Error ? e.message : "échec de la génération");
    } finally {
      setGen(false);
    }
  }

  async function copyReply() {
    if (!reply) return;
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard indisponible — non bloquant */
    }
  }

  return (
    <li
      className={cn(
        "flex flex-col gap-2 px-3 py-2.5 transition-colors sm:px-4",
        selected ? "bg-brand-soft/50" : "hover:bg-surface-hover",
        evaluated && "opacity-95",
      )}
    >
      <div className="flex items-center gap-2.5 sm:gap-3">
        {/* multi-select — power-user batch to shortlist */}
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Sélectionner ${job.company} ${job.role}`}
          className="size-4 shrink-0 accent-brand max-sm:min-h-[44px] max-sm:min-w-[24px]"
        />

        <CompanyLogo name={job.company} size={20} />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            <span className="font-medium text-foreground">{job.company}</span>
            {/* Rôle = lien vers le post d'origine (ouvre l'offre dans un nouvel onglet) */}
            {job.url ? (
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted transition-colors hover:text-brand hover:underline"
              >
                {" · "}
                {job.role}
              </a>
            ) : (
              <span className="text-muted"> · {job.role}</span>
            )}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
            {job.location && <span className="truncate">{job.location}</span>}
            {source && <span className="rounded bg-surface-hover px-1 py-px font-medium text-muted">{ATS_LABEL[source]}</span>}
            {ago && <span>{ago}</span>}
            {/* 🔴 CRUDA: honest "not scored" — no fabricated match%. */}
            {!evaluated && <span className="italic text-muted">non évaluée</span>}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Lien direct vers le post */}
          {job.url && (
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Ouvrir l'offre d'origine"
              className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-brand max-sm:min-h-[44px] max-sm:min-w-[44px]"
            >
              <ExternalLink className="size-4" />
            </a>
          )}

          {/* Générer une réponse (message d'approche) via Max — posts n8n uniquement */}
          {isN8n && (
            <button
              type="button"
              onClick={generateReply}
              disabled={gen}
              title="Générer une réponse au post n8n"
              className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-brand disabled:opacity-60 max-sm:min-h-[44px]"
            >
              {gen ? <Loader2 className="size-4 animate-spin" /> : <MessageSquarePlus className="size-4" />}
              <span className="max-sm:hidden">{gen ? "…" : "Réponse"}</span>
            </button>
          )}

          {/* EVALUADA state OU actions save/skip */}
          {evaluated ? (
            <Link href={`/jobs/${scored!.jobId}`} className="flex items-center gap-1.5 text-xs">
              {scored!.running ? (
                <>
                  <Loader2 className="size-3.5 animate-spin text-brand" />
                  <span className="text-brand max-sm:hidden">Évaluation…</span>
                </>
              ) : (
                <Badge tone={scored!.tone}>{scored!.score}/5</Badge>
              )}
            </Link>
          ) : (
            <>
              <button
                type="button"
                onClick={onSave}
                title={shortlisted ? "Dans votre sélection" : "Ajouter à la sélection"}
                aria-pressed={shortlisted}
                className={cn(
                  "inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px] max-sm:min-w-[44px]",
                  shortlisted ? "text-brand" : "text-muted hover:bg-surface-hover hover:text-brand",
                )}
              >
                {shortlisted ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
                <span className="max-sm:hidden">{shortlisted ? "Ajoutée" : "Garder"}</span>
              </button>
              <button
                type="button"
                onClick={onSkip}
                title="Écarter — masquer de la file de tri"
                className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground max-sm:min-h-[44px] max-sm:min-w-[44px]"
              >
                <X className="size-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Panneau de la réponse générée */}
      {reply && (
        <div className="ml-7 rounded-lg border border-border bg-surface/40 p-3 sm:ml-9">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Brouillon de réponse</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={copyReply}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-brand"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copié" : "Copier"}
              </button>
              <button
                type="button"
                onClick={() => setReply(null)}
                title="Fermer"
                className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          </div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{reply}</p>
        </div>
      )}
    </li>
  );
}
