"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { CADENCE_DEFAULTS, PROFILE_CADENCE_KEYS, type ProfileCadenceKey } from "@/lib/followups";
import { cn } from "@/lib/cn";

// Follow-up cadence knobs → config/profile.yml (followup_cadence). Server-
// persisted (unlike the localStorage engine prefs above) because the core
// followup-cadence.mjs reads the same keys — the CLI and the web must agree.

// `key` = clé de config/profile.yml lue par le cœur — jamais traduite.
const FIELDS: { key: ProfileCadenceKey; label: string; hint: string }[] = [
  { key: "applied_first_days", label: "Première relance", hint: "jours après l'envoi avant la 1re relance" },
  { key: "applied_subsequent_days", label: "Entre deux relances", hint: "jours entre deux relances tant que la candidature est envoyée" },
  { key: "applied_max_followups", label: "Relances maximum", hint: "au-delà, sans réponse, la piste est considérée refroidie" },
  { key: "responded_initial_days", label: "Délai de réponse", hint: "répondre à l'entreprise dans ce délai en jours" },
  { key: "responded_subsequent_days", label: "Cadence après réponse", hint: "jours entre deux échanges après une réponse reçue" },
  { key: "interview_thankyou_days", label: "Message de remerciement", hint: "à envoyer dans ce délai après un entretien" },
];

export function CadenceSettings() {
  const [values, setValues] = useState<Record<ProfileCadenceKey, string> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On a failed load, do NOT fall back to defaults: the user would see 7/7/2/…
  // with no warning and a Save would overwrite their real profile.yml
  // overrides. Show an error + Retry instead.
  const load = useCallback(() => {
    setLoadError(false);
    fetch("/api/followups/cadence")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        const eff = { ...CADENCE_DEFAULTS, ...(d?.effective ?? {}) };
        setValues(Object.fromEntries(PROFILE_CADENCE_KEYS.map((k) => [k, String(eff[k])])) as Record<ProfileCadenceKey, string>);
      })
      .catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  const save = async () => {
    if (!values) return;
    const payload: Partial<Record<ProfileCadenceKey, number>> = {};
    for (const k of PROFILE_CADENCE_KEYS) {
      // Number(), not parseInt(): "3.5" and "7abc" must be rejected, not truncated.
      const raw = values[k].trim();
      const n = raw === "" ? Number.NaN : Number(raw);
      if (!Number.isInteger(n) || n < 0) {
        setError(`« ${FIELDS.find((f) => f.key === k)?.label} » doit être un nombre entier ≥ 0.`);
        return;
      }
      payload[k] = n;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/followups/cadence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof j.error === "string" ? j.error : "Enregistrement impossible.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      setError("Enregistrement impossible.");
    }
    setSaving(false);
  };

  return (
    <div>
      <label className="mt-8 mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        Cadence des relances
      </label>
      <div className="rounded-xl border border-border bg-surface/50 p-4">
        <p className="text-xs leading-relaxed text-faint">
          Le moment où le suivi des <span className="text-muted">relances</span> vous sollicite. Enregistré dans{" "}
          <span className="font-mono text-muted">config/profile.yml</span> — le CLI utilise les mêmes valeurs.
        </p>
        {loadError ? (
          <div className="mt-3 text-sm text-muted">
            <p className="text-red-500">
              Impossible de lire vos réglages de cadence actuels — les valeurs par défaut ne sont pas affichées, pour
              éviter d&apos;écraser vos vraies valeurs dans <span className="font-mono">config/profile.yml</span>.
            </p>
            <button
              type="button"
              onClick={load}
              className="mt-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover"
            >
              Réessayer
            </button>
          </div>
        ) : values === null ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Chargement…
          </div>
        ) : (
          <>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="block text-sm font-medium text-foreground">{f.label}</span>
                  <span className="mt-0.5 block text-xs text-faint">{f.hint}</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={values[f.key]}
                    onChange={(e) => setValues((v) => (v ? { ...v, [f.key]: e.target.value } : v))}
                    className="mt-1.5 w-24 rounded-md border border-border bg-surface/60 px-3 py-1.5 text-sm tabular-nums outline-none transition-colors focus:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/40"
                  />
                </label>
              ))}
            </div>
            {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className={cn(
                "mt-4 inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium transition-colors hover:bg-surface-hover",
                "disabled:pointer-events-none disabled:opacity-60",
              )}
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5 text-emerald-400" /> : null}
              {saved ? "Enregistré" : "Enregistrer la cadence"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
