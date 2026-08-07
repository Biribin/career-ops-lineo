"use client";

import { useCallback, useEffect, useState } from "react";
import { Hand, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { LancerRechercheBouton } from "@/components/lancer-recherche-bouton";

// Les offres rapportées par le workflow n8n « 1. Decouverte des offres », avec
// le bouton qui le déclenche.
//
// À NE PAS CONFONDRE AVEC « À valider » : ici ce sont des OFFRES à choisir
// (sortie du workflow 1). La page « À valider » liste des CANDIDATURES déjà
// rédigées qui attendent le feu vert avant envoi (sortie du workflow 2). Deux
// files distinctes, deux moments différents.

type Offre = {
  jobId: string;
  title?: string;
  company?: string;
  url?: string;
  location?: string;
  whyMatch?: string;
  score?: number | null;
  statut?: string;
  vu_le?: string;
};

export function OffresDecouvertes() {
  const [offres, setOffres] = useState<Offre[]>([]);
  const [chargement, setChargement] = useState(true);
  // jobId en cours de traitement, et le dernier message (succès ou échec).
  const [enCours, setEnCours] = useState<string | null>(null);
  const [avis, setAvis] = useState<{ ton: "ok" | "erreur"; texte: string } | null>(null);

  const charger = useCallback(() => {
    setChargement(true);
    fetch("/api/offers")
      .then((r) => r.json())
      .then((j: { offres?: Offre[] }) => setOffres(Array.isArray(j.offres) ? j.offres : []))
      .catch(() => setOffres([]))
      .finally(() => setChargement(false));
  }, []);

  useEffect(() => {
    charger();
  }, [charger]);

  // On ne retire la carte QU'APRÈS la réponse du serveur. Un retrait optimiste
  // ferait disparaître une offre dont la génération a échoué : elle serait
  // perdue de vue alors que rien n'a été rédigé.
  const decider = useCallback(async (jobId: string, action: "generer" | "ecarter" | "postuler", offre?: Offre) => {
    setEnCours(jobId);
    setAvis(null);
    try {
      // « Postulé à la main » : la ligne du tracker D'ABORD. Si elle échoue,
      // l'offre reste affichée — mieux vaut la revoir que la perdre sans
      // qu'elle soit suivie nulle part. C'est cette ligne qui permettra
      // ensuite d'enregistrer la réponse, l'entretien ou le refus.
      if (action === "postuler") {
        const t = await fetch("/api/tracker/set-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entreprise: offre?.company ?? "",
            role: offre?.title ?? "",
            statut: "Applied",
            creer: true,
            note: `Postulé à la main le ${new Date().toISOString().slice(0, 10)}${offre?.url ? ` — ${offre.url}` : ""}`,
          }),
        });
        const tj = (await t.json()) as { ok?: boolean; error?: string; num?: number; relance?: { prochaine?: string } };
        if (!t.ok || !tj.ok) {
          setAvis({ ton: "erreur", texte: tj.error || `le tracker a refusé (${t.status})` });
          return;
        }
        setAvis({
          ton: "ok",
          texte: `suivie sous le n° ${tj.num ?? "?"}${tj.relance?.prochaine ? ` — relance prévue le ${tj.relance.prochaine}` : ""}`,
        });
      }

      const rep = await fetch("/api/offers/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, action }),
      });
      const j = (await rep.json()) as { ok?: boolean; error?: string; message?: string; avertissement?: string };
      if (!rep.ok || !j.ok) {
        setAvis({ ton: "erreur", texte: j.error || `échec (${rep.status})` });
        return;
      }
      setOffres((liste) => liste.filter((o) => o.jobId !== jobId));
      // Pour « postuler », l'avis a déjà été posé plus haut (numéro de suivi et
      // date de relance) : on ne l'écrase pas par un message plus pauvre.
      if (action !== "postuler") {
        setAvis({
          ton: "ok",
          texte: j.avertissement || j.message || "offre écartée — elle ne reviendra pas",
        });
      }
    } catch (e) {
      setAvis({ ton: "erreur", texte: e instanceof Error ? e.message : "appel impossible" });
    } finally {
      setEnCours(null);
    }
  }, []);

  // SOUS-TABLEAU de l'onglet « À trier », plus une section de page : d'où le h3
  // et l'absence de conteneur centré (le parent s'en charge). Avoir deux files
  // de triage a l'ecran, l'une sous l'autre, donnait l'impression de deux
  // applications differentes.
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
        <div>
          <h3 className="text-sm font-medium text-foreground">
            France&nbsp;Travail <span className="text-faint">· via le workflow n8n</span>{" "}
            <span className="tabular-nums text-faint">{offres.length}</span>
          </h3>
          <p className="mt-1 text-sm text-muted">
            Cherchées avec les mots-clés de <code>portals.yml</code> puis triées. Trois issues&nbsp;:{" "}
            <strong>Générer</strong> rédige lettre et CV, puis dépose la candidature dans «&nbsp;À
            valider&nbsp;»&nbsp;; <strong>J’ai postulé à la main</strong> crée la ligne de suivi pour une
            candidature envoyée ailleurs&nbsp;; <strong>Écarter</strong> la retire pour de bon — elle ne
            reviendra pas, même si une prochaine tournée la retrouve.
          </p>
        </div>
        <button
          onClick={charger}
          disabled={chargement}
          className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          {chargement ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          Rafraîchir
        </button>
      </div>

      <div className="mt-4">
        {/* Après un lancement, la tournée dure quelques minutes : on ne recharge
            donc pas tout de suite, c'est le bouton Rafraîchir qui sert. */}
        <LancerRechercheBouton />
      </div>

      {avis && (
        <p
          className={`mt-3 rounded-xl border p-3 text-sm ${
            avis.ton === "ok"
              ? "border-brand/30 bg-brand/10 text-foreground"
              : "border-red-500/40 bg-red-500/10 text-foreground"
          }`}
        >
          {avis.texte}
        </p>
      )}

      {!chargement && offres.length === 0 && (
        <p className="mt-4 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Aucune offre pour l’instant. Clique sur «&nbsp;Lancer la recherche&nbsp;», puis sur
          «&nbsp;Rafraîchir&nbsp;» dans quelques minutes.
        </p>
      )}

      {offres.length > 0 && (
        <ul className="mt-4 space-y-3">
          {offres.map((o) => (
            <li key={o.jobId} className="rounded-xl border border-border bg-surface/30 p-4">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {typeof o.score === "number" && (
                  <span className="rounded-full bg-brand/15 px-2 py-0.5 text-xs font-medium text-brand">
                    {o.score}
                  </span>
                )}
                <span className="font-medium text-foreground">{o.title || "poste non précisé"}</span>
                <span className="text-sm text-muted">
                  {o.company || "entreprise non précisée"}
                  {o.location ? ` · ${o.location}` : ""}
                </span>
              </div>
              {o.whyMatch && <p className="mt-2 text-sm text-muted">{o.whyMatch}</p>}

              {/* Trois affordances, pas une de plus : lire l'annonce, lancer la
                  rédaction, ou écarter. Toute autre décision se prend ailleurs —
                  la fiche rédigée part dans « À valider ». */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => decider(o.jobId, "generer")}
                  disabled={enCours !== null}
                  className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {enCours === o.jobId ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  Générer la candidature
                </button>
                <button
                  onClick={() => decider(o.jobId, "postuler", o)}
                  disabled={enCours !== null}
                  title="Tu as postulé toi-même (France Travail, site de l'entreprise…). Crée la ligne de suivi pour pouvoir enregistrer la réponse ensuite."
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <Hand className="size-3.5" />
                  J’ai postulé à la main
                </button>
                <button
                  onClick={() => decider(o.jobId, "ecarter")}
                  disabled={enCours !== null}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <X className="size-3.5" />
                  Écarter
                </button>
                {o.url && (
                  <a
                    href={o.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-brand hover:underline"
                  >
                    Voir l’offre
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
