// tests/scan-only-section.test.mjs — `scan.mjs --only boards|companies`.
//
// WHY THIS FLAG EXISTS, and therefore what these tests protect. `job_boards` is
// read ONLY by scan.mjs, while the automatable endpoint (`GET /api/scan`, the
// shape a cron calls) runs scan-ats-full.mjs, which walks ATS DIRECTORIES and
// reads neither `job_boards` nor `tracked_companies`. A board could sit
// `enabled: true` in portals.yml for months without a single automated sweep
// touching it — observed 2026-08-14 on a long-enabled `SolidJobs IT` entry.
//
// A full `node scan.mjs` was not an option for that caller: it also walks every
// tracked company (116 in a real config, minutes of network) and the route is
// capped at 300 s. Hence a section switch.
//
// The scope selection itself is asserted on the source, in the style of the
// suite's "local parser contract" section: executing it for real would fetch
// every configured board over the network, which a unit test must not do.
import { pass, fail, run, NODE, ROOT, lastRunFailure } from './helpers.mjs';
import { readFileSync } from 'fs';
import { join } from 'path';

console.log('\nscan.mjs — --only boards|companies (section switch)');

try {
  const src = readFileSync(join(ROOT, 'scan.mjs'), 'utf-8');

  // Both branches must be guarded, and guarded the right way round. Inverting
  // them is the one mistake that would be invisible in production: a cron asking
  // for boards would happily sweep 116 companies until the route timed out.
  if (src.includes("if (onlySection !== 'boards') resolveEntries(companies);")) {
    pass('--only boards skips tracked_companies');
  } else {
    fail('scan.mjs does not guard resolveEntries(companies) with onlySection');
  }
  if (src.includes("if (onlySection !== 'companies') resolveEntries(boards, { isBoard: true });")) {
    pass('--only companies skips job_boards');
  } else {
    fail('scan.mjs does not guard resolveEntries(boards) with onlySection');
  }

  // The default must stay "everything": this flag is an addition, and a missing
  // `--only` has to behave exactly as it did before it existed. The absent flag
  // and a present-but-empty value are resolved SEPARATELY — see the missing-value
  // check below for why conflating them swept the whole config.
  if (
    src.includes("const onlySection = onlyFlag === -1 ? '' : onlyValue;") &&
    src.includes("['all', 'boards', 'companies'].includes(onlyValue)")
  ) {
    pass("no --only means 'all' (existing callers keep their behaviour)");
  } else {
    fail('scan.mjs does not default --only to the full sweep');
  }

  // The restriction has to be printed. Otherwise "Scanning 0 companies" reads as
  // a broken portals.yml rather than as the subset that was requested.
  if (src.includes('(--only ${onlySection})') || src.includes('--only ${onlySection}')) {
    pass('the sweep announces its restriction in the scan header');
  } else {
    fail('scan.mjs does not print which section it restricted the sweep to');
  }

  // -- A typo must EXIT, not silently fall back to a full sweep ---------------
  // This one runs for real: it is pure argument parsing, so it exits before any
  // config is read and before a single request is made.
  const bad = run(NODE, ['scan.mjs', '--only', 'bords', '--dry-run']);
  const failure = lastRunFailure();
  if (bad === null && failure && failure.status === 1) {
    pass('an unknown --only value exits 1 instead of scanning everything');
  } else {
    fail(`--only bords should exit 1, got ${JSON.stringify({ stdout: bad, status: failure?.status ?? null })}`);
  }
  if (failure && /--only accepts "boards", "companies" or "all"/.test(failure.stderr)) {
    pass('the error names the accepted values');
  } else {
    fail(`--only error message = ${JSON.stringify(failure?.stderr?.slice(0, 200) ?? null)}`);
  }

  // A missing value must be rejected too. This is not hypothetical: `--only` as
  // the last argument first read as an empty string, passed for "no
  // restriction", and swept every tracked company — `--dry-run` is kept here so
  // that a regression costs a network sweep and not a write to pipeline.md.
  const missing = run(NODE, ['scan.mjs', '--only', '--dry-run']);
  const missingFailure = lastRunFailure();
  if (missing === null && missingFailure && missingFailure.status === 1) {
    pass('--only with no value exits 1');
  } else {
    fail(`--only with no value should exit 1, got status ${missingFailure?.status ?? 'success'}`);
  }

  // -- The endpoint must actually use it -------------------------------------
  const route = readFileSync(join(ROOT, 'web/src/app/api/scan/route.ts'), 'utf-8');
  if (route.includes('lancerScanSection("boards"')) {
    pass('GET /api/scan sweeps the portals.yml boards via --only boards');
  } else {
    fail('GET /api/scan does not launch the board sweep');
  }
  // The companies sweep was the second half of the same blind spot:
  // scan-ats-full.mjs reads neither section, so 119 tracked companies were swept
  // by nothing automatic. Measured before wiring it: 22 s, 144 fresh offers.
  if (route.includes('lancerScanSection("companies"')) {
    pass('GET /api/scan also sweeps the tracked companies via --only companies');
  } else {
    fail('GET /api/scan does not launch the company sweep — the 119 tracked companies stay unswept');
  }
  // Order = budget. The three share the route's 300 s ceiling; the directory
  // sweep is the one that saturates its own `limit` and already says so through
  // `plafond_atteint`, so it goes LAST. Reversing would drop the two portals.yml
  // sweeps on a timeout instead, silently.
  const iBoards = route.indexOf('lancerScanSection("boards"');
  const iCompanies = route.indexOf('lancerScanSection("companies"');
  const iAnnuaires = route.indexOf('await lancerScan(args');
  if (iBoards < iCompanies && iCompanies < iAnnuaires) {
    pass('order is boards -> companies -> directories (the saturating sweep runs last)');
  } else {
    fail(`sweep order is wrong: boards@${iBoards}, companies@${iCompanies}, directories@${iAnnuaires}`);
  }
  if (route.includes('sp.get("boards") !== "0"') && route.includes('sp.get("companies") !== "0"')) {
    pass('both portals.yml sweeps are on by default and cuttable with boards=0 / companies=0');
  } else {
    fail('GET /api/scan lacks a boards=0 or companies=0 switch');
  }
  // Separate counter blocks: three sources, three measurements, or nobody can
  // tell which one is producing.
  if (/entreprises:\s*entreprises/.test(route) && /boards:\s*boards/.test(route)) {
    pass('the response reports the two sweeps separately');
  } else {
    fail('the response merges or omits a sweep block');
  }
} catch (e) {
  fail(`--only section tests crashed: ${e.message}`);
}
