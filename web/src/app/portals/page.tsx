import { Radar } from "lucide-react";
import { PortalsView } from "@/components/portals-view";

export const dynamic = "force-dynamic";

export default function PortalsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center gap-3">
        <Radar className="size-6 text-brand" />
        <h1 className="font-display text-2xl tracking-tight text-landing">Portails</h1>
      </div>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        Les entreprises que career-ops surveille pour détecter les nouveaux postes. Lancez un contrôle de santé pour
        repérer les pages carrières cassées sans bruit — un lien mort, et cette entreprise disparaît silencieusement de
        tous les scans suivants.
      </p>
      <p className="mt-1.5 text-xs text-faint">
        Alimenté par <code className="text-muted">portals.yml</code> — modifiez-le directement ou demandez à l'assistant.
      </p>
      <div className="mt-6">
        <PortalsView />
      </div>
    </div>
  );
}
