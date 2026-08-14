"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  PackageCheck,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { useADeposer } from "@/components/a-deposer/a-deposer-provider";
import { cn } from "@/lib/cn";

// La file des candidatures validées que n8n n'a pas pu envoyer : pas d'adresse
// de recruteur dans l'annonce, donc dépôt à la main sur l'ATS (WTTJ, welcomekit,
// Taleez…). Cette page est le SEUL endroit où le dépôt peut être enregistré :
// sans le clic, la candidature n'entre jamais dans « Envoyées » et aucune
// relance n'est armée.
//
// L'écriture passe par /api/tracker/set-status — le point d'écriture sanctionné,
// qui amorce aussi la cadence de relance. Voir a-deposer.mjs pour la dérivation
// de la file (aucun état stocké : la ligne du tracker EST la preuve du dépôt).

type Fiche = {
  id: string;
  entreprise?: string;
  poste?: string;
  lieu?: string | null;
  url_offre?: string;
  objet_mail?: string;
  salutation?: string;
  apercu_lettre?: string;
  cv_url?: string;
  lettre_url?: string;
  branche_github?: string;
  valideeLe: string;
  numTracker: string | null;
  statutTracker: string | null;
};

type Reponse = {
  fiches: Fiche[];
  mode?: "local" | "github";
  origine?: string;
  erreur?: string | null;
  tronquees?: number;
  /** Panne de lecture du journal des décisions — pas « aucune décision prise ». */
  erreurJournal?: string | null;
  journalIllisibles?: number;
};

/**
 * La date du jour en heure LOCALE, au format `YYYY-MM-DD`.
 *
 * Pas `toISOString()` (qui rend l'heure UTC) : un dépôt fait à 00h30 à Paris
 * serait daté de la veille, et cette date n'est pas décorative — `followup-seed`
 * lit le préfixe « Applied <date> » de la note pour calculer l'échéance de
 * relance.
 */
function aujourdhui(): string {
  return new Date().toLocaleDateString("en-CA");
}

/** « validée il y a 3 jours » — ce qui rend l'oubli visible. */
function depuis(iso: string): string {
  const jours = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(jours) || jours < 0) return "";
  if (jours === 0) return "aujourd'hui";
  if (jours === 1) return "hier";
  return `il y a ${jours} jours`;
}

export function ADeposerView() {
  const [res, setRes] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(true);
  const [rafraichit, setRafraichit] = useState(false);

  const charger = useCallback((visible: boolean) => {
    if (visible) setRafraichit(true);
    fetch("/api/a-deposer")
      .then((r) => r.json())
      .then(setRes)
      .catch(() => setRes({ fiches: [], erreur: "lecture impossible" }))
      .finally(() => {
        setChargement(false);
        setRafraichit(false);
      });
  }, []);

  useEffect(() => {
    charger(false);
  }, [charger]);

  const fiches = res?.fiches ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => charger(true)}
          disabled={rafraichit || chargement}
          className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {rafraichit ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Rafraîchir
        </button>
        {res?.origine && <span className="text-xs text-faint">Source : {res.origine}</span>}
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
        <PackageCheck className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-muted">
          Ces candidatures sont <strong className="text-foreground">validées mais pas envoyées</strong> : l&apos;annonce
          ne donnait aucune adresse de recruteur, donc n8n t&apos;a envoyé le dossier au lieu de le poster. Tant que tu
          ne confirmes pas le dépôt, elles restent hors de «&nbsp;Envoyées&nbsp;» et{" "}
          <strong className="text-foreground">aucune relance n&apos;est programmée</strong>.
        </span>
      </p>

      {res?.erreur && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="font-medium text-amber-700 dark:text-amber-400">Lecture des fiches impossible</span>{" "}
          <span className="text-muted">
            — la liste ci-dessous n&apos;est pas fiable, ne conclus pas qu&apos;il n&apos;y a rien à déposer.
          </span>
          <code className="mt-1 block whitespace-pre-wrap break-all text-xs text-faint">{res.erreur}</code>
        </p>
      )}

      {res?.erreurJournal && (
        <p className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm">
          <span className="font-medium text-red-700 dark:text-red-400">
            Journal des décisions illisible
          </span>{" "}
          <span className="text-muted">
            — cette file se construit à partir de lui, donc elle est <strong className="text-foreground">vide par
            panne, pas par vérité</strong>. Ne conclus rien de ce qui s&apos;affiche ci-dessous.
          </span>
          <code className="mt-1 block whitespace-pre-wrap break-all text-xs text-faint">{res.erreurJournal}</code>
        </p>
      )}

      {res && (res.journalIllisibles ?? 0) > 0 && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted">
          {res.journalIllisibles} ligne(s) du journal des décisions n&apos;ont pas pu être relues. Une candidature
          validée peut donc manquer ici.
        </p>
      )}

      {res && (res.tronquees ?? 0) > 0 && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted">
          {res.tronquees} fiche(s) au-delà du plafond de lecture ne sont pas affichées ici.
        </p>
      )}

      {chargement && (
        <p className="mt-6 flex items-center gap-2 text-sm text-faint">
          <Loader2 className="size-4 animate-spin" /> Lecture des candidatures validées…
        </p>
      )}

      {/* « Rien à déposer » ne s'affiche que si les deux lectures ont réussi :
          sinon on affirmerait une file vide qu'on n'a pas pu constater. */}
      {!chargement && !res?.erreur && !res?.erreurJournal && fiches.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Rien à déposer. Chaque candidature validée a été soit postée par n8n, soit enregistrée ici.
        </p>
      )}

      <div className="mt-5 space-y-4">
        {fiches.map((f) => (
          <Carte key={f.id} fiche={f} onEnregistre={() => charger(false)} />
        ))}
      </div>
    </div>
  );
}

type Resultat = {
  ok?: boolean;
  error?: string;
  statut?: string;
  num?: number | null;
  creee?: boolean;
  relance?: { amorcee?: boolean; prochaine?: string | null; motif?: string; erreur?: string };
};

function Carte({ fiche, onEnregistre }: { fiche: Fiche; onEnregistre: () => void }) {
  // Le badge de la nav doit tomber en même temps que la carte, sinon il
  // contredirait la page qui vient de l'écrire. `true` = on court-circuite la
  // TTL du compteur.
  const { rafraichir } = useADeposer();
  const [envoi, setEnvoi] = useState<"depose" | "abandon" | null>(null);
  const [abandon, setAbandon] = useState(false);
  const [raison, setRaison] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  const lienFichier = (type: "cv" | "lettre") =>
    `/api/candidature-fichier?id=${encodeURIComponent(fiche.id)}&type=${type}`;

  /**
   * Écrit la ligne du tracker. `creer: true` est indispensable : une
   * candidature préparée par n8n n'a aucune ligne (les lignes naissent du flux
   * d'évaluation local), et sans elle la route rend 422.
   *
   * Le préfixe « Applied <date> » de la note n'est pas décoratif — followup-seed
   * le lit pour dater la cadence. Ne pas le retirer.
   */
  async function enregistrer(quoi: "depose" | "abandon") {
    setEnvoi(quoi);
    setErreur(null);
    setSucces(null);
    try {
      const ou = fiche.url_offre ? ` sur ${fiche.url_offre}` : "";
      const rep = await fetch("/api/tracker/set-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entreprise: fiche.entreprise ?? "",
          role: fiche.poste ?? "",
          creer: true,
          ...(quoi === "depose"
            ? {
                statut: "Applied",
                note: `Applied ${aujourdhui()}; deposee a la main${ou}`,
              }
            : {
                statut: "Discarded",
                // Même format que le refus (argsRefusTracker) : c'est ce que
                // analyze-patterns.mjs agrège pour dire quel motif revient.
                note: `DISCARD: ${raison.trim()}`,
              }),
        }),
      });
      const j = (await rep.json()) as Resultat;
      if (!rep.ok || !j.ok) {
        setErreur(j.error || `le tracker a refusé (${rep.status})`);
        return;
      }
      if (quoi === "abandon") {
        setSucces(`Abandon enregistré — ligne n° ${j.num ?? "?"}, statut Écartée.`);
      } else {
        const relance = j.relance?.prochaine
          ? `relance prévue le ${j.relance.prochaine}`
          : j.relance?.erreur
            ? `⚠️ cadence de relance non amorcée : ${j.relance.erreur}`
            : "aucune relance amorcée (déjà armée)";
        setSucces(`Dépôt enregistré — ligne n° ${j.num ?? "?"}, statut Envoyée, ${relance}.`);
      }
      setAbandon(false);
      setRaison("");
      rafraichir(true);
      // Laisse le message lisible avant que la carte disparaisse de la file.
      setTimeout(onEnregistre, 2200);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "requête impossible");
    } finally {
      setEnvoi(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface/40">
      <div className="flex flex-wrap items-start gap-3 border-b border-border px-4 py-3">
        <CompanyLogo name={fiche.entreprise ?? "?"} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{fiche.poste || "poste inconnu"}</p>
          <p className="truncate text-xs text-muted">
            {fiche.entreprise || "entreprise inconnue"}
            {fiche.lieu ? ` · ${fiche.lieu}` : ""}
            {` · validée ${depuis(fiche.valideeLe)}`}
          </p>
        </div>
        {fiche.numTracker && (
          <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-semibold text-muted">
            tracker n° {fiche.numTracker}
            {fiche.statutTracker ? ` · ${fiche.statutTracker}` : ""}
          </span>
        )}
      </div>

      <div className="space-y-2 px-4 py-3 text-xs">
        {fiche.url_offre && (
          <a
            href={fiche.url_offre}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 truncate text-brand hover:underline"
          >
            <ExternalLink className="size-3.5 shrink-0" />
            <span className="truncate">{fiche.url_offre}</span>
          </a>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {fiche.cv_url && (
            <a
              href={lienFichier("cv")}
              download
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[40px]"
            >
              <FileText className="size-3.5" /> CV <Download className="size-3" />
            </a>
          )}
          {fiche.lettre_url && (
            <a
              href={lienFichier("lettre")}
              download
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[40px]"
            >
              <Mail className="size-3.5" /> Lettre <Download className="size-3" />
            </a>
          )}
          {fiche.objet_mail && <BoutonCopier texte={fiche.objet_mail} libelle="Objet" />}
          {fiche.apercu_lettre && (
            <BoutonCopier
              texte={[fiche.salutation, fiche.apercu_lettre].filter(Boolean).join("\n\n")}
              libelle="Texte de la lettre"
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 px-4 pb-3">
        <button
          onClick={() => enregistrer("depose")}
          disabled={envoi !== null}
          className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[40px]"
        >
          {envoi === "depose" ? <Loader2 className="size-3.5 animate-spin" /> : <PackageCheck className="size-3.5" />}
          C&apos;est déposé
        </button>
        <button
          onClick={() => {
            setAbandon(!abandon);
            setErreur(null);
            setSucces(null);
          }}
          disabled={envoi !== null}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-red-500/40 px-3.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400 max-sm:min-h-[40px]",
            abandon && "ring-2 ring-red-500/30",
          )}
        >
          <Trash2 className="size-3.5" />
          Je ne dépose pas
        </button>
      </div>

      {abandon && (
        <div className="border-t border-border px-4 py-3">
          <label className="block text-xs font-medium text-muted" htmlFor={`r-${fiche.id}`}>
            Pourquoi tu ne déposes pas ? (alimente tes statistiques d&apos;abandon)
          </label>
          <textarea
            id={`r-${fiche.id}`}
            value={raison}
            onChange={(e) => setRaison(e.target.value)}
            rows={2}
            maxLength={300}
            autoFocus
            placeholder="formulaire ATS cassé"
            className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand/50"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => enregistrer("abandon")}
              disabled={envoi !== null || !raison.trim()}
              className="inline-flex items-center gap-2 rounded-full border border-red-500/40 px-3.5 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
            >
              {envoi === "abandon" ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Confirmer l&apos;abandon
            </button>
            <button onClick={() => setAbandon(false)} className="text-xs text-muted hover:text-foreground">
              Annuler
            </button>
            <span className="ml-auto text-[10px] text-faint">{raison.length}/300</span>
          </div>
        </div>
      )}

      {erreur && (
        <p className="flex items-start gap-2 border-t border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-600 dark:text-red-400" />
          <span className="text-muted">
            <strong className="text-red-700 dark:text-red-400">Rien n&apos;a bougé</strong> — {erreur}
          </span>
        </p>
      )}
      {succes && (
        <p className="border-t border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-400">
          {succes}
        </p>
      )}
    </div>
  );
}

/** Copie un texte dans le presse-papier — pour le coller dans le formulaire de l'ATS. */
function BoutonCopier({ texte, libelle }: { texte: string; libelle: string }) {
  const [copie, setCopie] = useState(false);

  async function copier() {
    try {
      await navigator.clipboard.writeText(texte);
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    } catch {
      // Contexte non sécurisé ou permission refusée : on ne fait pas de bruit.
    }
  }

  return (
    <button
      onClick={copier}
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[40px]"
    >
      {copie ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
      {copie ? "Copié" : libelle}
    </button>
  );
}
