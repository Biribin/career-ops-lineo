"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, ExternalLink, Eye, FileText, GraduationCap, Loader2, Mail, PenLine, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { CompanyLogo } from "@/components/company-logo";
import { cn } from "@/lib/cn";
import { formationsPourFiche } from "@/lib/formations.mjs";

type Fiche = {
  id: string;
  statut: string;
  cree_le?: string;
  revision?: number;
  poste?: string;
  entreprise?: string;
  lieu?: string | null;
  url_offre?: string;
  courriel_contact?: string;
  objet_mail?: string;
  salutation?: string;
  apercu_lettre?: string;
  arguments_cles?: string[] | string;
  pourquoi_ca_matche?: string;
  cv_url?: string;
  lettre_url?: string;
  branche_github?: string;
  decision_url?: string;
  decidable: boolean;
  retouches: number;
  derniereConsigne?: string;
};

type Reponse = {
  fiches: Fiche[];
  repo: { racine: string; present: boolean; inbox: string };
  /** « local » = clone du repo cv ; « github » = lecture par l'API contents. */
  mode?: "local" | "github";
  origine?: string;
  erreur?: string | null;
  tronquees?: number;
  illisibles?: number;
  pull: { ok: boolean; sortie: string } | null;
};

type Decision = "valider" | "retoucher_lettre" | "retoucher_cv" | "refuser";

const BESOIN_TEXTE: Record<Decision, "consigne" | "raison" | null> = {
  valider: null,
  retoucher_lettre: "consigne",
  retoucher_cv: "consigne",
  refuser: "raison",
};

const LIBELLE: Record<Decision, string> = {
  valider: "Valider",
  retoucher_lettre: "Retoucher la lettre",
  retoucher_cv: "Retoucher le CV",
  refuser: "Refuser",
};

export function AValiderView() {
  const [res, setRes] = useState<Reponse | null>(null);
  const [chargement, setChargement] = useState(true);
  const [sync, setSync] = useState(false);

  const charger = useCallback((avecSync: boolean) => {
    if (avecSync) setSync(true);
    else setChargement(true);
    fetch(`/api/decisions${avecSync ? "?sync=1" : ""}`)
      .then((r) => r.json())
      .then(setRes)
      .catch(() => setRes({ fiches: [], repo: { racine: "?", present: false, inbox: "?" }, pull: null }))
      .finally(() => {
        setChargement(false);
        setSync(false);
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
          disabled={sync || chargement}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50 max-sm:min-h-[44px]"
        >
          {sync ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Récupérer les nouvelles candidatures
        </button>
        {sync && (
          <span className="text-xs text-faint">
            {res?.mode === "github" ? "lecture de l’inbox sur GitHub…" : "git pull sur le repo cv…"}
          </span>
        )}
        {!sync && res?.origine && <span className="text-xs text-faint">Source : {res.origine}</span>}
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <span className="text-muted">
          Chaque candidature ci-dessous <strong className="text-foreground">bloque une exécution n8n</strong> qui ne
          repartira que sur ta décision. Tant que tu ne cliques pas, aucun mail ne peut partir.
        </span>
      </p>

      {res?.pull && !res.pull.ok && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="font-medium text-amber-700 dark:text-amber-400">git pull a échoué</span>{" "}
          <span className="text-muted">— la liste peut être périmée.</span>
          <code className="mt-1 block whitespace-pre-wrap break-all text-xs text-faint">{res.pull.sortie}</code>
        </p>
      )}

      {res && !res.repo.present && res.mode !== "github" && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Le clone du repo <code className="text-foreground">cv</code> est introuvable à{" "}
          <code className="text-foreground">{res.repo.racine}</code>. C&apos;est là que n8n dépose les fiches. Définis{" "}
          <code className="text-foreground">CV_REPO_ROOT</code> si ton clone est ailleurs, ou{" "}
          <code className="text-foreground">CV_GITHUB_TOKEN</code> pour lire l’inbox directement sur GitHub (c’est
          le mode prévu quand career-ops tourne en conteneur, sans clone).
        </p>
      )}

      {res?.erreur && res.mode === "github" && (
        <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="font-medium text-amber-700 dark:text-amber-400">Lecture de l&apos;inbox impossible</span>{" "}
          <span className="text-muted">
            — la liste ci-dessous n&apos;est pas fiable, ne conclus pas qu&apos;il n&apos;y a rien à valider.
          </span>
          <code className="mt-1 block whitespace-pre-wrap break-all text-xs text-faint">{res.erreur}</code>
        </p>
      )}

      {res && (res.tronquees ?? 0) > 0 && (
        <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-muted">
          {res.tronquees} fiche(s) au-delà du plafond de lecture ne sont pas affichées ici.
        </p>
      )}

      {chargement && (
        <p className="mt-6 flex items-center gap-2 text-sm text-faint">
          <Loader2 className="size-4 animate-spin" /> Lecture des fiches…
        </p>
      )}

      {!chargement && res?.repo.present && fiches.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Aucune candidature en attente. Quand n8n en préparera une, elle apparaîtra ici après un clic sur
          «&nbsp;Récupérer&nbsp;».
        </p>
      )}

      <div className="mt-5 space-y-4">
        {fiches.map((f) => (
          <Carte key={f.id} fiche={f} onDecide={() => charger(false)} />
        ))}
      </div>
    </div>
  );
}

function Carte({ fiche, onDecide }: { fiche: Fiche; onDecide: () => void }) {
  const [ouvert, setOuvert] = useState<Decision | null>(null);
  const [texte, setTexte] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);

  const sansCourriel = !String(fiche.courriel_contact ?? "").trim();

  function choisir(d: Decision) {
    setErreur(null);
    setSucces(null);
    if (BESOIN_TEXTE[d]) {
      setOuvert(ouvert === d ? null : d);
      setTexte("");
      return;
    }
    envoyer(d, "");
  }

  async function envoyer(d: Decision, valeur: string) {
    setEnvoi(true);
    setErreur(null);
    try {
      const besoin = BESOIN_TEXTE[d];
      const rep = await fetch("/api/decisions/decide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: fiche.id,
          decision: d,
          consigne: besoin === "consigne" ? valeur : "",
          raison: besoin === "raison" ? valeur : "",
        }),
      });
      const j = (await rep.json()) as {
        ok?: boolean;
        error?: string;
        n8nError?: string | null;
        transmis?: boolean;
        closLocalement?: boolean;
        avertissement?: string;
        tracker?: { applique: boolean; erreur: string | null } | null;
        journalErreur?: string | null;
      };
      if (!rep.ok || !j.ok) {
        setErreur(j.error || j.n8nError || "la décision n'a pas pu être transmise à n8n");
        return;
      }
      const avertissements: string[] = [];
      // Un refus enregistré alors que n8n n'attendait plus : c'est un succès, mais
      // il ne faut PAS lui laisser dire « transmis à n8n », ce qui serait faux.
      if (j.avertissement) avertissements.push(j.avertissement);
      if (j.tracker && !j.tracker.applique && j.tracker.erreur) {
        avertissements.push(`tracker non mis à jour : ${j.tracker.erreur}`);
      }
      if (j.journalErreur) avertissements.push(`journal : ${j.journalErreur}`);
      setSucces(
        `${LIBELLE[d]} — ${j.closLocalement ? "enregistré ici" : "transmis à n8n"}.` +
          (avertissements.length ? ` ⚠️ ${avertissements.join(" · ")}` : ""),
      );
      setOuvert(null);
      setTexte("");
      // Laisse le message lisible avant de recharger la liste.
      setTimeout(onDecide, 1500);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "requête impossible");
    } finally {
      setEnvoi(false);
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
            {fiche.cree_le ? ` · préparée le ${fiche.cree_le.slice(0, 10)}` : ""}
          </p>
        </div>
        {fiche.retouches > 0 && (
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold bg-surface-hover text-muted">
            {fiche.retouches} retouche{fiche.retouches > 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="space-y-1.5 px-4 py-3 text-xs">
        <p className={cn("flex items-center gap-1.5", sansCourriel ? "text-amber-700 dark:text-amber-400" : "text-muted")}>
          <Mail className="size-3.5 shrink-0" />
          {sansCourriel ? (
            <span>
              Aucun courriel de recruteur — <strong>Valider</strong> t’enverra tout prêt à coller pour un dépôt
              manuel sur le portail. Elle t’attendra ensuite dans{" "}
              <Link href="/a-deposer" className="font-medium text-brand hover:underline">
                À déposer
              </Link>
              , où le clic sur «&nbsp;c’est déposé&nbsp;» l’inscrit au tracker et arme la relance.
            </span>
          ) : (
            <span>
              Si tu valides, le mail part à <code className="text-foreground">{fiche.courriel_contact}</code>
            </span>
          )}
        </p>
        {fiche.objet_mail && (
          <p className="truncate text-muted">
            <span className="text-faint">Objet&nbsp;:</span> {fiche.objet_mail}
          </p>
        )}
        {fiche.url_offre && (
          <a
            href={fiche.url_offre}
            target="_blank"
            rel="noreferrer"
            className="block truncate text-brand hover:underline"
          >
            {fiche.url_offre}
          </a>
        )}
        {fiche.branche_github && (
          <p className="truncate text-faint">
            <FileText className="mr-1 inline size-3" />
            <code>{fiche.branche_github}</code>
          </p>
        )}
        {fiche.derniereConsigne && (
          <p className="text-muted">
            <span className="text-faint">Dernière consigne&nbsp;:</span> {fiche.derniereConsigne}
          </p>
        )}
      </div>

      <Apercu fiche={fiche} />

      <Formations fiche={fiche} />

      {!fiche.decidable && (
        <p className="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface/60 px-3 py-2 text-xs text-muted">
          <Loader2 className="size-3.5 animate-spin" />
          Retouche en cours chez n8n (re-rendu des documents). Reclique sur «&nbsp;Récupérer&nbsp;» dans quelques
          minutes.
        </p>
      )}

      {fiche.decidable && (
        <div className="flex flex-wrap gap-2 px-4 pb-3">
          <Bouton d="valider" actif={ouvert} envoi={envoi} onClick={choisir} icone={CheckCircle2} principal />
          <Bouton d="retoucher_lettre" actif={ouvert} envoi={envoi} onClick={choisir} icone={PenLine} />
          <Bouton d="retoucher_cv" actif={ouvert} envoi={envoi} onClick={choisir} icone={FileText} />
          <Bouton d="refuser" actif={ouvert} envoi={envoi} onClick={choisir} icone={Trash2} danger />
        </div>
      )}

      {ouvert && (
        <div className="border-t border-border px-4 py-3">
          <label className="block text-xs font-medium text-muted" htmlFor={`t-${fiche.id}`}>
            {ouvert === "refuser"
              ? "Pourquoi tu refuses ? (alimente tes statistiques de refus)"
              : "Qu'est-ce qui doit changer ?"}
          </label>
          <textarea
            id={`t-${fiche.id}`}
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            rows={3}
            maxLength={500}
            autoFocus
            placeholder={
              ouvert === "refuser" ? "salaire non affiché" : "raccourcir le 2e paragraphe et insister sur n8n"
            }
            className="mt-1.5 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand/50"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => envoyer(ouvert, texte)}
              disabled={envoi || !texte.trim()}
              className="inline-flex items-center gap-2 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-50"
            >
              {envoi ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Confirmer «&nbsp;{LIBELLE[ouvert]}&nbsp;»
            </button>
            <button onClick={() => setOuvert(null)} className="text-xs text-muted hover:text-foreground">
              Annuler
            </button>
            <span className="ml-auto text-[10px] text-faint">{texte.length}/500</span>
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

function Apercu({ fiche }: { fiche: Fiche }) {
  const args = Array.isArray(fiche.arguments_cles)
    ? fiche.arguments_cles
    : String(fiche.arguments_cles ?? "")
        .split(/\n|(?:^|\s)[-•]\s/)
        .map((s) => s.trim())
        .filter(Boolean);
  const paragraphes = String(fiche.apercu_lettre ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const aLettre = paragraphes.length > 0;
  // Le telechargement passe par l'app, donc il suffit que la fiche reference une
  // branche. `cv_url` et `lettre_url` ne servent plus qu'a savoir si le rendu a
  // eu lieu : ce sont des liens `github.com/blob/…` inutilisables tels quels
  // (page et non fichier, depot prive, branche avec une barre oblique).
  const aDocs = Boolean(fiche.branche_github && (fiche.cv_url || fiche.lettre_url));
  const lienFichier = (type: "cv" | "lettre") =>
    `/api/candidature-fichier?id=${encodeURIComponent(String(fiche.id))}&type=${type}`;

  if (!aLettre && !aDocs && args.length === 0) return null;

  return (
    <div className="border-t border-border px-4 py-3">
      {aDocs && (
        <div className="mb-3 flex flex-wrap gap-2">
          {fiche.cv_url && (
            <a
              href={lienFichier("cv")}
              download
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[40px]"
            >
              <FileText className="size-3.5" /> Télécharger le CV <Download className="size-3" />
            </a>
          )}
          {fiche.lettre_url && (
            <a
              href={lienFichier("lettre")}
              download
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-brand/40 hover:text-brand max-sm:min-h-[40px]"
            >
              <Mail className="size-3.5" /> Télécharger la lettre <Download className="size-3" />
            </a>
          )}
        </div>
      )}

      {(aLettre || args.length > 0) && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground">
            <Eye className="size-3.5" />
            Voir ce qui sera envoyé
          </summary>
          <div className="mt-3 space-y-3 rounded-lg border border-border bg-surface/60 p-3 text-xs leading-relaxed">
            <p className="font-medium text-faint">Lettre de motivation</p>
            {fiche.salutation && <p className="text-muted">{fiche.salutation}</p>}
            {aLettre ? (
              paragraphes.map((p, i) => (
                <p key={i} className="text-foreground/90">
                  {p}
                </p>
              ))
            ) : (
              <p className="italic text-faint">
                Corps de la lettre indisponible pour cette candidature (préparée avant l&apos;aperçu complet).
                Relance une candidature pour voir la lettre entière.
              </p>
            )}
            {args.length > 0 && (
              <div className="border-t border-border pt-2">
                <p className="mb-1 text-faint">Arguments clés (résumé, ce n&apos;est pas la lettre)</p>
                <ul className="list-disc space-y-0.5 pl-4 text-muted">
                  {args.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

/**
 * Conseil de formation pour CETTE offre. Note interne : elle ne part nulle part.
 *
 * Depuis le 2026-08-11 les formations ne figurent plus sur aucun CV (décision de
 * Linéo, il n'en parle plus qu'à l'oral). Ce bloc est donc le seul endroit où le
 * sujet reste visible, et l'avertissement « n'apparaît sur aucun document envoyé »
 * est là pour qu'on ne le rebranche jamais dans un document candidat.
 */
function Formations({ fiche }: { fiche: Fiche }) {
  const { aFaire, dejaAcquis } = formationsPourFiche(fiche);
  if (aFaire.length === 0 && dejaAcquis.length === 0) return null;

  return (
    <div className="border-t border-border px-4 py-3">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground">
          <GraduationCap className="size-3.5" />
          {aFaire.length > 0 ? "À travailler pour ce poste" : "Rien à travailler pour ce poste"}
          {aFaire.length > 0 && (
            <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-semibold text-muted">
              {aFaire.length}
            </span>
          )}
        </summary>

        <div className="mt-3 space-y-3 rounded-lg border border-border bg-surface/60 p-3 text-xs leading-relaxed">
          <p className="text-faint">
            Note interne, pour toi seul. Elle <strong className="text-muted">n&apos;apparaît sur aucun document
            envoyé</strong> : les formations ne sont plus écrites sur le CV, elles se disent à l&apos;oral.
          </p>

          {aFaire.length > 0 && (
            <ol className="space-y-2">
              {aFaire.map((f, i) => (
                <li key={f.id} className="flex gap-2">
                  <span className="shrink-0 font-semibold text-faint">{i + 1}.</span>
                  <span>
                    <span className="text-foreground/90">{f.libelle}</span>
                    <span className="text-faint">
                      {" "}
                      — {f.org}, {f.effort}
                    </span>
                    <span className="mt-0.5 block text-faint">
                      l&apos;offre dit&nbsp;: {f.motifs.join(", ")}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}

          {dejaAcquis.length > 0 && (
            <div className="border-t border-border pt-2">
              <p className="mb-1 text-faint">
                Demandé par l&apos;offre, et tu l&apos;as déjà en production. À sortir à l&apos;oral, pas à
                travailler.
              </p>
              <ul className="list-disc space-y-1 pl-4">
                {dejaAcquis.map((f) => (
                  <li key={f.id} className="text-muted">
                    <span className="text-faint">{f.motifs.join(", ")}&nbsp;:</span> {f.preuve}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function Bouton({
  d,
  actif,
  envoi,
  onClick,
  icone: Icone,
  principal,
  danger,
}: {
  d: Decision;
  actif: Decision | null;
  envoi: boolean;
  onClick: (d: Decision) => void;
  icone: typeof CheckCircle2;
  principal?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={() => onClick(d)}
      disabled={envoi}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 max-sm:min-h-[40px]",
        principal
          ? "bg-brand text-brand-foreground hover:bg-brand-200"
          : danger
            ? "border border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400"
            : "border border-border text-muted hover:border-brand/40 hover:text-brand",
        actif === d && "ring-2 ring-brand/40",
      )}
    >
      <Icone className="size-3.5" />
      {LIBELLE[d]}
    </button>
  );
}
