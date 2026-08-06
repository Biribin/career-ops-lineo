// Shim OpenAI Chat Completions → CLI agentique local. Partie pure et testable.
//
// POURQUOI CE FICHIER EXISTE
// --------------------------
// Le workflow n8n « Job Application Assistant » avait 6 agents LangChain branchés
// sur un sous-nœud « Anthropic Chat Model », donc sur l'API Anthropic facturée.
// Le 2026-08-06 le crédit s'est épuisé : les agents tombent en « Bad request » et
// la chaîne meurt avant de chercher quoi que ce soit (exécution 959365).
//
// `forum-judge` avait déjà résolu ce problème pour le forum watcher en imitant
// l'API Anthropic Messages. Mais ici on ne peut pas s'en servir directement : le
// sous-nœud « Anthropic Chat Model » de n8n n'expose AUCUNE option de base URL
// (elle vit dans la credential, et le MCP ne peut ni créer ni modifier une
// credential). Le sous-nœud « OpenAI Chat Model », lui, expose `options.baseURL`.
//
// D'où ce shim au format OpenAI : on remplace le sous-nœud modèle, et les 4
// agents restants gardent leurs prompts, leur mémoire et leurs parsers de sortie
// structurée EXACTEMENT tels quels. C'est la migration la moins risquée — la
// seule alternative était de réécrire chaque agent en 3 nœuds (préparer / appeler
// / parser), soit 12 nœuds et 4 prompts recopiés à la main.
//
// Derrière, c'est Claude Code sur l'abonnement Max : coût marginal nul.

/** Aplati des messages OpenAI en un prompt unique pour un CLI headless. */
export function promptDepuisMessages(messages) {
  const liste = Array.isArray(messages) ? messages : [];
  const morceaux = [];

  for (const m of liste) {
    if (!m || typeof m !== "object") continue;
    const role = String(m.role ?? "").toLowerCase();
    const texte = contenuEnTexte(m.content);
    if (!texte) continue;

    // Le rôle est conservé en clair : sans lui, un historique multi-tours (la
    // mémoire des agents n8n) devient un mur de texte où le modèle ne sait plus
    // qui a dit quoi.
    if (role === "system") morceaux.push(texte);
    else if (role === "assistant") morceaux.push(`[réponse précédente]\n${texte}`);
    else morceaux.push(texte);
  }

  return morceaux.join("\n\n").trim();
}

/** Le `content` OpenAI peut être une chaîne ou une liste de parts typées. */
export function contenuEnTexte(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c && typeof c === "object" && typeof c.text === "string") return c.text;
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

/**
 * Enveloppe une réponse texte au format Chat Completions.
 *
 * Les champs sont ceux que le client OpenAI de LangChain lit réellement :
 * `choices[0].message.content` et `finish_reason`. `usage` est renvoyé à zéro
 * plutôt qu'omis — un client qui l'additionne ne doit pas tomber sur undefined,
 * et zéro est la vérité : cet appel ne consomme aucun token facturé.
 */
export function reponseChatCompletions({ texte, model = "career-ops-cli", id = "chatcmpl-career-ops", cree = 0 }) {
  return {
    id,
    object: "chat.completion",
    created: cree,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: texte },
        logprobs: null,
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Nettoie ce que rend un CLI conversationnel avant de le donner à un parser
 * de sortie structurée.
 *
 * Claude Code encadre volontiers le JSON dans un bloc de code, et ajoute parfois
 * une phrase d'introduction. Les parsers `outputParserStructured` de n8n savent
 * récupérer du JSON noyé dans du texte, mais pas toujours : autant enlever le
 * bruit le plus courant ici, une fois, plutôt que de compter sur `autoFix` (qui
 * relance un appel LLM à chaque échec).
 */
export function nettoieSortie(brut) {
  let t = String(brut ?? "").trim();

  // Bloc de code entourant TOUT le contenu (```json … ``` ou ``` … ```).
  const fence = t.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/);
  if (fence) t = fence[1].trim();

  return t;
}
