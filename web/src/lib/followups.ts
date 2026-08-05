// Pure types + helpers for the follow-up tracker (shared by the /followups page,
// the home follow-up card, and the log API route). The cadence VERDICT itself is
// the core's — followup-cadence.mjs --json — never recomputed here; these are
// only the display-side contracts and formatters.

// Valeurs ÉCRITES dans data/follow-ups.md et validées côté serveur — le moteur
// followup-cadence.mjs les relit. Jamais traduites ; voir channelLabel() pour
// l'affichage.
export const CHANNELS = ["Email", "LinkedIn", "Phone", "Other"] as const;
export type Channel = (typeof CHANNELS)[number];

// ⚠️ Les trois tables ci-dessous sont typées EXHAUSTIVEMENT à dessein : si un
// merge upstream ajoute un canal, une urgence ou un statut de cadence, elles
// cessent de compiler au lieu d'afficher silencieusement la nouvelle valeur en
// anglais. Ajoutez le libellé — n'élargissez pas le type en Record<string, …>.

const CHANNEL_LABEL_FR: Record<Channel, string> = {
  Email: "E-mail",
  LinkedIn: "LinkedIn",
  Phone: "Téléphone",
  Other: "Autre",
};

/** Canal (valeur persistée) → libellé français. Affichage seulement. */
export function channelLabel(channel: string): string {
  return (CHANNEL_LABEL_FR as Record<string, string>)[channel] ?? channel;
}

const URGENCY_LABEL_FR: Record<Urgency, string> = {
  urgent: "urgent",
  overdue: "en retard",
  waiting: "en attente",
  cold: "refroidie",
};

/** Urgence calculée par le moteur du cœur → libellé français. Affichage seulement. */
export function urgencyLabel(u: string): string {
  return (URGENCY_LABEL_FR as Record<string, string>)[u] ?? u;
}

const CADENCE_STATUS_LABEL_FR: Record<CadenceEntry["status"], string> = {
  applied: "Envoyée",
  responded: "Réponse reçue",
  interview: "Entretien",
};

/** Statut de cadence ("applied" | "responded" | "interview") → libellé français. */
export function cadenceStatusLabel(status: string): string {
  return (CADENCE_STATUS_LABEL_FR as Record<string, string>)[status.toLowerCase()] ?? status;
}

/** The profile.yml → followup_cadence keys the core followup-cadence.mjs reads. */
export const PROFILE_CADENCE_KEYS = [
  "applied_first_days",
  "applied_subsequent_days",
  "applied_max_followups",
  "responded_initial_days",
  "responded_subsequent_days",
  "interview_thankyou_days",
] as const;
export type ProfileCadenceKey = (typeof PROFILE_CADENCE_KEYS)[number];

/** Kept IDENTICAL to DEFAULT_CADENCE in followup-cadence.mjs (the source of
 *  truth) — only used to show the settings form's baseline values. */
export const CADENCE_DEFAULTS: Record<ProfileCadenceKey, number> = {
  applied_first_days: 7,
  applied_subsequent_days: 7,
  applied_max_followups: 2,
  responded_initial_days: 1,
  responded_subsequent_days: 3,
  interview_thankyou_days: 1,
};

/** One logged follow-up (a row of data/follow-ups.md; legacy bullets have num null). */
export type FollowupLogEntry = {
  num: number | null;
  appNum: number;
  date: string;
  company: string;
  role: string;
  channel: string;
  contact: string;
  notes: string;
};

export type SuggestedContact = { email: string; name: string | null };

/** One actionable application as analyzed by followup-cadence.mjs. */
export type CadenceEntry = {
  num: number;
  date: string;
  appliedDate: string;
  company: string;
  role: string;
  status: "applied" | "responded" | "interview";
  score: string;
  notes: string;
  reportPath: string | null;
  contacts: SuggestedContact[];
  daysSinceApplication: number;
  daysSinceLastFollowup: number | null;
  followupCount: number;
  followups: FollowupLogEntry[];
  urgency: Urgency;
  nextFollowupDate: string | null;
  /** User-pinned next date (overrides the computed cadence); absent on older engines. */
  nextOverride?: string | null;
  daysUntilNext: number | null;
};

export type CadenceMetadata = {
  analysisDate: string;
  totalTracked: number;
  actionable: number;
  overdue: number;
  urgent: number;
  cold: number;
  waiting: number;
};

export type Urgency = "urgent" | "overdue" | "waiting" | "cold";

/** Sort rank, NOT alphabetical: most pressing first. */
export const URGENCY_RANK: Record<Urgency, number> = { urgent: 0, overdue: 1, waiting: 2, cold: 3 };

export function urgencyRank(u: string): number {
  return URGENCY_RANK[u as Urgency] ?? 9;
}

/** Badge tone per spec: urgent=red, overdue=amber, waiting=blue/info, cold=neutral. */
export function urgencyTone(u: string): "bad" | "warn" | "info" | "muted" {
  if (u === "urgent") return "bad";
  if (u === "overdue") return "warn";
  if (u === "waiting") return "info";
  return "muted";
}

/** Status badge tone per spec: interview=green, responded=blue, else neutral. */
export function followupStatusTone(status: string): "good" | "info" | "muted" {
  const s = status.toLowerCase();
  if (s.includes("interview")) return "good";
  if (s.includes("responded")) return "info";
  return "muted";
}

/** « aujourd'hui » / « demain » / « dans N jours » / « il y a N jours ». */
export function relativeDays(daysUntil: number): string {
  if (daysUntil === 0) return "aujourd'hui";
  if (daysUntil === 1) return "demain";
  if (daysUntil > 1) return `dans ${daysUntil} jours`;
  return daysUntil === -1 ? "il y a 1 jour" : `il y a ${-daysUntil} jours`;
}

/** 7/14-day escalation for "days since" cells: amber bold ≥7, red bold ≥14. */
export function daysHeatClass(days: number | null): string {
  if (days == null) return "text-faint";
  if (days >= 14) return "font-bold text-red-600 dark:text-red-400";
  if (days >= 7) return "font-bold text-amber-600 dark:text-amber-400";
  return "";
}

/** Today as YYYY-MM-DD in the user's LOCAL timezone — what a human means by
 *  "today". (toISOString() is UTC: east of UTC it shows yesterday in the
 *  morning; west of UTC it flips early evening.) */
export function localISODate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** True only for a real calendar date in YYYY-MM-DD form (rejects 2026-13-45,
 *  2026-02-31 — regex-valid strings that produce Invalid Date and can crash
 *  date math downstream). */
export function isRealISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Énumération à la française : « A », « A et B », « A, B et C » (pas de virgule
 *  avant le « et » — la virgule de série n'existe pas en français). */
export function oxfordJoin(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
}
