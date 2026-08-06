import { Suspense } from "react";
import { pipelineSummary } from "@/lib/career-ops";
import { PipelineView } from "@/components/pipeline-view";
import { OffresDecouvertes } from "@/components/offres-decouvertes";

export const dynamic = "force-dynamic"; // always read fresh local files

export default function PipelinePage() {
  const { inbox, applications } = pipelineSummary();
  return (
    <Suspense>
      {/* Lancement de la recherche + offres rapportées par le workflow n8n
          « 1. Decouverte des offres ». Placé au-dessus du pipeline : on cherche
          d'abord, on traite ensuite. */}
      <OffresDecouvertes />
      <PipelineView applications={applications} inbox={inbox} />
    </Suspense>
  );
}
