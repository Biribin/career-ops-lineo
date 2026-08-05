import Link from "next/link";
import { AlertTriangle, BarChart3, Clock, Send, ThumbsDown } from "lucide-react";
import { lireStats } from "@/lib/stats-server";
import { chiffresCles, entonnoir, repartitionStatuts, sourcesManquantes } from "@/lib/stats-view.mjs";

export const dynamic = "force-dynamic"; // les chiffres bougent à chaque candidature

// Les statistiques du pipeline, calculées par stats.mjs — le MÊME agrégateur que
// `node stats.mjs --summary` au terminal. La page ne recalcule rien : elle
// projette (@/lib/stats-view.mjs) et met en forme.
//
// Pourquoi une page distincte de /analytics : /analytics dessine des
// RÉPARTITIONS (scores, entreprises les plus sollicitées) à partir du tracker lu
// côté web ; ici on affiche les CHIFFRES DE RÉFÉRENCE du moteur, ceux qu'on peut
// citer sans risquer de contredire le CLI. Le cœur pousse d'ailleurs dans ce sens
// (stats.mjs : « dashboard/web consuming this JSON instead of keeping independent
// copies »).

export default async function StatsPage() {
  const { stats, error } = await lireStats();
  const cles = chiffresCles(stats);
  const etapes = entonnoir(stats);
  const statuts = repartitionStatuts(stats);
  const manquant = sourcesManquantes(stats);

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-display text-2xl tracking-tight text-landing">Statistiques</h1>
      <p className="mt-1 text-sm text-muted">
        Calculées par <code className="text-foreground">stats.mjs</code>, le même moteur que la ligne de commande.
        {cles.genereLe && <> Arrêtées au {cles.genereLe}.</>}
      </p>

      {error && (
        <p className="mt-5 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="text-muted">
            Le moteur de statistiques n&apos;a pas répondu&nbsp;:{" "}
            <span className="text-foreground">{error}</span> Les chiffres ci-dessous sont donc vides — ce n&apos;est pas
            un pipeline vide.
          </span>
        </p>
      )}

      {/* Le cas de loin le plus fréquent au démarrage : aucun tracker. Le dire
          explicitement, plutôt que d'afficher quatre zéros qui ressembleraient à
          un système qui tourne pour rien. */}
      {!error && !cles.aDesDonnees && (
        <p className="mt-5 rounded-xl border border-dashed border-border bg-surface/30 p-4 text-sm text-muted">
          Aucune candidature enregistrée pour l&apos;instant : le tracker{" "}
          <code className="text-foreground">data/applications.md</code> n&apos;existe pas encore. Il se crée à la
          première candidature envoyée. Les offres repérées, elles, sont dans{" "}
          <Link href="/pipeline" className="text-brand hover:underline">
            Candidatures
          </Link>
          .
        </p>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Chiffre
          icon={Send}
          valeur={cles.envoyees}
          libelle="envoyées"
          aide="candidatures parties, refus compris"
        />
        <Chiffre
          icon={Clock}
          valeur={cles.enAttente}
          libelle="en attente"
          aide={
            cles.enAttenteFroides && cles.enAttenteFroides > 0
              ? `${cles.enAttenteFroides} sans suite malgré les relances`
              : "réponse encore plausible"
          }
        />
        <Chiffre icon={ThumbsDown} valeur={cles.refus} libelle="refus" aide="réponses négatives reçues" />
        <Chiffre
          icon={BarChart3}
          valeur={cles.tauxReponse === null ? null : `${cles.tauxReponse} %`}
          libelle="taux de réponse"
          // Sous 10 envois un pourcentage est du bruit : stats.mjs le signale, on
          // le répète plutôt que d'afficher un chiffre qui inspire une décision.
          aide={
            cles.tauxReponse === null
              ? "rien d'envoyé, donc rien à mesurer"
              : cles.echantillonFaible
                ? "échantillon faible — indicatif"
                : `${cles.reponses ?? 0} réponses sur ${cles.envoyees ?? 0} envois`
          }
        />
      </div>

      {etapes.length > 0 && cles.envoyees ? (
        <Section titre="Entonnoir">
          <p className="mb-4 text-xs text-faint">
            Cumulé : chaque étape compte les candidatures qui l&apos;ont atteinte ou dépassée. Les étapes du milieu sont
            des minorants — un refus après entretien ne se distingue pas d&apos;un refus sans réponse.
          </p>
          {etapes.map((e) => (
            <Barre key={e.cle} libelle={e.libelle} valeur={e.valeur} part={e.part} />
          ))}
        </Section>
      ) : null}

      {statuts.length > 0 && (
        <Section titre="Par statut">
          {statuts.map((s) => (
            <Barre
              key={s.cle}
              libelle={s.libelle}
              valeur={s.valeur}
              part={cles.envoyees && cles.envoyees > 0 ? Math.round((s.valeur / cles.envoyees) * 100) : 0}
              sansPart
            />
          ))}
        </Section>
      )}

      {manquant.length > 0 && (
        <Section titre="Données pas encore là">
          <ul className="space-y-1.5 text-sm text-muted">
            {manquant.map((m) => (
              <li key={m} className="flex items-start gap-2">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-faint" />
                <code className="text-xs">{m}</code>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-faint">
            Ces fichiers se créent tout seuls quand l&apos;étape correspondante tourne pour la première fois. Rien à
            réparer.
          </p>
        </Section>
      )}

      <p className="mt-10 text-xs text-faint">
        Les répartitions par score et par entreprise sont sur{" "}
        <Link href="/analytics" className="text-muted hover:text-brand">
          Répartitions
        </Link>
        .
      </p>
    </div>
  );
}

/** Un chiffre de tête. `null` s'affiche « — » : pas de donnée n'est pas zéro. */
function Chiffre({
  icon: Icon,
  valeur,
  libelle,
  aide,
}: {
  icon: React.ComponentType<{ className?: string }>;
  valeur: number | string | null;
  libelle: string;
  aide: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface/50 p-4">
      <Icon className="size-4 text-brand" />
      <div className="mt-2 text-3xl font-semibold tabular-nums">{valeur === null ? "—" : valeur}</div>
      <div className="mt-1 text-xs text-foreground">{libelle}</div>
      <div className="text-xs text-faint">{aide}</div>
    </div>
  );
}

function Section({ titre, children }: { titre: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">{titre}</h2>
      <div className="mt-4 space-y-2.5">{children}</div>
    </section>
  );
}

function Barre({
  libelle,
  valeur,
  part,
  sansPart = false,
}: {
  libelle: string;
  valeur: number;
  part: number;
  sansPart?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-48 shrink-0 truncate text-sm text-muted">{libelle}</div>
      <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-surface">
        <div
          className="h-full rounded-md bg-gradient-to-r from-foreground/25 to-foreground/10"
          style={{ width: `${Math.min(100, Math.max(part, valeur > 0 ? 4 : 0))}%` }}
        />
      </div>
      <div className="w-20 shrink-0 text-right text-sm tabular-nums">
        {valeur}
        {!sansPart && <span className="ml-1 text-xs text-faint">{part}%</span>}
      </div>
    </div>
  );
}
