"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Coins, Copy, ExternalLink, Loader2, MessageSquarePlus, ScanSearch, Sparkles, X } from "lucide-react";
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
// "not scored" (CRUDA) — never a fake match%. Once its eval finishes it flips to
// EVALUADA (a real A–F badge). Skip→hidden is free + undoable.
export function TriageRow({
  job,
  source,
  age,
  scored,
  onSkip,
  onEvaluationComplete,
}: {
  job: InboxJob;
  source: AtsSource | null;
  age: number | null;
  scored?: RowScore;
  onSkip: () => void;
  /** Lance la VRAIE évaluation (mode oferta : note, rapport, ligne de tracker),
   *  proposée depuis le panneau du pré-filtre. Le parent la tient parce que c'est
   *  lui qui possède startJob. */
  onEvaluationComplete: () => void;
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

  // ── Évaluation express : est-ce que ça vaut le coup d'aller plus loin ? ─────
  //
  // Le classement de la file (scan-rank.mjs) ne regarde que l'intitulé, le lieu
  // et la date : il ne lit JAMAIS le corps de l'annonce, et il traite « junior »
  // et « senior » comme des mots vides. D'où le piège du 2026-08-07 — une offre
  // à 83/100 qui exigeait « 3 à 5 ans d'expérience » dans son texte. Aucun
  // réglage de mots-clés ne l'attrape : il faut lire l'annonce, c'est ce que
  // fait /api/pipeline/evaluate.
  //
  // Ce n'est PAS l'évaluation complète (mode oferta, note sur 5, rapport,
  // ligne de tracker) : c'est un filtre d'entrée, et le badge à droite reste la
  // vraie note quand elle existe.
  type Fit = {
    verdict?: string;
    resume?: string;
    bloquants?: { quoi: string; citation: string }[];
    bloquantsNonVerifies?: string[];
    atouts?: string[];
    ecarts?: string[];
    error?: string;
  };
  const [fit, setFit] = useState<Fit | null>(null);
  const [fitEnCours, setFitEnCours] = useState(false);
  // Armement du bouton « évaluation complète » : premier clic annonce la dépense,
  // second la déclenche. C'est le dernier garde-fou anti-dépense-par-surprise
  // depuis le retrait de la barre de sélection, donc il ne se supprime pas.
  const [arme, setArme] = useState(false);

  // ── Générer la candidature (lettre + CV) via le workflow n8n 2 ─────────────
  //
  // Le pendant du bouton « Générer la candidature » des offres France Travail,
  // pour cette file-ci. Il ne passe PAS par l'évaluation complète ni par un
  // rapport : /api/candidature/generer lit l'annonce et passe la main au
  // workflow, qui dépose la fiche dans « À valider ». Rien n'est envoyé à un
  // recruteur — c'est Linéo qui valide là-bas.
  const [candidature, setCandidature] = useState<{ ok: boolean; message: string } | null>(null);
  const [candidatureEnCours, setCandidatureEnCours] = useState(false);

  async function genererCandidature() {
    setCandidatureEnCours(true);
    setCandidature(null);
    try {
      const res = await fetch("/api/candidature/generer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: job.url }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      setCandidature(
        data.ok
          ? { ok: true, message: data.message || "génération lancée" }
          : { ok: false, message: data.error || `échec (${res.status})` },
      );
    } catch (e) {
      setCandidature({ ok: false, message: e instanceof Error ? e.message : "génération injoignable" });
    } finally {
      setCandidatureEnCours(false);
    }
  }

  async function evaluerOffre() {
    setFitEnCours(true);
    setFit(null);
    try {
      const res = await fetch("/api/pipeline/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: job.url }),
      });
      setFit((await res.json()) as Fit);
    } catch (e) {
      setFit({ error: e instanceof Error ? e.message : "évaluation injoignable" });
    } finally {
      setFitEnCours(false);
    }
  }

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
    <li className={cn("flex flex-col gap-2 px-3 py-2.5 transition-colors hover:bg-surface-hover sm:px-4", evaluated && "opacity-95")}>
      <div className="flex items-center gap-2.5 sm:gap-3">
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

          {/* Évaluer — lit l'annonce, cherche les exigences bloquantes.
              Masqué sur les posts du forum n8n : ils n'ont pas d'annonce
              structurée, et « Réponse » y est déjà le bon geste. */}
          {!isN8n && !evaluated && (
            <button
              type="button"
              onClick={evaluerOffre}
              disabled={fitEnCours}
              title="Lit l'annonce et signale les exigences bloquantes. Gratuit : ne produit ni note, ni rapport, ni ligne de suivi."
              className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-brand disabled:opacity-60 max-sm:min-h-[44px]"
            >
              {fitEnCours ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
              {/* « Lire l'annonce » et non « Évaluer » : deux commandes s'appelaient
                  Évaluer avec des conséquences opposées, et la seule qui produise une
                  note et un rapport est celle du lot. Nommer celle-ci par ce qu'elle
                  fait supprime la confusion. */}
              <span className="max-sm:hidden">{fitEnCours ? "…" : "Lire l'annonce"}</span>
            </button>
          )}

          {/* Générer la candidature — passe la main au workflow n8n 2 (lettre +
              CV), qui dépose la fiche dans « À valider ». Reste disponible même
              après une évaluation : ce sont deux gestes indépendants. Masqué sur
              les posts du forum, qui n'ont pas d'annonce à lire. */}
          {!isN8n && job.url && (
            <button
              type="button"
              onClick={genererCandidature}
              disabled={candidatureEnCours}
              title="Générer lettre + CV adaptés pour cette offre — la fiche arrive dans « À valider », rien n'est envoyé"
              className="inline-flex items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-brand disabled:opacity-60 max-sm:min-h-[44px]"
            >
              {candidatureEnCours ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              <span className="max-sm:hidden">{candidatureEnCours ? "…" : "Candidature"}</span>
            </button>
          )}

          {/* EVALUADA state OU l'écart */}
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
            <button
              type="button"
              onClick={onSkip}
              title="Écarter — masquer de la file de tri"
              className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground max-sm:min-h-[44px] max-sm:min-w-[44px]"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {/* Panneau d'évaluation. Les bloquants sont affichés AVEC leur citation :
          c'est la citation qui distingue une exigence réelle d'une impression,
          et /api/pipeline/evaluate refuse de garder un bloquant qu'il n'a pas
          pu retrouver mot pour mot dans l'annonce. */}
      {fit && (
        <div className="ml-7 rounded-lg border border-border bg-surface/40 p-3 sm:ml-9">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-faint">
              {fit.error
                ? "Évaluation impossible"
                : fit.verdict === "hors_cible"
                  ? "Hors cible"
                  : fit.verdict === "a_postuler"
                    ? "À postuler"
                    : "À regarder"}
            </span>
            <button
              type="button"
              onClick={() => setFit(null)}
              title="Fermer"
              className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>

          {fit.error ? (
            <p className="text-xs text-muted">{fit.error}</p>
          ) : (
            <div className="space-y-2 text-xs">
              {fit.resume && <p className="text-foreground">{fit.resume}</p>}

              {!!fit.bloquants?.length && (
                <ul className="space-y-1">
                  {fit.bloquants.map((b, i) => (
                    <li key={i} className="text-foreground">
                      <span className="font-medium">Bloquant : {b.quoi}</span>
                      <br />
                      <span className="text-muted">« {b.citation} »</span>
                    </li>
                  ))}
                </ul>
              )}

              {!!fit.ecarts?.length && (
                <p className="text-muted">Écarts : {fit.ecarts.join(" · ")}</p>
              )}
              {!!fit.atouts?.length && (
                <p className="text-muted">Atouts : {fit.atouts.join(" · ")}</p>
              )}

              {/* Ce que le modèle a avancé sans pouvoir le citer. Montré, mais
                  jamais compté comme bloquant : une offre écartée à tort coûte
                  plus cher qu'une offre évaluée pour rien. */}
              {!!fit.bloquantsNonVerifies?.length && (
                <p className="text-faint">
                  Avancé sans citation dans l&rsquo;annonce, donc non retenu :{" "}
                  {fit.bloquantsNonVerifies.join(" · ")}
                </p>
              )}

              {/* La suite. Sans ce bouton le panneau était un cul-de-sac : il dit
                  « à regarder » au moment précis où l'on sait que la dépense vaut
                  le coup, et il fallait retourner mettre l'offre de côté pour la
                  faire évaluer par la barre du bas. Le coût est annoncé et gaté par
                  une confirmation explicite, comme dans la barre : jamais de
                  dépense par surprise. */}
              {!evaluated && (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                  <button
                    type="button"
                    onClick={() => (arme ? (setArme(false), onEvaluationComplete()) : setArme(true))}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors max-sm:min-h-[44px]",
                      arme ? "bg-brand text-brand-foreground" : "bg-brand-soft text-brand hover:brightness-95",
                    )}
                  >
                    <Coins className="size-3.5" />
                    {arme ? "Confirmer : lancer et dépenser" : "Lancer l'évaluation complète"}
                  </button>
                  <span className="text-[11px] text-faint">
                    {arme
                      ? "note sur 5, rapport et ligne de suivi"
                      : "consomme des jetons, contrairement à la lecture ci-dessus"}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Suite de « Candidature » : lancée, ou refusée avec la raison. Le
          message d'échec est celui du serveur (workflow désactivé, annonce
          illisible…) — un « ça n'a pas marché » sans cause fait chercher au
          mauvais endroit. */}
      {candidature && (
        <div className="ml-7 flex items-start gap-2 rounded-lg border border-border bg-surface/40 p-3 sm:ml-9">
          {candidature.ok ? (
            <Check className="mt-px size-3.5 shrink-0 text-emerald-500" />
          ) : (
            <X className="mt-px size-3.5 shrink-0 text-red-400" />
          )}
          <p className="flex-1 text-xs text-foreground">
            {candidature.message}
            {candidature.ok && (
              <>
                {" "}
                <Link href="/a-valider" className="font-medium text-brand hover:underline">
                  Ouvrir « À valider »
                </Link>
              </>
            )}
          </p>
          <button
            type="button"
            onClick={() => setCandidature(null)}
            title="Fermer"
            className="inline-flex items-center justify-center rounded-md p-1 text-faint transition-colors hover:bg-surface-hover hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

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
