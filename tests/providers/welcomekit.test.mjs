// tests/providers/welcomekit.test.mjs — WelcomeKit, l'ATS historique de Welcome
// to the Jungle, servi en HTML sur `<slug>.welcomekit.co`.
//
// Ce que ces tests protègent :
//   1. Le balisage réel du board (constaté le 2026-08-12 sur un board de
//      40 postes) reste parsable : classes en guillemets MÉLANGÉS simples et
//      doubles dans le même document, icône `<i>` avant chaque valeur, lien
//      relatif. Chacun de ces trois détails casse un parseur naïf.
//   2. L'hôte est épinglé. `careers_url` n'est pas toujours écrit à la main
//      (des entrées naissent d'URL d'offres France Travail), donc un hôte
//      contrefait ne doit pas devenir un board.
//   3. Une URL relative devient absolue : l'URL est la clé de déduplication du
//      scanner, une URL relative la rendrait inutilisable.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — welcomekit');

// Extrait fidèle du vrai board : guillemets simples sur `jobs-list-item` et
// `jobs-list-item-title`, doubles sur `jobs-list-item-link`, icônes avant les
// valeurs, href relatif.
const BOARD = `<!DOCTYPE html><html class='nutripure'><head><title>Jobs</title></head><body>
<ul class='jobs-list'>
  <li class='jobs-list-item' data-department='38206' data-office='28372'>
    <a class="jobs-list-item-link" href="/jobs/data-platform-engineer_toulouse"><h3 class='jobs-list-item-title'> Data Platform Engineer </h3>
      <ul class='jobs-list-item-details'>
        <li class='jobs-list-item-contract-type'> <i class='icon-secondary icon-briefcase'></i> CDI </li>
        <li class='jobs-list-item-office'> <i class='icon-secondary icon-location'></i> Toulouse </li>
      </ul>
    </a></li>
  <li class='jobs-list-item' data-department='38207' data-office='28372'>
    <a class="jobs-list-item-link" href="/jobs/charge-e-d-approvisionnement_paris"><h3 class='jobs-list-item-title'> Charg&eacute;.e d&#39;approvisionnement </h3>
      <ul class='jobs-list-item-details'>
        <li class='jobs-list-item-office'> <i class='icon-secondary icon-location'></i> Paris </li>
      </ul>
    </a></li>
  <li class='jobs-list-item' data-department='38208' data-office='28372'>
    <a class="jobs-list-item-link" href="/jobs/data-platform-engineer_toulouse"><h3 class='jobs-list-item-title'> Data Platform Engineer </h3></a></li>
</ul></body></html>`;

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/welcomekit.mjs')).href);
  const welcomekit = mod.default;
  const { parseWelcomekitBoard, origineBoard } = mod;

  if (welcomekit.id === 'welcomekit') pass('welcomekit.id vaut "welcomekit"');
  else fail(`welcomekit.id vaut ${JSON.stringify(welcomekit.id)}`);

  const offres = parseWelcomekitBoard(BOARD, 'https://nutripure.welcomekit.co/', 'Nutripure');

  // Trois blocs, mais le troisième répète l'URL du premier : la clé de dédup du
  // scanner est l'URL, donc deux postes listés sous deux départements ne doivent
  // pas compter double.
  if (offres.length === 2) pass('les offres sont parsées et dédupliquées par URL');
  else fail(`parseWelcomekitBoard rend ${offres.length} offre(s) : ${JSON.stringify(offres)}`);

  const premiere = offres[0];
  if (
    premiere?.title === 'Data Platform Engineer' &&
    premiere?.url === 'https://nutripure.welcomekit.co/jobs/data-platform-engineer_toulouse' &&
    premiere?.company === 'Nutripure' &&
    premiere?.location === 'Toulouse'
  ) {
    pass('titre, URL absolue, entreprise et lieu sont remontés');
  } else {
    fail(`première offre inattendue : ${JSON.stringify(premiere)}`);
  }

  // L'icône `<i>` précède le lieu dans le balisage : sans retrait des balises,
  // `location` vaudrait l'icône plus le texte.
  if (!/icon|<|>/.test(String(premiere?.location))) pass('le lieu ne traîne pas de balisage');
  else fail(`lieu pollué : ${JSON.stringify(premiere?.location)}`);

  // Les entités HTML doivent être décodées : « Chargé.e d'approvisionnement »,
  // pas « Charg&eacute;.e d&#39;... », sinon le filtre de mots-clés du scanner
  // ne reconnaît plus le titre.
  if (offres[1]?.title === "Chargé.e d'approvisionnement") pass('les entités HTML du titre sont décodées');
  else fail(`titre non décodé : ${JSON.stringify(offres[1]?.title)}`);

  // Un document sans la moindre offre (slug inconnu : le board répond 200 avec un
  // corps minuscule) ne doit rien produire — c'est ce qui permet à
  // verify-portals de ne PAS le prendre pour un locataire existant.
  if (parseWelcomekitBoard('<html><body>rien ici</body></html>', 'https://x.welcomekit.co/').length === 0) {
    pass('un board vide rend zéro offre');
  } else {
    fail('un board vide a produit des offres');
  }

  if (parseWelcomekitBoard('', 'https://x.welcomekit.co/').length === 0 && parseWelcomekitBoard(null, 'https://x.welcomekit.co/').length === 0) {
    pass('une entrée vide ou nulle ne fait pas tomber le parseur');
  } else {
    fail('parseWelcomekitBoard mal protégé contre une entrée vide');
  }

  // ── Épinglage de l'hôte ──────────────────────────────────────────────────
  const parCareers = welcomekit.detect({ name: 'Nutripure', careers_url: 'https://nutripure.welcomekit.co/' });
  const parApi = welcomekit.detect({ name: 'Nutripure', api: 'https://nutripure.welcomekit.co/' });
  if (parCareers?.url === 'https://nutripure.welcomekit.co/' && parApi?.url === 'https://nutripure.welcomekit.co/') {
    pass('detect() revendique un board *.welcomekit.co, par careers_url comme par api');
  } else {
    fail(`detect() sur URL légitime = ${JSON.stringify({ parCareers, parApi })}`);
  }

  const refus = [
    { cas: 'http', entree: { careers_url: 'http://nutripure.welcomekit.co/' } },
    { cas: 'hôte contrefait', entree: { careers_url: 'https://evil.example/nutripure.welcomekit.co' } },
    { cas: 'suffixe usurpé', entree: { careers_url: 'https://welcomekit.co.evil.example/' } },
    { cas: 'domaine nu', entree: { careers_url: 'https://welcomekit.co/' } },
    { cas: 'autre ATS', entree: { careers_url: 'https://jobs.lever.co/acme' } },
    { cas: 'sans URL', entree: { name: 'Acme' } },
  ];
  const fuites = refus.filter((r) => origineBoard(r.entree) !== null).map((r) => r.cas);
  if (fuites.length === 0) pass('aucune URL non-welcomekit ne passe pour un board');
  else fail(`origineBoard() a accepté : ${fuites.join(', ')}`);

  // fetch() doit refuser franchement plutôt que d'aller chercher n'importe quoi.
  let refusFetch = false;
  try {
    await welcomekit.fetch({ name: 'Acme', careers_url: 'https://jobs.lever.co/acme' }, { fetchText: async () => BOARD });
  } catch {
    refusFetch = true;
  }
  if (refusFetch) pass('fetch() refuse une entrée qui n’est pas un board welcomekit');
  else fail('fetch() a accepté une entrée non-welcomekit');

  // Chemin nominal : une seule requête texte, aucune pagination (le board rend
  // tous ses postes d'un coup — vérifié sur le vrai board).
  let requetes = 0;
  const jobs = await welcomekit.fetch(
    { name: 'Nutripure', careers_url: 'https://nutripure.welcomekit.co/' },
    { fetchText: async () => { requetes += 1; return BOARD; } },
  );
  if (jobs.length === 2 && requetes === 1) pass('fetch() rend les offres en une seule requête');
  else fail(`fetch() : ${jobs.length} offre(s) en ${requetes} requête(s)`);
} catch (e) {
  fail(`les tests du provider welcomekit ont planté : ${e.message}`);
}
