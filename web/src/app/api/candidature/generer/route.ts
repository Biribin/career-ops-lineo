import { readInbox } from "@/lib/career-ops";
import { litAnnonce } from "@/lib/annonce-fetch.mjs";
import { chargeWf2, explicationEchecWf2, urlWebhookWf2 } from "@/lib/candidature-n8n.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Une lecture d'annonce (jusqu'à 25 s) puis un POST au webhook, qui répond
// « onReceived » et travaille ensuite en arrière-plan.
export const maxDuration = 60;

/**
 * Générer la candidature (lettre + CV) pour UNE offre du scanner local.
 *
 *   POST { url }
 *   →    { ok, message, annonceLue, via }
 *
 * Le pendant de /api/offers/decision `generer`, pour l'autre file : là-bas
 * l'offre est lue dans le journal n8n par son `jobId`, ici dans
 * `data/pipeline.md` par son URL. Voir lib/candidature-n8n.mjs pour pourquoi les
 * deux chemins ne sont pas fusionnés.
 *
 * MÊME DISCIPLINE QUE LES ROUTES VOISINES : le client n'envoie qu'une URL, le
 * contenu de l'offre est relu ici. Ce qui part chez n8n vient donc du serveur,
 * jamais du navigateur.
 *
 * CE QUE CETTE ROUTE NE FAIT PAS : décider. Elle n'écrit aucune ligne de
 * décision et ne retire l'offre d'aucune file — elle n'a pas de journal où le
 * faire, contrairement au chemin France Travail. L'offre reste donc visible dans
 * la file de tri après la génération ; c'est voulu, faute de quoi elle
 * disparaîtrait sans trace nulle part.
 */
export async function POST(req: Request) {
  let corps: { url?: string };
  try {
    corps = await req.json();
  } catch {
    return Response.json({ error: "json invalide" }, { status: 400 });
  }

  const url = String(corps.url ?? "").trim();
  if (!url) return Response.json({ error: "url requise" }, { status: 400 });

  const offre = readInbox().find((o) => String(o.url ?? "").trim() === url);
  if (!offre) {
    return Response.json(
      { error: `offre introuvable dans le pipeline : ${url.slice(0, 200)}` },
      { status: 404 },
    );
  }

  const { texte: texteAnnonce, via } = await litAnnonce(url);
  // Le workflow rédige la lettre À PARTIR de ce texte. Sans lui il produirait une
  // lettre creuse — pire que pas de lettre, parce qu'elle partirait chez un
  // recruteur. On refuse ici, où le message est lisible, plutôt que de le laisser
  // échouer au milieu de la chaîne n8n.
  if (!texteAnnonce || texteAnnonce.length < 200) {
    return Response.json(
      {
        error: `annonce illisible (${via}) : injoignable, vide, ou rendue par JavaScript. Sans son texte, la lettre serait creuse.`,
        annonceLue: texteAnnonce.length,
        via,
      },
      { status: 422 },
    );
  }

  const cible = urlWebhookWf2(process.env.N8N_BASE_URL);
  let rep: Response;
  try {
    rep = await fetch(cible, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chargeWf2({ offre, texteAnnonce, quand: new Date().toISOString() })),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "appel au workflow 2 impossible", url: cible },
      { status: 502 },
    );
  }

  if (!rep.ok) {
    return Response.json({ error: explicationEchecWf2(rep.status), url: cible }, { status: 502 });
  }

  return Response.json({
    ok: true,
    annonceLue: texteAnnonce.length,
    via,
    message: "génération lancée — la fiche arrivera dans « À valider » dans quelques minutes",
  });
}
