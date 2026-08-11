// Quelle formation faire pour CETTE offre — conseil interne, jamais envoyé.
//
// LE CONTEXTE : le 2026-08-11, la rubrique « Plan de formation 2026 » a été
// retirée de tous les CV (career-ops/cv.md et le repo Biribin/cv). Linéo n'en
// parlera plus qu'à l'oral. Conséquence directe, et c'est tout le raisonnement de
// ce fichier : une formation ne vaut plus que par ce qu'elle donne RÉELLEMENT
// pour le test technique d'un process de recrutement. Un certificat qui atteste
// ce qu'il fait déjà en production ne vaut plus rien, puisque plus personne ne le
// lira sur un document.
//
// D'OÙ LES DEUX RÈGLES NON NÉGOCIABLES :
//
//  1. On ne conseille QUE ce que l'offre demande vraiment. Aucune liste par
//     défaut. Zéro correspondance rend `aucunSignal`, et l'interface le dit,
//     plutôt que d'envoyer Linéo passer deux semaines sur un sujet hors sujet.
//
//  2. On ne conseille JAMAIS ce qu'il tient déjà en production (`acquis: true`).
//     Une offre qui demande n8n ou MCP n'appelle pas la n8n Academy ni le MCP
//     Course : elle appelle de quoi PROUVER, pas de quoi apprendre. Ces
//     correspondances sortent dans `dejaAcquis`, à dire à l'oral, pas à travailler.
//
// SOURCES DE TEXTE : l'intitulé du poste (compté double, c'est le champ le plus
// fiable de la fiche), plus `pourquoi_ca_matche`, `arguments_cles` et
// `apercu_lettre`.
//
// ⚠️ `mots_cles_source` est VOLONTAIREMENT exclu. Sur les fiches réelles du
// 2026-08-11 il ne contient qu'un jeton parasite (« mode », « api ») : l'extraction
// est cassée en amont, côté n8n. Pire, son « api » déclencherait à lui seul la
// reco Python sur n'importe quelle offre. Ne pas le rebrancher sans avoir d'abord
// vérifié qu'il porte enfin une vraie liste.

/** Normalisation commune : sans accents, minuscules, ponctuation aplatie. */
const norm = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// `acquis: true` = déjà en production d'après cv.md, donc jamais à travailler.
//
// `poids` ORDONNE les conseils : plus il est haut, plus la formation débloque
// quelque chose que Linéo ne sait pas faire. Le nombre de déclencheurs touchés ne
// sert qu'à départager deux poids égaux, et c'est volontaire : une annonce qui
// répète « dashboards, outils internes, interfaces web » touche Streamlit quatre
// fois sans que ce soit pour autant plus urgent que Python, exigé une seule fois
// mais en dur. Compter les mots-clés classait le « plus » avant l'obligatoire.
export const CATALOGUE = [
  {
    id: "python-fastapi",
    libelle: "MOOC Python d'Helsinki, parties 1 à 7, puis le tutoriel officiel FastAPI",
    org: "Université d'Helsinki, puis FastAPI",
    effort: "environ 2 semaines",
    poids: 10,
    acquis: false,
    // Le seul vrai trou du CV face à une exigence dure, et ce que teste un cas
    // pratique. Les 14 parties du MOOC prendraient des mois : 1 à 7 suffisent
    // pour lire et modifier un outil interne.
    declencheurs: ["python", "flask", "fastapi", "django", "pytest", "back end", "backend"],
  },
  {
    id: "streamlit",
    libelle: "Streamlit, la doc officielle puis un outil interne livré de bout en bout",
    org: "Streamlit",
    effort: "1 à 2 jours",
    poids: 9,
    acquis: false,
    // Meilleur rendement par heure de toute la liste : fait passer de « je ne
    // fais pas de front » à « je livre un outil interne avec une interface ».
    declencheurs: ["streamlit", "outil interne", "outils internes", "dashboard", "dashboards", "interface web", "interfaces web", "frontend", "front end"],
  },
  {
    id: "sql-entrepot",
    libelle: "SQL d'entrepôt : CTE, fonctions de fenêtrage, jointures sur du volume",
    org: "exercices, pas un cours",
    effort: "quelques heures",
    poids: 6,
    acquis: false,
    // PostgreSQL, Supabase et SQLite sont déjà au CV. Ce qui manque est le
    // vocabulaire d'entrepôt, pas les bases.
    declencheurs: ["sql", "bigquery", "snowflake", "warehouse", "entrepot", "dbt", "redshift", "data analyst"],
  },
  {
    id: "cloud-socle",
    libelle: "Fondamentaux GCP ou AWS, niveau socle uniquement",
    org: "Google Cloud Skills Boost ou AWS Skill Builder",
    effort: "2 à 3 jours",
    poids: 7,
    acquis: false,
    // Il exploite un VPS avec Docker et un reverse proxy. Le socle hyperscaler
    // est un vrai manque quand l'offre l'attend.
    declencheurs: ["gcp", "google cloud", "aws", "azure", "vertex", "lambda", "cloud run", "bigquery"],
  },
  {
    id: "make-academy",
    libelle: "Make Academy, parcours Foundation",
    org: "Make",
    effort: "1 jour",
    poids: 5,
    acquis: false,
    // Techniquement plus simple que n8n. L'intérêt est de pouvoir dire qu'il
    // connaît l'outil quand les scénarios de la boîte y vivent déjà.
    declencheurs: ["make", "integromat", "zapier", "power automate"],
  },
  {
    id: "uipath",
    libelle: "UiPath Academy, parcours RPA Developer Foundation",
    org: "UiPath",
    effort: "environ 1 semaine",
    poids: 8,
    acquis: false,
    // Le RPA est un monde à part de l'orchestration n8n, et les offres RPA
    // testent l'outil nommé.
    declencheurs: ["uipath", "rpa", "blue prism", "automation anywhere", "camunda", "hyperautomation"],
  },
  {
    id: "langgraph",
    libelle: "LangChain Academy puis LangGraph",
    org: "LangChain",
    effort: "environ 1 semaine",
    poids: 7,
    acquis: false,
    // Il orchestre des agents, mais avec n8n et Claude Code, pas avec ces
    // frameworks. Une offre qui les nomme les fera coder.
    declencheurs: ["langchain", "langgraph", "crewai", "autogen", "llamaindex", "semantic kernel"],
  },
  {
    id: "ab-620",
    libelle: "Certification Microsoft AB-620, AI Agent Builder Associate",
    org: "Microsoft",
    effort: "plusieurs semaines, examen payant",
    poids: 3,
    acquis: false,
    // Volontairement en bas : lente et payante pour un signal faible, puisque
    // plus aucun certificat n'est affiché sur les CV.
    declencheurs: ["copilot studio", "power platform", "ab-620", "ai-102", "ai-103"],
  },
  // ────────── Ci-dessous : ce qu'il tient DÉJÀ en production. ──────────
  // Ces entrées ne sont jamais conseillées. Elles servent à répondre « l'offre le
  // demande, tu l'as déjà », ce qui est une information utile avant un entretien.
  //
  // ⚠️ CE FICHIER EST PUBLIÉ. Le dépôt career-ops-lineo est public, et son design
  // met les données personnelles dans la couche utilisateur gitignorée
  // (`modes/_profile.md`, `modes/_custom.md`, `cv.md`, `config/profile.yml`). Un
  // composant client comme la page « À valider » embarque forcément ce qu'il lit,
  // donc tout ce qui est écrit ici part dans le bundle public.
  //
  // Les `preuve` restent donc GÉNÉRIQUES : pas de nom de client, pas de compte de
  // serveurs, rien qui décrive le SI interne d'un employeur. Seules les preuves
  // déjà publiques (le dépôt n8n-workflows) sont chiffrées. Pour retrouver les
  // chiffres exacts, il faut une surcharge en couche utilisateur gitignorée, pas
  // une ligne de plus ici.
  {
    id: "n8n-academy",
    libelle: "n8n Academy Level 1 et 2",
    org: "n8n",
    acquis: true,
    preuve: "workflows n8n en production, dont 51 publiés en open source sur github.com/Biribin/n8n-workflows",
    declencheurs: ["n8n"],
  },
  {
    id: "hf-mcp",
    libelle: "Hugging Face MCP Course",
    org: "Hugging Face",
    acquis: true,
    preuve: "serveurs MCP conçus et exploités en production, branchés sur un assistant conversationnel",
    declencheurs: ["mcp", "model context protocol"],
  },
  {
    id: "rag-llamaindex",
    libelle: "DeepLearning.AI, Building Agentic RAG",
    org: "DeepLearning.AI",
    acquis: true,
    preuve: "base vectorielle alimentée et interrogée en langage naturel, en production",
    declencheurs: ["rag", "vectoriel", "vectorielle", "embedding", "embeddings", "pinecone", "weaviate", "qdrant"],
  },
  {
    id: "docker",
    libelle: "Docker : Getting Started, Building Images, Compose",
    org: "Docker",
    acquis: true,
    preuve: "exploitation Linux, Docker et Docker Compose sur VPS",
    declencheurs: ["docker", "conteneur", "conteneurs", "container", "containers", "kubernetes"],
  },
  {
    id: "llm-api",
    libelle: "Anthropic, parcours Claude API et agents",
    org: "Anthropic",
    acquis: true,
    preuve: "API Claude et Gemini en production, OCR par LLM, prompt engineering appliqué",
    declencheurs: ["openai", "anthropic", "claude", "gemini", "llm", "gpt", "prompt engineering"],
  },
];

/** Nombre maximum de formations conseillées. Au-delà, ce n'est plus un plan. */
export const MAX_CONSEILS = 3;

/**
 * Conseille les formations à faire pour une fiche de candidature.
 *
 * @param {{poste?: string, pourquoi_ca_matche?: string, arguments_cles?: string[]|string, apercu_lettre?: string}} fiche
 * @param {typeof CATALOGUE} [catalogue]
 * @returns {{aFaire: Array<{id: string, libelle: string, org: string, effort: string, motifs: string[]}>,
 *            dejaAcquis: Array<{id: string, libelle: string, preuve: string, motifs: string[]}>,
 *            aucunSignal: boolean}}
 */
export function formationsPourFiche(fiche, catalogue = CATALOGUE) {
  const args = Array.isArray(fiche?.arguments_cles)
    ? fiche.arguments_cles.join(" ")
    : String(fiche?.arguments_cles ?? "");

  // L'intitulé est compté deux fois : c'est le champ le plus fiable de la fiche,
  // et le mieux corrélé à ce qui sera réellement testé.
  const titre = norm(fiche?.poste);
  const foin = ` ${titre} ${titre} ${norm(fiche?.pourquoi_ca_matche)} ${norm(args)} ${norm(fiche?.apercu_lettre)} `;

  const touches = [];
  for (const f of Array.isArray(catalogue) ? catalogue : []) {
    const motifs = (f?.declencheurs ?? []).filter((d) => foin.includes(` ${norm(d)} `));
    if (motifs.length > 0) touches.push({ ...f, motifs });
  }

  const aFaire = touches
    .filter((f) => !f.acquis)
    // Le poids d'abord, le nombre de déclencheurs seulement pour départager.
    .sort((a, b) => (b.poids ?? 0) - (a.poids ?? 0) || b.motifs.length - a.motifs.length)
    .slice(0, MAX_CONSEILS)
    .map(({ id, libelle, org, effort, motifs }) => ({ id, libelle, org, effort, motifs }));

  const dejaAcquis = touches
    .filter((f) => f.acquis)
    .map(({ id, libelle, preuve, motifs }) => ({ id, libelle, preuve, motifs }));

  return {
    aFaire,
    dejaAcquis,
    // Vrai seulement quand RIEN n'a été reconnu. Une offre qui ne tombe que sur
    // de l'acquis n'est pas « sans signal » : elle n'appelle simplement aucune
    // formation, ce qui est une bonne nouvelle et se dit autrement.
    aucunSignal: touches.length === 0,
  };
}
