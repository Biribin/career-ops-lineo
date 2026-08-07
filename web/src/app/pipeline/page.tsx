import { Suspense } from "react";
import { pipelineSummary } from "@/lib/career-ops";
import { litOffresADecider } from "@/lib/offers-journal";
import { PipelineView } from "@/components/pipeline-view";
import { OffresDecouvertes } from "@/components/offres-decouvertes";

export const dynamic = "force-dynamic"; // always read fresh local files

export default function PipelinePage() {
  const { inbox, applications } = pipelineSummary();
  // Compté ICI, côté serveur, et pas laissé au composant client : sinon l'onglet
  // annoncerait « À trier 2 » au-dessus d'une liste de 8 lignes.
  const nOffresN8n = litOffresADecider().length;
  return (
    <Suspense>
      {/* Les offres n8n sont rendues DANS l'onglet « À trier », comme
          sous-tableau de provenance, et non plus dans un bloc séparé en bas de
          page : il y avait deux files de triage concurrentes à l'écran.

          C'est une fusion d'AFFICHAGE. Les deux sources gardent leur stockage :
          data/pipeline.md (scanner local + forum n8n) d'un côté,
          data/offres-n8n.jsonl (France Travail) de l'autre. Les verser dans le
          même fichier demanderait de passer par l'écrivain sanctionné de
          pipeline.md (scan.mjs sous pipeline-lock.mjs) — le contrat de données
          interdit d'y écrire directement. */}
      <PipelineView
        applications={applications}
        inbox={inbox}
        offresN8n={<OffresDecouvertes />}
        nOffresN8n={nOffresN8n}
      />
    </Suspense>
  );
}
