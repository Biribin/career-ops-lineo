"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Clock, Copy, ExternalLink, Loader2, Send, Trash2, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";

type ReplyStatus = "brouillon" | "poste" | "repondu";
type Reply = {
  url: string;
  titre: string;
  company: string;
  message: string;
  status: ReplyStatus;
  createdAt: string;
  postedAt?: string;
};

const RELANCE_APRES_JOURS = 7;

function daysSince(iso?: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function StatusPill({ reply }: { reply: Reply }) {
  const overdue = reply.status === "poste" && (daysSince(reply.postedAt) ?? 0) >= RELANCE_APRES_JOURS;
  const map: Record<ReplyStatus, { label: string; cls: string }> = {
    brouillon: { label: "À valider", cls: "bg-amber-500/15 text-amber-600" },
    poste: { label: "Posté", cls: "bg-brand-soft text-brand" },
    repondu: { label: "Répondu", cls: "bg-emerald-500/15 text-emerald-600" },
  };
  if (overdue) return <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-600">À relancer</span>;
  const s = map[reply.status];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", s.cls)}>{s.label}</span>;
}

export function ReponsesView() {
  const [replies, setReplies] = useState<Reply[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/n8n-replies", { cache: "no-store" });
      const j = (await r.json()) as { replies?: Reply[] };
      setReplies(Array.isArray(j.replies) ? j.replies : []);
    } catch {
      setReplies([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(url: string, action: string, extra?: Record<string, string>) {
    setBusy(url + action);
    try {
      await fetch("/api/n8n-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, url, ...extra }),
      });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function copy(reply: Reply) {
    try {
      await navigator.clipboard.writeText(reply.message);
      setCopied(reply.url);
      setTimeout(() => setCopied((c) => (c === reply.url ? null : c)), 1500);
    } catch {
      /* clipboard indisponible */
    }
  }

  if (replies === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-4 animate-spin" /> Chargement…
      </div>
    );
  }

  if (replies.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface/30 px-6 py-10 text-center text-sm text-muted">
        Aucune réponse pour l'instant. Ouvrez une offre du forum n8n dans le pipeline et cliquez{" "}
        <span className="font-medium text-foreground">« Réponse »</span> pour générer un brouillon — il apparaîtra ici.
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {replies.map((reply) => {
        const posted = daysSince(reply.postedAt);
        return (
          <li key={reply.url} className="rounded-xl border border-border bg-surface/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <a
                  href={reply.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-foreground transition-colors hover:text-brand hover:underline"
                >
                  {reply.titre || reply.url}
                  <ExternalLink className="size-3.5 shrink-0 text-faint" />
                </a>
                {reply.company && <p className="mt-0.5 text-xs text-muted">{reply.company}</p>}
              </div>
              <StatusPill reply={reply} />
            </div>

            <p className="mt-3 whitespace-pre-wrap rounded-lg bg-surface/50 p-3 text-[13px] leading-relaxed text-foreground">
              {reply.message}
            </p>

            {reply.status === "poste" && posted != null && (
              <p className="mt-1.5 flex items-center gap-1 text-[11px] text-faint">
                <Clock className="size-3" /> Posté il y a {posted} j{posted >= RELANCE_APRES_JOURS ? " — pensez à relancer" : ""}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => copy(reply)}
                className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-brand-foreground transition hover:brightness-110"
              >
                {copied === reply.url ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied === reply.url ? "Copié" : "Copier"}
              </button>

              {reply.status === "brouillon" && (
                <button
                  type="button"
                  onClick={() => mutate(reply.url, "status", { status: "poste" })}
                  disabled={busy === reply.url + "status"}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-brand/40 hover:text-brand disabled:opacity-60"
                >
                  <Send className="size-3.5" /> Marquer posté
                </button>
              )}

              {reply.status === "poste" && (
                <>
                  <button
                    type="button"
                    onClick={() => mutate(reply.url, "status", { status: "repondu" })}
                    disabled={busy === reply.url + "status"}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:border-brand/40 hover:text-brand disabled:opacity-60"
                  >
                    <Check className="size-3.5" /> Répondu
                  </button>
                  <button
                    type="button"
                    onClick={() => mutate(reply.url, "status", { status: "brouillon" })}
                    disabled={busy === reply.url + "status"}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted transition hover:text-foreground disabled:opacity-60"
                  >
                    <Undo2 className="size-3.5" /> Pas encore posté
                  </button>
                </>
              )}

              <button
                type="button"
                onClick={() => mutate(reply.url, "delete")}
                disabled={busy === reply.url + "delete"}
                title="Supprimer"
                className="ml-auto inline-flex items-center justify-center rounded-md p-1.5 text-faint transition hover:text-red-600 disabled:opacity-60"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
