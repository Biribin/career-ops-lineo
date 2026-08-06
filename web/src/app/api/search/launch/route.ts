export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Cible du bouton « Lancer la recherche » : déclenche le workflow n8n
// « 1. Decouverte des offres » par son webhook.
//
// POURQUOI CETTE ROUTE EXISTE PLUTÔT QU'UN APPEL DIRECT DEPUIS LE NAVIGATEUR
//  - l'URL du webhook n8n reste côté serveur, elle n'est pas dans le bundle ;
//  - une tournée dure plusieurs minutes. n8n répond immédiatement
//    (responseMode onReceived) et travaille en arrière-plan ; le navigateur ne
//    reste donc pas suspendu, et la page relit /api/offers ensuite.

const N8N_DEFAUT = "https://n8n.balzac-info.online";
const CHEMIN = "/webhook/recherche-emploi";

export async function POST() {
  const base = (process.env.N8N_BASE_URL?.trim() || N8N_DEFAUT).replace(/\/+$/, "");
  const url = `${base}${CHEMIN}`;

  try {
    const rep = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ declenche_par: "career-ops-web", at: new Date().toISOString() }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!rep.ok) {
      // Le 404 est LE cas courant et mérite son propre message : un nœud Webhook
      // ne répond qu'en production, donc sur un workflow ACTIF. Sans ça on
      // chercherait longtemps pourquoi le bouton « ne fait rien ».
      const explication =
        rep.status === 404
          ? "n8n a repondu 404 : le workflow « 1. Decouverte des offres » est-il ACTIVE ? Un noeud Webhook ne repond pas sur un workflow desactive."
          : `n8n a repondu ${rep.status}`;
      return Response.json({ ok: false, error: explication, url }, { status: 502 });
    }

    return Response.json({ ok: true, url, message: "recherche lancee, les offres arriveront dans quelques minutes" });
  } catch (e) {
    return Response.json(
      { ok: false, error: e instanceof Error ? e.message : "appel a n8n impossible", url },
      { status: 502 },
    );
  }
}
