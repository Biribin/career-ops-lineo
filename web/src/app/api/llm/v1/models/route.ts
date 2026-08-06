import { CLI_DEFAUT } from "@/lib/llm-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liste de modèles, format OpenAI.
//
// Certains clients (dont le sous-nœud « OpenAI Chat Model » de n8n selon les
// versions) valident le modèle demandé en interrogeant /models avant d'appeler.
// Un 404 ici est traduit en « The model X does not exist or you do not have
// access to it » — exactement l'erreur observée au premier run (exécution
// 959526), alors que le modèle n'était pas le problème.
//
// On annonce donc le seul « modèle » qui existe ici : le CLI local. La valeur
// déclarée côté n8n (career-ops-cli) est acceptée telle quelle.

const IDS = ["career-ops-cli", `career-ops-cli/${CLI_DEFAUT}`, CLI_DEFAUT];

export async function GET() {
  return Response.json({
    object: "list",
    data: IDS.map((id) => ({
      id,
      object: "model",
      created: 0,
      owned_by: "career-ops",
    })),
  });
}
