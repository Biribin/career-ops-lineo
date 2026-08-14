import { RelancesView } from "@/components/relances-view";

export const dynamic = "force-dynamic"; // la cadence se recalcule à chaque requête

export default function RelancesPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8 md:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">Relances dues</h1>
      <p className="mt-1.5 text-sm text-muted">
        Les candidatures dont l&apos;échéance de relance est passée. C&apos;est la même liste que celle servie à n8n.
        Rédigez la relance, envoyez-la, puis enregistrez-la&nbsp;: la cadence repart de cette date.
      </p>
      <div className="mt-6">
        <RelancesView />
      </div>
    </div>
  );
}
