import { erreurOpenAi, executeLlm } from "@/lib/llm-runner";
import { promptDepuisResponses, reponseResponses } from "@/lib/openai-shim.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Responses API d'OpenAI, format récent → CLI local.
//
// Existe parce que le sous-nœud « OpenAI Chat Model » de n8n vise /responses dès
// que `responsesApiEnabled` est vrai (et c'est son DÉFAUT). Au premier run réel
// le nœud a pris un 404 que n8n a traduit en « The model career-ops-cli does not
// exist » — message trompeur : le problème était le chemin, pas le modèle.
// On implémente donc les deux formats plutôt que de dépendre d'un réglage.

export async function POST(req: Request) {
  let body: { input?: unknown; instructions?: string; model?: string; cliId?: string; stream?: boolean };
  try {
    body = await req.json();
  } catch {
    return erreurOpenAi("json invalide", 400, "invalid_request_error");
  }

  if (body.stream === true) {
    return erreurOpenAi("stream non supporté par ce shim : mettre stream=false", 400, "invalid_request_error");
  }

  const prompt = promptDepuisResponses(body);
  if (!prompt) {
    return erreurOpenAi("input requis (aucun contenu texte exploitable)", 400, "invalid_request_error");
  }

  const r = await executeLlm(prompt, body.cliId);
  if (!r.ok) return erreurOpenAi(r.message, r.status);

  return Response.json(
    reponseResponses({
      texte: r.texte,
      model: `career-ops-cli/${r.cliId}`,
      cree: Math.floor(Date.now() / 1000),
    }),
  );
}
