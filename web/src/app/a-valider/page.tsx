import { AValiderView } from "@/components/a-valider-view";

export const dynamic = "force-dynamic"; // toujours relire les fiches fraîches

export default function AValiderPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8 md:px-8">
      <h1 className="text-2xl font-semibold tracking-tight">À valider</h1>
      <p className="mt-1.5 text-sm text-muted">
        Les candidatures que n8n a préparées et qui attendent ta décision avant tout envoi.
      </p>
      <div className="mt-6">
        <AValiderView />
      </div>
    </div>
  );
}
