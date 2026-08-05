import { LayoutDashboard, Compass, History, ListChecks, Send, Radar, BarChart3, FileText, Settings, ShieldCheck } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Single source of truth for the app's primary destinations — shared by the
// desktop sidebar and the mobile nav so they can never drift.
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
};

// Les `href` sont des routes (noms de fichiers) — jamais traduits. Seuls les
// libellés sont user-facing.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Aujourd'hui", icon: LayoutDashboard },
  { href: "/explore", label: "Explorer", icon: Compass, chip: "Nouveau" },
  { href: "/a-valider", label: "À valider", icon: ShieldCheck },
  { href: "/pipeline", label: "Candidatures", icon: ListChecks },
  // Deux destinations, deux questions : /relances ne montre que ce qui est dû
  // (la file d'action, même contrat que n8n), /followups reste le tracker complet
  // avec l'historique, les dates épinglées et le réglage de cadence.
  { href: "/relances", label: "Relances dues", icon: Send },
  { href: "/followups", label: "Suivi des relances", icon: History },
  { href: "/portals", label: "Portails", icon: Radar },
  { href: "/analytics", label: "Statistiques", icon: BarChart3 },
  { href: "/cv", label: "CV", icon: FileText },
  { href: "/config", label: "Configuration", icon: Settings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
