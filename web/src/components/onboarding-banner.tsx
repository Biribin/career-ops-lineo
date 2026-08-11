"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X, Settings } from "lucide-react";

type Doctor = { available: boolean; onboardingNeeded: boolean; missing: string[]; warnings: string[] };

function hasCli(): boolean {
  try {
    return !!JSON.parse(localStorage.getItem("career-ops:config") || "{}").cliId;
  } catch {
    return false;
  }
}

// Les CLÉS sont des chemins de fichiers — jamais traduites.
const LABELS: Record<string, string> = {
  "cv.md": "votre CV",
  "config/profile.yml": "votre profil — postes visés, rémunération, lieu",
  "modes/_profile.md": "votre personnalisation",
  "portals.yml": "les entreprises à scanner",
};

// Detect (via the core's doctor.mjs) whether setup is incomplete, and offer to
// finish it CONVERSATIONALLY — the assistant asks in plain language and writes
// the canonical files (no YAML to edit). This is the #1 adoption barrier.
export function OnboardingBanner() {
  const [d, setD] = useState<Doctor | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [cli, setCli] = useState(true); // assume until read (avoid CTA flash)

  useEffect(() => {
    setCli(hasCli());
    fetch("/api/doctor")
      .then((r) => r.json())
      .then(setD)
      .catch(() => {});
  }, []);

  if (dismissed || !d || !d.onboardingNeeded) return null;
  const items = d.missing.map((m) => LABELS[m] ?? m);
  const kickoff =
    `Aide-moi à finir la configuration de career-ops. Il me reste à renseigner ${items.join(", ")} — guide-moi uniquement sur ces points, sous forme de conversation, et écris les fichiers à ma place. Ne me demande rien qui soit déjà configuré (par exemple, ne me demande pas mon CV s'il est déjà enregistré). Réponds en français.`;

  return (
    <div className="dot-bg relative mb-6 overflow-hidden rounded-2xl border border-brand/30 bg-gradient-to-br from-brand/10 via-surface/40 to-transparent p-5">
      <button
        onClick={() => setDismissed(true)}
        className="absolute right-3 top-3 text-faint transition-colors hover:text-foreground"
        aria-label="Masquer"
      >
        <X className="size-4" />
      </button>
      <h2 className="font-display text-xl text-landing">Terminons votre configuration</h2>
      <p className="mt-1.5 max-w-xl text-sm text-muted">
        career-ops fonctionne mieux quand il vous connaît. Il nous manque encore {items.join(", ")}.{" "}
        <span className="text-foreground">Aucun YAML à modifier</span> — répondez en langage courant et l’assistant
        l’écrit pour vous.
      </p>
      {cli ? (
        <button
          onClick={() => window.dispatchEvent(new CustomEvent("co-assistant", { detail: { message: kickoff } }))}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
        >
          <Sparkles className="size-4" /> Me configurer avec l&apos;assistant
        </button>
      ) : (
        // The assistant needs a CLI to run — without one the kickoff would silently
        // drop. Send them to connect one first.
        <Link
          href="/config"
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200"
        >
          <Settings className="size-4" /> Connectez votre CLI d&apos;IA pour démarrer
        </Link>
      )}
    </div>
  );
}
