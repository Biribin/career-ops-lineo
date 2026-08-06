import { erreurOpenAi, executeLlm } from "@/lib/llm-runner";
import { promptDepuisMessages, reponseChatCompletions } from "@/lib/openai-shim.mjs";

export const runtime = "nodejs"; // spawn => runtime Node
export const dynamic = "force-dynamic";
// Une adaptation de CV embarque tout le YAML dans le prompt : les 120 s de
// forum-judge ne suffisent pas.
export const maxDuration = 300;

// Chat Completions, format OpenAI → CLI local (Claude Code, abonnement Max).
//
// À brancher dans n8n : sous-nœud « OpenAI Chat Model »
//   options.baseURL     = http://career-ops:3000/api/llm/v1
//   responsesApiEnabled = false
//
// Voir src/lib/llm-runner.ts pour le pourquoi des trois routes du shim.
// Pas d'auth : appel direct sur le réseau Docker, rien n'est exposé publiquement.
// La clé API envoyée par le client est ignorée — il n'y a pas d'API derrière.

type MsgOpenAi = { role?: string; content?: unknown };

export async function POST(req: Request) {
  let body: { messages?: MsgOpenAi[]; model?: string; cliId?: string; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return erreurOpenAi("json invalide", 400, "invalid_request_error");
  }

  // On ne sait pas streamer depuis un CLI headless. Le dire franchement plutôt
  // que de rendre un corps non-streamé qu'un client attendrait en SSE.
  if (body.stream === true) {
    return erreurOpenAi("stream non supporté par ce shim : mettre stream=false", 400, "invalid_request_error");
  }

  const prompt = promptDepuisMessages(body.messages);
  if (!prompt) {
    return erreurOpenAi("messages requis (aucun contenu texte exploitable)", 400, "invalid_request_error");
  }

  const r = await executeLlm(prompt, body.cliId);
  if (!r.ok) return erreurOpenAi(r.message, r.status);

  return Response.json(
    reponseChatCompletions({
      texte: r.texte,
      // Le vrai moteur, pas le modèle demandé : les logs n8n ne doivent pas
      // laisser croire qu'OpenAI a répondu.
      model: `career-ops-cli/${r.cliId}`,
      cree: Math.floor(Date.now() / 1000),
    }),
  );
}
