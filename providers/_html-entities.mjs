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
// The five XML entities + nbsp, PLUS the Latin-1 accented letters. The latter
// were added 2026-08-12 while writing the welcomekit provider: a decoder that
// lets `&eacute;` through renders a job title as "Charg&eacute;.e", and the
// scanner's keyword filter then stops recognizing the role. The gap affected
// every French, Italian, Spanish and German board scraped as HTML, not just
// that one.
//
// Deliberately limited to Latin-1: a full HTML5 table (2,231 entries) does not
// belong here, and accents are what actually appear in job titles.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

// Accented letters, lowercase. The capital variant (`&Eacute;`) is derived just
// below rather than spelled out: two hand-maintained tables drift apart.
const ACCENTED_LETTERS = {
  agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ',
  ccedil: 'ç',
  egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë',
  igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï',
  ntilde: 'ñ',
  ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø', oelig: 'œ',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', yuml: 'ÿ',
};

// Case-less signs and punctuation.
const SIGNS = {
  szlig: 'ß', deg: '°', euro: '€', pound: '£', laquo: '«', raquo: '»',
  hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
};

for (const [name, value] of Object.entries(ACCENTED_LETTERS)) {
  NAMED_ENTITIES[name] = value;
  const upper = value.toUpperCase();
  // `ß`.toUpperCase() is "SS": only add a capital when it stays a SINGLE letter,
  // otherwise `&SZLIG;` would decode to two characters.
  if (upper.length === 1 && upper !== value) {
    NAMED_ENTITIES[name[0].toUpperCase() + name.slice(1)] = upper;
  }
}
Object.assign(NAMED_ENTITIES, SIGNS);

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
    // EXACT case first: `&Eacute;` must decode to "É", not "é". The
    // case-insensitive fallback only serves entities with no distinct capital
    // (`&AMP;`, `&NBSP;`), which was the historical behavior.
    return NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? m;
  });
}
