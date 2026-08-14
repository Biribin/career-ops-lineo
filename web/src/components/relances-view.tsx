"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ClipboardList, Copy, Loader2, Mail, PenLine, RefreshCw, Send } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { CADENCE_DEFAULTS, type CadenceEntry, daysHeatClass } from "@/lib/followups";
import { cn } from "@/lib/cn";

// La liste des relances dues, telle que n8n la voit. Cette page lit le MÊME
// contrat que lui (GET /api/followups → `due`), pas une vue parallèle : ce que
// Linéo a sous les yeux est exactement ce que le workflow va traiter.
//
// Deux gestes par carte, dans l'ordre où on les fait : « Rédiger la relance »
// (POST /api/followup-draft, le même rédacteur que le workflow n8n) puis
// « J'ai envoyé la relance » (POST /api/followups/log, le même journal que le
// tracker). Aucune des deux logiques n'est réécrite ici.
//
// La CADENCE reste au moteur : ce que cette page n'a toujours pas le droit de
// faire, c'est décider s'il faut relancer, ou avancer une échéance autrement
// qu'en journalisant une relance réellement envoyée. Épingler une date ou
// corriger l'historique vit dans /followups.

type Relance = {
  id: string;
  entreprise: string;
  poste: string;
  courriel_contact: string | null;
  jours_depuis_envoi: number;
};

type Brouillon = { objet: string; corps: string };

type Reponse = {
  available: boolean;
  due: Relance[];
  error: string | null;
  /** Entrées complètes du moteur, indexées par `num` — sert à dater et numéroter
   *  la relance dans le prompt. Le contrat `due` reste la source de la LISTE. */
  contexte: Record<string, CadenceEntry>;
  relanceMax: number;
};

/** Le message d'erreur d'une route, quelle que soit sa convention : les routes
 *  LLM répondent `{error:{message}}` (forme OpenAI), les autres `{error:"…"}`. */
async function messageErreur(res: Response, defaut: string): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: string | { message?: string } } | null;
  const e = j?.error;
  if (typeof e === "string" && e.trim()) return e;
  if (e && typeof e === "object" && typeof e.message === "string" && e.message.trim()) return e.message;
  return defaut;
}

export function RelancesView() {
  const [res, setRes] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(true);
  // Confirmation qui SURVIT au rechargement : une fois la relance journalisée,
  // la cadence avance et la carte disparaît de la liste — sans ce bandeau, le
  // seul retour visible serait la disparition, qui se lit comme un bug.
  const [confirmation, setConfirmation] = useState<{ entreprise: string; date: string } | null>(null);

  const charger = useCallback(() => {
    setChargement(true);
    fetch("/api/followups?full=1")
      .then((r) => r.json())
      .then((j) => {
        const entries: CadenceEntry[] = Array.isArray(j?.entries) ? j.entries : [];
        const contexte: Record<string, CadenceEntry> = {};
        for (const e of entries) contexte[String(e.num)] = e;
        const max = Number(j?.cadenceConfig?.applied_max_followups);
        setRes({
          available: Boolean(j?.available),
          due: Array.isArray(j?.due) ? j.due : [],
          error: typeof j?.error === "string" ? j.error : null,
          contexte,
          relanceMax: Number.isFinite(max) && max > 0 ? max : CADENCE_DEFAULTS.applied_max_followups,
        });
      })
      .catch(() => setRes({ available: false, due: [], error: null, contexte: {}, relanceMax: CADENCE_DEFAULTS.applied_max_followups }))
      .finally(() => setChargement(false));
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  const due = useMemo(() => res?.due ?? [], [res]);

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
          Le tracker complet
        </a>
      </div>

      {confirmation && (
        <p className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="text-muted">
            Relance enregistrée pour <span className="text-foreground">{confirmation.entreprise}</span> le{" "}
            <span className="tabular-nums text-foreground">{confirmation.date}</span>. La prochaine échéance repart de
            cette date ;{" "}
            <a href="/followups" className="text-brand hover:underline">
              l&apos;historique est dans le tracker
            </a>
            .
          </span>
        </p>
      )}

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
          <Carte
            key={r.id}
            relance={r}
            contexte={res?.contexte[r.id]}
            relanceMax={res?.relanceMax ?? CADENCE_DEFAULTS.applied_max_followups}
            onJournalisee={(date) => {
              setConfirmation({ entreprise: r.entreprise || `candidature #${r.id}`, date });
              charger();
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Carte({
  relance,
  contexte,
  relanceMax,
  onJournalisee,
}: {
  relance: Relance;
  contexte: CadenceEntry | undefined;
  relanceMax: number;
  onJournalisee: (date: string) => void;
}) {
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [redaction, setRedaction] = useState(false);
  const [envoiJournal, setEnvoiJournal] = useState(false);
  const [journalisee, setJournalisee] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [copie, setCopie] = useState(false);

  const jours = relance.jours_depuis_envoi;
  const rang = (contexte?.followupCount ?? 0) + 1;

  const rediger = async () => {
    setRedaction(true);
    setErreur(null);
    try {
      const res = await fetch("/api/followup-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          relance: {
            entreprise: relance.entreprise,
            poste: relance.poste,
            joursDepuisEnvoi: jours,
            envoyeeLe: contexte?.appliedDate ?? "",
            rang,
            relanceMax,
          },
        }),
      });
      if (!res.ok) {
        setErreur(await messageErreur(res, `La rédaction a échoué (HTTP ${res.status}).`));
        return;
      }
      const j = (await res.json()) as Brouillon;
      setBrouillon({ objet: String(j.objet ?? ""), corps: String(j.corps ?? "") });
    } catch {
      setErreur("La rédaction a échoué : le modèle n'a pas répondu.");
    } finally {
      setRedaction(false);
    }
  };

  // Journaliser, c'est écrire dans data/follow-ups.md — le geste qui fait
  // avancer la cadence. Un échec doit rester VISIBLE (pas de faux « c'est
  // fait ») : sinon la relance sort de la liste sans avoir été enregistrée et
  // revient au prochain calcul, ou pire, n'y revient pas.
  const journaliser = async () => {
    setEnvoiJournal(true);
    setErreur(null);
    try {
      const res = await fetch("/api/followups/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appNum: relance.id,
          company: relance.entreprise,
          role: relance.poste,
          // Valeurs canoniques persistées (jamais traduites) : par mail si on a
          // une adresse au dossier, sinon on ne sait pas par quel canal la
          // relance est partie — « Autre » plutôt qu'un canal inventé.
          channel: relance.courriel_contact ? "Email" : "Other",
          contact: relance.courriel_contact ?? "",
          notes: brouillon ? `Relance ${rang}/${relanceMax} : ${brouillon.objet}` : `Relance ${rang}/${relanceMax}`,
        }),
      });
      if (!res.ok) {
        setErreur(await messageErreur(res, `L'enregistrement a échoué (HTTP ${res.status}).`));
        return;
      }
      const j = (await res.json()) as { date?: string };
      const date = String(j.date ?? "");
      setJournalisee(date);
      onJournalisee(date);
    } catch {
      setErreur("L'enregistrement a échoué : rien n'a été écrit dans le journal.");
    } finally {
      setEnvoiJournal(false);
    }
  };

  const copier = async () => {
    if (!brouillon) return;
    try {
      await navigator.clipboard.writeText(`${brouillon.objet}\n\n${brouillon.corps}`);
      setCopie(true);
      setTimeout(() => setCopie(false), 1500);
    } catch {
      /* presse-papiers indisponible — le texte reste sélectionnable */
    }
  };

  const mailto = brouillon && relance.courriel_contact
    ? `mailto:${relance.courriel_contact}?subject=${encodeURIComponent(brouillon.objet)}&body=${encodeURIComponent(brouillon.corps)}`
    : null;

  return (
    <div className="rounded-2xl border border-border bg-surface/40 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <CompanyLogo name={relance.entreprise || "?"} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{relance.poste || "poste inconnu"}</p>
          <p className="truncate text-xs text-muted">
            {relance.entreprise || "entreprise inconnue"}
            <span className="text-faint">
              {" "}
              · candidature #{relance.id} · relance {rang} sur {relanceMax}
            </span>
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
        <span className={cn("shrink-0 text-xs tabular-nums", daysHeatClass(jours))}>{jours} j depuis l&apos;envoi</span>
      </div>

      {brouillon && (
        <div className="mt-3 rounded-xl border border-border bg-surface px-3.5 py-3">
          <p className="text-xs uppercase tracking-wide text-faint">Objet</p>
          <p className="mt-0.5 text-sm font-medium">{brouillon.objet}</p>
          <p className="mt-3 text-xs uppercase tracking-wide text-faint">Message</p>
          <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted">{brouillon.corps}</p>
          <p className="mt-2.5 text-[11px] text-faint">
            Brouillon : relisez-le avant l&apos;envoi. Le pied de message (téléphone, courriel) n&apos;y est pas.
          </p>
        </div>
      )}

      {erreur && <p className="mt-3 text-xs text-red-500">{erreur}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={rediger}
          disabled={redaction || envoiJournal}
          className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50 max-sm:min-h-[40px]"
        >
          {redaction ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}
          {brouillon ? "Réécrire la relance" : "Rédiger la relance"}
        </button>

        {brouillon && (
          <button
            type="button"
            onClick={copier}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[40px]"
          >
            {copie ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            {copie ? "Copié" : "Copier"}
          </button>
        )}

        {mailto && (
          <a
            href={mailto}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[40px]"
          >
            <Mail className="size-3.5" />
            Ouvrir dans le client mail
          </a>
        )}

        {/* Toujours disponible, brouillon ou pas : une relance faite à la main
            (portail, LinkedIn, téléphone) doit pouvoir être enregistrée. */}
        <button
          type="button"
          onClick={journaliser}
          disabled={envoiJournal || journalisee !== null}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[40px]"
        >
          {envoiJournal ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : journalisee ? (
            <Check className="size-3.5" />
          ) : (
            <Send className="size-3.5" />
          )}
          {journalisee ? `Enregistrée le ${journalisee}` : "J'ai envoyé la relance"}
        </button>
      </div>
    </div>
  );
}
