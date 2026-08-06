import { Suspense } from "react";
import { pipelineSummary } from "@/lib/career-ops";
import { PipelineView } from "@/components/pipeline-view";
import { OffresDecouvertes } from "@/components/offres-decouvertes";

export const dynamic = "force-dynamic"; // always read fresh local files

export default function PipelinePage() {
  const { inbox, applications } = pipelineSummary();
  return (
    <Suspense>
      <PipelineView applications={applications} inbox={inbox} />
      {/* APRÈS le pipeline, et pas avant : la page a déjà sa file « À trier »
          (alimentée par scan.mjs via data/pipeline.md). Mettre ce bloc en haut
          donnait l'impression d'une seconde file de triage concurrente.
          Il reste séparé parce que data/pipeline.md a un écrivain sanctionné et
          que le contrat de données interdit d'y écrire directement ; la fusion
          des deux files demande de passer par ce writer. */}
      <OffresDecouvertes />
    </Suspense>
  );
}
