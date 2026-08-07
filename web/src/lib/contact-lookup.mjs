/**
 * contact-lookup.mjs — trouver le courriel du recruteur. Partie pure.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * Le workflow 3 n'envoie une candidature que s'il connaît une adresse. Or les
 * offres France Travail n'en portent aucune : vérifié le 2026-08-07 sur les 6
 * offres du journal (`contactEmail` n'existe même pas dans leur forme) et sur la
 * page d'une annonce (55 Ko rendus, zéro adresse). Sans enrichissement, TOUTES
 * les candidatures partent en dépôt manuel et la branche d'envoi ne sert jamais.
 *
 * LA RÈGLE QUI GOUVERNE TOUT CE MODULE : on ne DEVINE jamais une adresse.
 * -----------------------------------------------------------------------
 * Fabriquer `recrutement@<domaine>` parce que ça « marche souvent » est la seule
 * chose qu'il ne faut pas faire ici : une candidature est irrattrapable une fois
 * partie, et une adresse inventée atterrit au mieux dans le vide, au pire chez
 * quelqu'un qui n'a rien demandé. Toute adresse rendue par ce module a été lue
 * LITTÉRALEMENT dans une source : le carnet d'adresses de Linéo, ou le texte de
 * l'annonce. Quand rien n'est trouvé, on rend `null` et le dépôt manuel reprend
 * la main — c'est un résultat correct, pas un échec.
 */

/** Une adresse dans du texte libre. Volontairement stricte sur le TLD. */
const COURRIEL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Boîtes qui n'écoutent personne, ou qui ne sont pas là pour ça. Envoyer une
 * candidature à `noreply@` la perd en silence ; à `dpo@` elle dérange un juriste.
 */
const LOCAUX_EXCLUS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "ne-pas-repondre", "nepasrepondre",
  "postmaster", "webmaster", "hostmaster", "abuse", "mailer-daemon", "bounce", "bounces",
  "dpo", "rgpd", "privacy", "legal", "juridique", "security", "securite", "sécurité",
  "newsletter", "notifications", "notification", "alerte", "alertes",
]);

/**
 * Domaines de plateformes : l'adresse trouvée sur ces pages appartient au site
 * d'annonces, jamais à l'employeur. Y écrire, c'est écrire au facteur.
 */
const DOMAINES_EXCLUS = [
  "francetravail.fr", "pole-emploi.fr", "pole-emploi.org", "candidat.francetravail.fr",
  "indeed.com", "indeed.fr", "linkedin.com", "welcometothejungle.com", "apec.fr",
  "monster.fr", "hellowork.com", "talents-handicap.com", "glassdoor.fr", "jobteaser.com",
  "example.com", "example.org", "domain.com", "sentry.io", "googlemail.com",
  "w3.org", "schema.org", "googleapis.com", "gstatic.com", "cloudflare.com",
];

/**
 * Parties locales qui désignent explicitement le recrutement. C'est le signal le
 * plus fort après le carnet d'adresses : une entreprise qui publie
 * `recrutement@` demande qu'on lui écrive là.
 */
const LOCAUX_RECRUTEMENT = [
  "recrutement", "recrutements", "recrute", "recruteur", "recruiting", "recruitment",
  "rh", "hr", "drh", "job", "jobs", "emploi", "emplois", "carriere", "carrieres",
  "career", "careers", "candidature", "candidatures", "apply", "talent", "talents",
  "hiring", "stage", "stages", "alternance",
];

/** Boîtes génériques acceptables en dernier recours : elles lisent le courrier. */
const LOCAUX_GENERIQUES = ["contact", "info", "infos", "bonjour", "hello", "accueil"];

/**
 * Lit `data/contacts.tsv` — le carnet d'adresses de Linéo.
 *
 * Schéma canonique dans `contacts.mjs` (l'exportateur vCard) :
 *   {name}\t{company}\t{type}\t{title}\t{phone}\t{email}\t{linkedin}\t{tracker#}\t{notes}
 *
 * On ne réutilise pas `parseContacts` de ce fichier-là parce qu'il vit à la
 * racine, hors du bundle Next : l'importer demanderait un sous-processus (cf.
 * core/pipeline.ts) pour lire trois colonnes. Ce lecteur ne prend QUE nom,
 * entreprise, type et courriel, et ignore le reste — il ne peut donc pas
 * diverger sur les colonnes qu'il ne regarde pas. Même contrat que l'original :
 * on saute les commentaires et les lignes trop courtes, on ne jette jamais.
 */
export function parseCarnet(contenu) {
  const out = [];
  for (const ligne of String(contenu ?? "").split(/\r?\n/)) {
    const l = ligne.trim();
    if (!l || l.startsWith("#")) continue;
    const c = ligne.split("\t");
    if (c.length < 4) continue;
    const name = (c[0] ?? "").trim();
    const company = (c[1] ?? "").trim();
    if (!name || !company) continue;
    out.push({ name, company, type: (c[2] ?? "").trim().toLowerCase(), email: (c[5] ?? "").trim() });
  }
  return out;
}

/** Plie une chaîne pour comparer un nom d'entreprise à un nom de domaine. */
export function normaliseNom(v) {
  return String(v ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Toutes les adresses présentes dans un texte, dédupliquées, en minuscules.
 *
 * La casse est pliée parce qu'une même boîte écrite `RH@Acme.fr` et `rh@acme.fr`
 * est une seule boîte : les garder séparées ferait remonter deux « candidats »
 * pour une seule adresse et fausserait le choix.
 */
export function extraitCourriels(texte) {
  const vus = new Set();
  for (const brut of String(texte ?? "").match(COURRIEL_RE) ?? []) {
    // Une adresse collée à de la ponctuation de fin ("...à rh@acme.fr.") sort
    // avec le point : il n'appartient pas au domaine.
    vus.add(brut.toLowerCase().replace(/[.,;:)\]]+$/, ""));
  }
  return [...vus];
}

/** Découpe une adresse, ou null si elle est malformée. */
function decoupe(courriel) {
  const i = String(courriel ?? "").lastIndexOf("@");
  if (i <= 0) return null;
  const local = courriel.slice(0, i).toLowerCase();
  const domaine = courriel.slice(i + 1).toLowerCase();
  if (!local || !domaine.includes(".")) return null;
  return { local, domaine };
}

/** Le domaine est-il celui d'une plateforme d'annonces (ou un faux positif) ? */
export function domaineExclu(domaine) {
  const d = String(domaine ?? "").toLowerCase();
  return DOMAINES_EXCLUS.some((x) => d === x || d.endsWith(`.${x}`));
}

/** La partie locale désigne-t-elle le recrutement ? */
export function localRecrutement(local) {
  // Séparateurs seulement : `recrutement.fr@` compte, `precrutement@` non — et
  // surtout `rh` ne doit pas matcher au milieu de `sarah` ou `christophe`.
  const morceaux = String(local ?? "").toLowerCase().split(/[._+-]+/);
  return morceaux.some((m) => LOCAUX_RECRUTEMENT.includes(m));
}

/**
 * Note une adresse candidate et dit pourquoi.
 *
 * `retenable: false` n'est pas un rejet définitif : le candidat est quand même
 * remonté à l'appelant pour que Linéo le voie, mais il ne sera jamais utilisé
 * pour un envoi automatique.
 */
export function classeCandidat(courriel, entreprise = "") {
  const parts = decoupe(courriel);
  if (!parts) return { courriel, retenable: false, score: 0, motif: "adresse malformée" };
  const { local, domaine } = parts;

  if (LOCAUX_EXCLUS.has(local)) {
    return { courriel, retenable: false, score: 0, motif: `boîte non lue (${local}@)` };
  }
  if (domaineExclu(domaine)) {
    return { courriel, retenable: false, score: 0, motif: `domaine de plateforme (${domaine})` };
  }

  const nomEntreprise = normaliseNom(entreprise);
  const nomDomaine = normaliseNom(domaine.split(".").slice(0, -1).join(""));
  // Correspondance dans les deux sens : « Devoteam » ↔ devoteam.com, mais aussi
  // « Groupe Devoteam Consulting » ↔ devoteam.com.
  const memeMaison = Boolean(nomEntreprise) && Boolean(nomDomaine)
    && (nomDomaine.includes(nomEntreprise) || nomEntreprise.includes(nomDomaine));

  const recrutement = localRecrutement(local);
  const generique = LOCAUX_GENERIQUES.includes(local);

  if (recrutement && memeMaison) {
    return { courriel, retenable: true, score: 100, motif: "adresse de recrutement, domaine de l'entreprise" };
  }
  if (recrutement) {
    return { courriel, retenable: true, score: 80, motif: "adresse de recrutement" };
  }
  if (memeMaison && generique) {
    return { courriel, retenable: true, score: 60, motif: "boîte générique du domaine de l'entreprise" };
  }
  if (memeMaison) {
    return { courriel, retenable: true, score: 50, motif: "adresse nominative du domaine de l'entreprise" };
  }
  // Trouvée dans l'annonce, mais rien ne dit qu'elle a un rapport avec le poste :
  // ça peut être le prestataire qui héberge la page. Visible, jamais envoyée.
  return { courriel, retenable: false, score: 10, motif: "aucun lien établi avec l'entreprise" };
}

/** `haute` et `moyenne` sont envoyables ; en dessous, dépôt manuel. */
function confiancePour(score) {
  if (score >= 80) return "haute";
  if (score >= 50) return "moyenne";
  return "faible";
}

/**
 * Choisit UNE adresse, ou aucune.
 *
 * @param {object} args
 * @param {{name?:string, company?:string, type?:string, email?:string}[]} [args.carnet]
 *   Contacts de `data/contacts.tsv` (parseContacts de contacts.mjs).
 * @param {string[]} [args.textes] Textes où chercher : description de l'offre,
 *   page de l'annonce. L'ordre n'a pas d'importance, le score tranche.
 * @param {string} [args.entreprise]
 * @returns {{courriel: string|null, source: string|null, confiance: string,
 *            motif: string, candidats: object[]}}
 */
export function choisitContact({ carnet = [], textes = [], entreprise = "" } = {}) {
  // ── 1. Le carnet d'adresses de Linéo ────────────────────────────────────
  // Il passe avant tout : c'est lui qui l'a écrit, souvent après un vrai
  // échange. Aucune heuristique ne vaut ça.
  const cleEntreprise = normaliseNom(entreprise);
  const duCarnet = (Array.isArray(carnet) ? carnet : [])
    .filter((c) => c && String(c.email ?? "").includes("@") && normaliseNom(c.company) === cleEntreprise)
    // Un recruteur avant un pair : c'est lui qui traite les candidatures.
    .sort((a, b) => (a.type === "recruiter" ? -1 : 0) - (b.type === "recruiter" ? -1 : 0));

  if (duCarnet.length > 0) {
    const c = duCarnet[0];
    return {
      courriel: String(c.email).trim().toLowerCase(),
      source: "carnet",
      confiance: "haute",
      motif: `carnet d'adresses${c.name ? ` (${c.name})` : ""}`,
      candidats: [],
    };
  }

  // ── 2. Les adresses littéralement présentes dans les textes ─────────────
  const trouvees = new Set();
  for (const t of textes) for (const e of extraitCourriels(t)) trouvees.add(e);

  const candidats = [...trouvees]
    .map((e) => classeCandidat(e, entreprise))
    .sort((a, b) => b.score - a.score);

  const meilleur = candidats.find((c) => c.retenable) ?? null;
  if (!meilleur) {
    return {
      courriel: null,
      source: null,
      confiance: "aucune",
      motif: candidats.length
        ? "aucune adresse exploitable parmi celles trouvées"
        : "aucune adresse dans l'annonce",
      candidats,
    };
  }

  return {
    courriel: meilleur.courriel,
    source: "annonce",
    confiance: confiancePour(meilleur.score),
    motif: meilleur.motif,
    candidats,
  };
}
