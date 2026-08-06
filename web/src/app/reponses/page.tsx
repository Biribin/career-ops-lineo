import { MessageSquare } from "lucide-react";
import { ReponsesView } from "@/components/reponses/reponses-view";

export const dynamic = "force-dynamic";

export default function ReponsesPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <MessageSquare className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Réponses n8n</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        Vos réponses aux offres du forum n8n. Générez le message depuis une offre (bouton « Réponse »), copiez-le, postez-le
        sur le forum, puis suivez ici : à valider, posté, à relancer, répondu.
      </p>
      <div className="mt-6">
        <ReponsesView />
      </div>
    </div>
  );
}
