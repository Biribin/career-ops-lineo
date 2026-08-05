import { Send } from "lucide-react";
import { ApplyView } from "@/components/apply-view";
import { ApplyBackdropMount } from "@/components/apply/apply-backdrop-mount";

export const dynamic = "force-dynamic";

export default function ApplyPage() {
  return (
    <div className="relative min-h-screen">
      {/* full-viewport blurred form wallpaper (behind everything) */}
      <ApplyBackdropMount />
      <div className="relative z-10 mx-auto max-w-3xl px-6 py-8">
        <div className="flex items-center gap-3">
          <Send className="size-6 text-brand" />
          <h1 className="font-display text-2xl tracking-tight text-landing">Candidater</h1>
        </div>
        <p className="mt-1.5 max-w-xl text-sm text-muted">
          career-ops lit le vrai formulaire de candidature sur votre machine et le réaffiche ici en langage clair,
          prérempli depuis votre CV. Vous vérifiez chaque réponse — puis il remplit le formulaire réel en coulisses et
          c'est vous qui l'envoyez. Il n'envoie jamais à votre place.
        </p>
        <div className="mt-6">
          <ApplyView />
        </div>
      </div>
    </div>
  );
}
