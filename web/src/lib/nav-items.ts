import { LayoutDashboard, Compass, History, ListChecks, PackageCheck, Send, Radar, BarChart3, PieChart, FileText, Settings, ShieldCheck, MessageSquare } from "lucide-react";
import type { ComponentType, SVGProps } from "react";

// Single source of truth for the app's primary destinations — shared by the
// desktop sidebar and the mobile nav so they can never drift.
export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  chip?: string;
  /** Pastille de comptage vivant, rendue par les DEUX navs depuis le même
   *  fournisseur — un libellé statique (`chip`) ne pourrait pas dire combien. */
  compteur?: "a-deposer";
};

// Les `href` sont des routes (noms de fichiers) — jamais traduits. Seuls les
// libellés sont user-facing.
export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Aujourd'hui", icon: LayoutDashboard },
  { href: "/explore", label: "Explorer", icon: Compass, chip: "Nouveau" },
  { href: "/a-valider", label: "À valider", icon: ShieldCheck },
  // Suite immédiate de « À valider » pour les annonces sans adresse de recruteur :
  // n8n n'a pu envoyer que le dossier à Linéo, et c'est là qu'un dépôt manuel
  // s'enregistre. Sans cette destination, la candidature n'entre jamais dans le
  // tracker — donc ni dans « Envoyées », ni dans les relances.
  { href: "/a-deposer", label: "À déposer", icon: PackageCheck, compteur: "a-deposer" },
  { href: "/pipeline", label: "Candidatures", icon: ListChecks },
  { href: "/reponses", label: "Réponses n8n", icon: MessageSquare },
  // Deux destinations, deux questions : /relances ne montre que ce qui est dû
  // (la file d'action, même contrat que n8n), /followups reste le tracker complet
  // avec l'historique, les dates épinglées et le réglage de cadence.
  { href: "/relances", label: "Relances dues", icon: Send },
  { href: "/followups", label: "Suivi des relances", icon: History },
  { href: "/portals", label: "Portails", icon: Radar },
  // Deux pages, deux rôles : /stats donne les chiffres de référence du moteur
  // (stats.mjs, les mêmes qu'au terminal), /analytics dessine les répartitions
  // calculées côté web. Le libellé « Statistiques » va au moteur — c'est lui
  // qu'on cite.
  { href: "/stats", label: "Statistiques", icon: BarChart3 },
  { href: "/analytics", label: "Répartitions", icon: PieChart },
  { href: "/cv", label: "CV", icon: FileText },
  { href: "/config", label: "Configuration", icon: Settings },
];

export function isActivePath(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}
