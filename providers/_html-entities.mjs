// @ts-check
// Minimal HTML entity decoder shared by the scraping providers whose sources
// return raw HTML (as opposed to a JSON API). Handles named entities (&amp;,
// &lt;, …) and numeric entities (&#252; / &#xfc;).
//
// Previously duplicated verbatim across deutschebahn.mjs and hecklerkoch.mjs
// (CodeRabbit finding on #1555) — same drift risk flagged separately on
// successfactors.mjs/dassault.mjs/softgarden.mjs/rheinmetall.mjs (#1639),
// where a numeric-entity range guard drifted out of sync between copies:
// checking only Number.isFinite still lets String.fromCodePoint throw a
// RangeError for a code point above 0x10FFFF (e.g. `&#99999999;`), crashing
// the entire parse for a single malformed/adversarial entity. Centralized
// here so the guard can't diverge again.
//
// The hex/decimal alternatives are matched separately (not "#x?[0-9a-fA-F]+")
// so a decimal entity can never absorb trailing hex letters — "&#1a2;" no
// longer silently parses as codepoint 1 and drops "a2"; it just fails to
// match and passes through untouched, same as any other malformed entity.
// Les cinq entités XML + nbsp, PLUS les lettres accentuées Latin-1. Ces
// dernières ont été ajoutées le 2026-08-12 en écrivant le provider welcomekit :
// un décodeur qui laisse passer `&eacute;` rend « Charg&eacute;.e » comme titre
// d'offre, et le filtre de mots-clés du scanner ne reconnaît alors plus le
// poste. Le trou concernait tous les boards français, italiens, espagnols et
// allemands scrapés en HTML, pas seulement celui-là.
//
// Volontairement limité à Latin-1 : une table HTML5 complète (2 231 entrées)
// n'a pas sa place ici, et ce sont les accents qui apparaissent dans des
// intitulés de poste.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Lettres accentuées, en minuscules. La variante capitale (`&Eacute;`) est
// dérivée juste en dessous plutôt qu'écrite à la main : deux tables se
// désynchronisent.
const LETTRES_ACCENTUEES = {
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', oelig: 'œ',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ',
};

// Signes et ponctuation sans casse.
const SIGNES = {
  szlig: 'ß', deg: '°', euro: '€', pound: '£', laquo: '«', raquo: '»',
  hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

for (const [nom, valeur] of Object.entries(LETTRES_ACCENTUEES)) {
  NAMED_ENTITIES[nom] = valeur;
  const majuscule = valeur.toUpperCase();
  // `ß`.toUpperCase() vaut « SS » : on n'ajoute une capitale que si elle reste
  // une seule lettre, sinon `&SZLIG;` rendrait deux caractères.
  if (majuscule.length === 1 && majuscule !== valeur) {
    NAMED_ENTITIES[nom[0].toUpperCase() + nom.slice(1)] = majuscule;
  }
}
Object.assign(NAMED_ENTITIES, SIGNES);

/** @param {string} s */
export function decodeEntities(s) {
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      // A lone surrogate half (0xD800-0xDFFF) is a valid codepoint per spec —
      // fromCodePoint won't throw for it — but it's not a valid Unicode scalar
      // value, so we still reject it defensively rather than emit an
      // ill-formed string.
      const valid = Number.isFinite(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : m;
    }
    // La casse EXACTE d'abord : `&Eacute;` doit rendre « É », pas « é ». Le repli
    // insensible à la casse ne sert qu'aux entités sans capitale distincte
    // (`&AMP;`, `&NBSP;`), dont c'était le comportement historique.
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}
