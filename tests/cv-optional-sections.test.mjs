// tests/cv-optional-sections.test.mjs — the optional CV sections (projects,
// education, certifications, awards, references) must vanish entirely when they
// have no entries, rather than rendering a bare section header with nothing
// under it.
//
// #1879 fixed this for projects; education is the same bug (not every
// candidate has a degree). Certifications was fixed once directly in
// build-cv-html.mjs, then lost when that logic was generalized into this
// shared module (only projects/education made the cut) — the v1.22.0
// auto-update shipped that regression. Awards (#2220) is optional by
// construction: most candidates have none, so it ships hidden-when-empty from
// the start rather than being retrofitted. All four are delimited by marker
// matching rather than parsed, so the boundary pattern is the whole
// correctness story — see the header comment in cv-sections-core.mjs for the
// failure modes exercised here.
import { readFileSync } from 'fs';
import { join } from 'path';
import { pass, fail, ROOT } from './helpers.mjs';
import { stripEmptySections } from '../cv-sections-core.mjs';

console.log('\ncv-sections-core.mjs — optional sections leave no bare header');

// Every optional section, so `FULL` really means "nothing to strip". A section
// added to OPTIONAL_SECTIONS without being added here makes the
// "populated payload leaves the template unchanged" check fail — which is the
// point: the fixture is the enumeration.
const EMPTY = { projects: [], education: [], certifications: [], awards: [], references: [] };
const FULL = {
  projects: [{ name: 'P' }],
  education: [{ degree: 'D' }],
  certifications: [{ title: 'C' }],
  awards: [{ title: 'A' }],
  references: [{ name: 'R' }],
};

function check(label, actual, expected) {
  if (actual === expected) pass(label);
  else fail(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- Real templates: the sections must actually disappear ------------------
// Assert against the shipped templates so a template edit that renames or
// reorders a marker fails here instead of silently reviving the bare header.
const TEMPLATES = [
  { file: 'templates/cv-template.html', format: 'html', after: 'SKILLS', hasCertifications: true },
  { file: 'templates/resume-template.html', format: 'html', after: 'SKILLS', hasCertifications: false },
  { file: 'templates/cv-template.tex', format: 'tex', after: 'Technical Skills', hasCertifications: false },
];

for (const { file, format, after, hasCertifications } of TEMPLATES) {
  const template = readFileSync(join(ROOT, file), 'utf-8');
  const name = file.split('/').pop();

  const stripped = stripEmptySections(template, EMPTY, format);
  const projectsMarker = format === 'html' ? '<!-- PROJECTS -->' : 'PROJECTS  %';
  const educationMarker = format === 'html' ? '<!-- EDUCATION -->' : 'Education  %';
  const certificationsMarker = '<!-- CERTIFICATIONS -->'; // html-only; no LaTeX Certifications section exists
  const awardsMarker = format === 'html' ? '<!-- AWARDS -->' : 'AWARDS  %';

  check(`${name}: empty payload removes the projects block`, stripped.includes(projectsMarker), false);
  check(`${name}: empty payload removes the education block`, stripped.includes(educationMarker), false);
  if (hasCertifications) {
    check(`${name}: empty payload removes the certifications block`, stripped.includes(certificationsMarker), false);
  }
  check(`${name}: empty payload removes the awards block`, stripped.includes(awardsMarker), false);
  check(`${name}: the section after awards survives`, stripped.includes(after), true);
  check(`${name}: {{EXPERIENCE}} is untouched`, stripped.includes('{{EXPERIENCE}}'), true);

  // Populated payload must be a no-op — the strip only ever removes.
  check(`${name}: populated payload leaves the template unchanged`,
    stripEmptySections(template, FULL, format) === template, true);

  // One empty, one populated: only the empty one goes.
  const onlyEdu = stripEmptySections(template, { ...FULL, education: [] }, format);
  check(`${name}: empty education alone keeps projects`, onlyEdu.includes(projectsMarker), true);
  check(`${name}: empty education alone drops education`, onlyEdu.includes(educationMarker), false);
  check(`${name}: empty education alone keeps awards`, onlyEdu.includes(awardsMarker), true);
  if (hasCertifications) {
    check(`${name}: empty education alone keeps certifications`, onlyEdu.includes(certificationsMarker), true);

    // Certifications empty on its own: projects/education (both populated) survive, only certifications goes.
    const onlyCert = stripEmptySections(template, { ...FULL, certifications: [] }, format);
    check(`${name}: empty certifications alone keeps projects`, onlyCert.includes(projectsMarker), true);
    check(`${name}: empty certifications alone keeps education`, onlyCert.includes(educationMarker), true);
    check(`${name}: empty certifications alone drops certifications`, onlyCert.includes(certificationsMarker), false);
    check(`${name}: empty certifications alone keeps awards`, onlyCert.includes(awardsMarker), true);
  }

  // Awards empty on its own: it is last among the optional sections in the HTML
  // templates, so an end-of-block boundary slip here would swallow Skills.
  const onlyAwards = stripEmptySections(template, { ...FULL, awards: [] }, format);
  check(`${name}: empty awards alone keeps projects`, onlyAwards.includes(projectsMarker), true);
  check(`${name}: empty awards alone keeps education`, onlyAwards.includes(educationMarker), true);
  check(`${name}: empty awards alone drops awards`, onlyAwards.includes(awardsMarker), false);
  check(`${name}: empty awards alone keeps the section after it`, onlyAwards.includes(after), true);
  if (hasCertifications) {
    check(`${name}: empty awards alone keeps certifications`, onlyAwards.includes(certificationsMarker), true);
  }
}

// --- Boundary edge cases ---------------------------------------------------
// Each of these silently reintroduces the bare header if the boundary pattern
// is written loosely.

// A non-marker comment inside a section body is not a boundary. A lookahead of
// `(?=<!-- [A-Z])` stops here and strands the rest of the block.
const internalComment = [
  '<!-- PROJECTS -->',
  '<div class="section">',
  '  <!-- Main block -->',
  '  <div class="section-title">Projects</div>',
  '</div>',
  '<!-- EDUCATION -->',
  'keep me',
].join('\n');
// Only projects is empty here: with EMPTY, education would also be stripped to
// end of input and the fixture could not distinguish a correct strip from an
// over-broad one.
check('an ordinary comment inside the body is not treated as a boundary',
  stripEmptySections(internalComment, { projects: [], education: [{ degree: 'D' }] }, 'html'),
  '<!-- EDUCATION -->\nkeep me');

// A section that is last in the template still gets removed. Without an
// end-of-input branch there is no boundary to stop at and the strip no-ops.
check('html: a trailing optional section is removed at end of template',
  stripEmptySections('<!-- HEADER -->\nkeep\n<!-- PROJECTS -->\n<div>drop</div>\n', EMPTY, 'html').trim(),
  '<!-- HEADER -->\nkeep');

check('tex: a trailing optional section is removed at end of document',
  stripEmptySections('%%%%  Heading  %%%%\nkeep\n%%%%  PROJECTS  %%%%\ndrop\n', EMPTY, 'tex').trim(),
  '%%%%  Heading  %%%%\nkeep');

// Stripping one section must not depend on the other still being present: a
// lookahead naming `<!-- EDUCATION -->` breaks once education is removed.
const bothEmpty = [
  '<!-- PROJECTS -->',
  '<div>projects body</div>',
  '<!-- EDUCATION -->',
  '<div>education body</div>',
  '<!-- SKILLS -->',
  'skills',
].join('\n');
check('both sections empty: neither body survives',
  stripEmptySections(bothEmpty, EMPTY, 'html'),
  '<!-- SKILLS -->\nskills');

// A missing key is as empty as an empty array — payloads routinely omit these.
check('an absent projects key is treated as empty',
  stripEmptySections(bothEmpty, {}, 'html'),
  '<!-- SKILLS -->\nskills');

// An unknown format is a programming error, not a silent pass-through.
let threw = false;
try { stripEmptySections('x', EMPTY, 'pdf'); } catch { threw = true; }
check('an unknown template format throws', threw, true);

// --- References (added 2026-08-14) ----------------------------------------
// References is the only optional section placed LAST in cv-template.html, which
// makes it the one case where a loose boundary destroys the document instead of
// merely leaving a bare header: with nothing to stop at, the pattern runs to end
// of input and takes `</div></body></html>` with it. The template therefore
// carries an `<!-- END -->` sentinel, and these checks are what keep it there.
{
  const template = readFileSync(join(ROOT, 'templates/cv-template.html'), 'utf-8');
  const AVEC = { ...FULL, references: [{ name: 'R', role: 'Role' }] };
  const SANS = { ...FULL, references: [] };

  check('references: the sentinel that bounds the last section is present',
    template.includes('<!-- END -->'), true);

  const gardee = stripEmptySections(template, AVEC, 'html');
  check('references: a populated section survives', gardee.includes('<!-- REFERENCES -->'), true);

  const retiree = stripEmptySections(template, SANS, 'html');
  check('references: an empty section is removed', retiree.includes('<!-- REFERENCES -->'), false);
  check('references: no bare header is left behind',
    retiree.includes('{{SECTION_REFERENCES}}'), false);
  // LE point porteur : le document doit rester du HTML clos.
  check('references: removing the last section keeps the closing tags',
    /<\/div>\s*<\/body>\s*<\/html>\s*$/.test(retiree.trim() + '\n'), true);
  check('references: the section before it survives', retiree.includes('<!-- SKILLS -->'), true);

  // Sans la sentinelle, la meme suppression emporterait la fin du document :
  // c'est la demonstration de ce qu'elle protege.
  const sansSentinelle = template.replace('<!-- END -->', '');
  const casse = stripEmptySections(sansSentinelle, SANS, 'html');
  check('references: without the sentinel the closing tags would be swallowed',
    /<\/body>/.test(casse), false);
}
