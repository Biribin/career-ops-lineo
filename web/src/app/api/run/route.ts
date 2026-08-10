import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildChain, spawnTarget, type Runner } from "@/lib/clis";
import { careerOpsRoot, readMemory, findReportFile } from "@/lib/career-ops";
import { resolvePdfPaths, type PdfPaths } from "@/lib/pdf-paths.mjs";
import { renderAndMarkPdf } from "@/lib/pdf-render.mjs";
import { cheminsCvYaml, contexteCvYaml, promptCvYaml, verifieCvAdapte } from "@/lib/cv-adapt.mjs";
import { acquireTrackerWrite, releaseTrackerWrite } from "@/lib/core/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800; // a real oferta evaluation / pdf-mode CV tailoring + render is heavy and multi-step

// The web ORCHESTRATES the real career-ops engine — it does NOT reimplement it.
// kind "evaluate" runs the REAL modes/oferta.md and persists the canonical
// artifacts (A–F report + tracker row) via the SAME scripts the CLI uses
// (reserve-report-num.mjs → reports/ → batch/tracker-additions/ → merge-tracker.mjs),
// so a web evaluation is byte-identical to a CLI one (single source of truth, no
// drift). kind "research" stays read-only. Streams progress as NDJSON events.
//
// RESILIENCE CHAIN (buildChain): the CLI saved in Configuration is tried first;
// if it fails to produce a clean, real result, the run falls through to Gemini's
// free tiers (Google login, then API keys with auto-rotation) — the user sees a
// soft "bascule…" status and the next CLI takes over on the SAME stream. Only the
// last attempt's failure surfaces as a terminal error.
type CvYamlPaths = { dir: string; original: string; contexte: string; sortie: string };
type BuildPromptArgs = {
  kind: string;
  input: string;
  memory: string;
  today: string;
  pdfPaths?: PdfPaths;
  cvYamlPaths?: CvYamlPaths;
};

function buildPrompt({ kind, input, memory, today, pdfPaths, cvYamlPaths }: BuildPromptArgs): string {
  const mem = memory.trim() ? `\n\nDurable notes about the user (from their profile):\n${memory.trim()}\n` : "";
  if (kind === "cv-yaml" && cvYamlPaths) {
    // Le skill « adapter le CV YAML du repo cv à une offre » (workflow n8n 2).
    // L'instruction et les garde-fous vivent dans lib/cv-adapt.mjs, testés —
    // ils remplacent le prompt d'agent LangChain qui vivait dans n8n.
    return promptCvYaml({ chemins: cvYamlPaths });
  }
  if (kind === "research") {
    return `You are investigating the user's OWN work / portfolio to surface job-search-relevant strengths, headless. Investigate the target (use WebFetch for URLs; read local files if referenced) and report: what it is, why it is impressive, and how to leverage it in their job search — which roles/claims it supports and how to frame it on a CV. Be specific, honest, and encouraging.${mem}

End with EXACTLY one final line: VERDICT: {0-5 signal strength}/5 — {why it helps their search, ≤12 words}

Target: ${input}`;
  }
  if (kind === "pdf") {
    // The agent tailors content only — it never renders the PDF itself. Rendering
    // launches a real browser, which an agent CLI's own sandbox may block with no
    // human present to approve an escalation (headless/web-triggered run, #2172).
    // The backend (a plain Node process, no CLI sandbox) renders after this closes.
    return `You are tailoring the user's ATS-optimized CV for application #${input}, headless, on their machine. Run the REAL career-ops "pdf" mode's CONTENT step — follow modes/pdf.md EXACTLY for tailoring (do not improvise a format).
1. Read modes/pdf.md, cv.md, config/profile.yml, and the evaluation report at reports/${input}-*.md (for the JD keywords + analysis).
2. Tailor the CV per modes/pdf.md: inject the JD's keywords into the summary + first bullets, reorder experience by relevance, build the competency grid, pick the top 3–4 projects. NEVER invent skills — only reword REAL experience using the JD's vocabulary.
3. Fill templates/cv-template.html's {{...}} placeholders with the tailored content; write the HTML to EXACTLY this path: ${pdfPaths?.html}
4. Decide the page format for this company (letter for US/Canada, else a4) and write EXACTLY this JSON (nothing else) to EXACTLY this path: ${pdfPaths?.meta}
   {"format": "letter"} or {"format": "a4"}
Do NOT run generate-pdf.mjs yourself and do NOT render a PDF — the platform renders it after you finish, from the HTML and format file you wrote. Do NOT touch data/applications.md — the platform updates the tracker's PDF column itself, only after a confirmed successful render. Do not submit anything anywhere.

End with EXACTLY one final line: VERDICT: {5 if the HTML and format file were written, else 1}/5 — {a one-line summary, ≤12 words}`;
  }
  if (kind === "fix-portal") {
    return `A company's job-portal ATS slug is BROKEN — career-ops can no longer scan it, so it silently disappears from every future scan. Repair it (headless, on the user's machine):
1. Run \`node verify-portals.mjs --add "${input}"\` — it probes Greenhouse/Ashby/Lever for the company's correct ATS slug and prints the suggested ats + slug.
2. Open portals.yml, find the "${input}" entry under tracked_companies, and update its careers_url (and any api/slug field) to the suggested WORKING ATS URL. Change ONLY this one company; preserve all other YAML structure, comments and formatting exactly.
3. Re-run \`node verify-portals.mjs\` and confirm "${input}" now shows ✅ live (not ❌).
If NO slug variant resolves, say so clearly and leave portals.yml unchanged. Never touch any other company.

End with EXACTLY one final line: VERDICT: {5 if now live, else 1}/5 — {what you changed, ≤12 words}`;
  }
  // evaluate (default) — run the REAL oferta mode + persist canonically
  return `You are running the OFFICIAL career-ops job evaluation, HEADLESS, on the user's own machine. Today is ${today}. Run the REAL career-ops evaluation — do NOT improvise your own scoring.

1. Read modes/oferta.md and follow it EXACTLY (blocks A–F, G posting-legitimacy, and the Machine Summary). Ground the fit in THIS person: read cv.md, config/profile.yml and modes/_profile.md. Use WebFetch to read the posting (you are headless — Playwright is unavailable, so use WebFetch and mark the report header "Verification: unconfirmed (batch mode)").

2. Persist the result CANONICALLY so the web and the CLI share ONE source of truth:
   a. Reserve a report number: run \`node reserve-report-num.mjs\` — its stdout is a 3-digit number (e.g. 035).
   b. Write the full report to reports/{num}-{company-slug}-${today}.md  (company-slug = company lowercased, non-alphanumerics → hyphens).
   c. Append ONE row of 9 TAB-separated columns to batch/tracker-additions/{num}-{company-slug}.tsv, in THIS exact order (real \\t tabs, status BEFORE score):
      {num}\t${today}\t{Company}\t{Role}\t{CanonicalStatus e.g. Evaluated}\t{score}/5\t❌\t[{num}](reports/{num}-{company-slug}-${today}.md)\t{one-line note}
   d. Merge into the tracker: run \`node merge-tracker.mjs\` (it dedupes by company+role+report-num, validates the status, and writes data/applications.md — NEVER edit applications.md by hand).

3. NEVER submit an application, fill no forms, contact no one. This is evaluation + persistence ONLY.${mem}

After everything above is written and merged, output EXACTLY one final line, nothing after it:
VERDICT: {score}/5 — {reason in 12 words or fewer}

Posting URL: ${input}`;
}

export async function POST(req: Request) {
  let body: {
    kind?: string;
    input?: string;
    cliId?: string;
    // Additif, uniquement lu par kind "cv-yaml" : n8n envoie le CV d'origine
    // (locales/fr.yml du repo cv) et l'offre. Les autres kinds l'ignorent.
    payload?: { yaml?: string; offre?: Record<string, unknown>; keywords?: unknown[]; consigne?: string };
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400 });
  }
  const { kind = "evaluate", input, cliId } = body;
  if (!input || !cliId) {
    return new Response(JSON.stringify({ error: "input and cliId required" }), { status: 400 });
  }
  // The resilience chain: the saved CLI first, then Gemini free-tier fallbacks
  // (each is skipped if its binary isn't installed). Empty = nothing to run.
  const chain = buildChain(cliId, kind);
  if (chain.length === 0) {
    return new Response(JSON.stringify({ error: `CLI '${cliId}' not found` }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  // These run the REAL core (modes/scripts), not just data — fail clearly if the
  // root is incomplete instead of faking it.
  const needsScript: Record<string, string> = {
    evaluate: "modes/oferta.md",
    "fix-portal": "verify-portals.mjs",
    pdf: "generate-pdf.mjs",
    // cv-yaml fait suivre modes/pdf.md à l'agent : sans le mode, il improviserait
    // sa propre méthode de tailoring — exactement ce que la consigne interdit.
    "cv-yaml": "modes/pdf.md",
  };
  const required = needsScript[kind];
  if (required && !fs.existsSync(path.join(careerOpsRoot(), required))) {
    return new Response(
      JSON.stringify({
        // ⚠️ Formulation reconnue par le test scannerMissing d'explorer-view.tsx.
        error: `Ceci nécessite une installation career-ops complète (${required}). CAREER_OPS_ROOT ne contient que des données — pointez-le vers une installation complète.`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  // An A–F score is meaningless without a CV to score against — the CLI would
  // hallucinate a fit narrative and still emit a VERDICT. Require cv.md first.
  if ((kind === "evaluate" || kind === "pdf" || kind === "cv-yaml") && !fs.existsSync(path.join(careerOpsRoot(), "cv.md"))) {
    return new Response(
      JSON.stringify({ error: "Ajoutez d'abord votre CV pour que je puisse évaluer cette offre par rapport à vous — déposez-le sur la page d'accueil." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  // Precompute deterministic scratch + final paths so the agent never chooses
  // its own filenames — the backend owns naming and, later, rendering (#2172).
  let pdfPaths: PdfPaths | undefined;
  if (kind === "pdf") {
    const pathsResult = resolvePdfPaths(input, today, careerOpsRoot(), findReportFile);
    if (!pathsResult.ok) {
      return new Response(JSON.stringify({ error: pathsResult.error }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    pdfPaths = pathsResult.paths;
    // Clear any stale scratch artifacts left by an earlier run of this same
    // report before the agent starts, so their existence after this run
    // genuinely proves THIS run produced them. Without this, a re-run whose
    // agent emits some output and exits cleanly but doesn't actually
    // (re)write the HTML could pass the honesty gate on a leftover file from
    // a prior attempt and render/report stale content as if it were fresh.
    for (const p of [pdfPaths.html, pdfPaths.meta]) {
      // force:true already suppresses "doesn't exist" internally, so anything
      // reaching this catch is a real failure (permissions, etc.) — silently
      // swallowing it would defeat the invariant this whole block exists for:
      // an un-cleared stale file could then pass the later existence+non-empty
      // check as if it were fresh.
      try {
        fs.rmSync(p, { force: true });
      } catch (err) {
        console.warn(`Failed to clear stale PDF scratch artifact ${p}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // cv-yaml : le backend dépose l'entrée (CV d'origine + contexte de l'offre) et
  // impose le chemin de sortie, exactement comme le mode pdf. L'agent ne choisit
  // aucun nom de fichier, et l'existence de la sortie après le run est la PREUVE
  // qu'il a travaillé — un CV muet ne peut pas passer pour un CV adapté.
  let cvYamlPaths: CvYamlPaths | undefined;
  let cvYamlOriginal = "";
  if (kind === "cv-yaml") {
    cvYamlOriginal = String(body.payload?.yaml ?? "");
    if (!cvYamlOriginal.trim()) {
      return new Response(
        JSON.stringify({ error: "payload.yaml requis : le CV d'origine (locales/fr.yml du repo cv) doit être fourni" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }
    const r = cheminsCvYaml(input, careerOpsRoot());
    if (!r.ok) {
      return new Response(JSON.stringify({ error: r.error }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    cvYamlPaths = r.chemins;
    try {
      fs.mkdirSync(cvYamlPaths.dir, { recursive: true });
      // La sortie d'un run précédent doit disparaître AVANT celui-ci : sinon un
      // agent qui n'écrit rien passerait la porte d'honnêteté sur un vieux
      // fichier, et n8n commiterait un CV adapté pour une AUTRE offre.
      fs.rmSync(cvYamlPaths.sortie, { force: true });
      fs.writeFileSync(cvYamlPaths.original, cvYamlOriginal, "utf8");
      fs.writeFileSync(
        cvYamlPaths.contexte,
        JSON.stringify(
          contexteCvYaml({ offre: body.payload?.offre, motsCles: body.payload?.keywords, consigne: body.payload?.consigne }),
          null,
          2,
        ),
        "utf8",
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ error: `préparation du run cv-yaml impossible : ${e instanceof Error ? e.message : String(e)}` }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  const prompt = buildPrompt({ kind, input, memory: readMemory(), today, pdfPaths, cvYamlPaths });

  // Tool scope by kind (comma-separated lists; disallowedTools is the hard
  // guardrail). 'evaluate'/'fix-portal' run the REAL mode + persist canonical
  // artifacts → they need Write + Bash (reserve-report-num / merge-tracker /
  // verify-portals). 'pdf' only tailors content and writes the HTML + format
  // sidecar (Write, no Bash — deliberately: the backend renders the PDF itself
  // afterward via renderAndMarkPdf, see pdf-render.mjs; granting Bash here would
  // let the agent improvise its own render/fallback exactly like the #2172
  // incident this fix closes). 'research' stays fully read-only. Task
  // (sub-agents) is always blocked (runaway cost). NEVER auto-submits — that is
  // a prompt-level guarantee. Claude-only: the Gemini fallbacks get an equivalent
  // scope via --approval-mode (see buildChain / geminiArgsFor).
  //
  // 'cv-yaml' a besoin de Read (modes/pdf.md, cv.md, profile.yml, les fichiers
  // de travail) et de Write (le CV adapté). Rien d'autre : ni Bash, ni réseau.
  // Tout le contexte de l'offre est DÉJÀ sur disque, donc une WebFetch ne
  // pourrait qu'introduire du contenu que personne n'a vérifié dans un document
  // qui part chez un recruteur.
  const tools =
    kind === "evaluate" || kind === "fix-portal"
      ? { allowed: "Read,WebFetch,WebSearch,Write,Edit,Bash,Glob,Grep", disallowed: "Task,NotebookEdit" }
      : kind === "pdf"
        ? { allowed: "Read,WebFetch,WebSearch,Write,Edit,Glob,Grep", disallowed: "Bash,Task,NotebookEdit" }
        : kind === "cv-yaml"
          ? { allowed: "Read,Write,Edit,Glob,Grep", disallowed: "Bash,WebFetch,WebSearch,Task,NotebookEdit" }
          : { allowed: "Read,WebFetch,WebSearch,Glob,Grep", disallowed: "Bash,Write,Edit,NotebookEdit,Task" };

  // For write-needing kinds, snapshot reports/ so we can verify the worker
  // actually persisted (non-Claude CLIs lack Write auth and silently no-op).
  const reportsDir = path.join(careerOpsRoot(), "reports");
  const countReports = () => {
    try {
      return fs.readdirSync(reportsDir).filter((f) => f.endsWith(".md")).length;
    } catch {
      return 0;
    }
  };
  const persists = kind === "evaluate";
  // Tracker-mutating runs hold a write token so a row delete can't race their merge
  // (tracker.mjs delete doesn't yet share a lock with merge-tracker — see run-registry).
  // Acquired once for the whole chain; released once when the stream finalizes.
  const writeToken = kind === "evaluate" || kind === "pdf" ? acquireTrackerWrite() : null;

  const enc = new TextEncoder();

  // `closed` + kill timer in the OUTER scope so cancel() (client disconnect) can
  // flip `closed` before a child's late handlers run, and send() is try/catch'd —
  // otherwise a late enqueue onto a closed controller throws uncaught (see #1155).
  let closed = false;
  let killer: ReturnType<typeof setTimeout> | undefined;
  // Whichever attempt's child is in flight, so cancel() can kill it.
  let activeChild: ReturnType<typeof spawn> | null = null;
  // pdf-kind's render+mark work (renderPdf, below) keeps running detached even
  // after the agent child closes — and even after a client disconnect fires
  // cancel(). Track its promise so cancel() can defer releasing writeToken
  // until that work actually settles, instead of releasing the tracker-delete
  // guard while mark-pdf-ready.mjs is still actively writing applications.md.
  let pdfRenderPromise: Promise<void> | null = null;
  let writeTokenReleased = false;
  const releaseWriteTokenOnce = () => {
    if (writeToken !== null && !writeTokenReleased) {
      writeTokenReleased = true;
      releaseTrackerWrite(writeToken);
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(JSON.stringify(obj) + "\n")); } catch { closed = true; }
      };
      // Le nettoyage (timer, writeToken) est INCONDITIONNEL : après un
      // rechargement de page, `closed` vaut déjà true alors que l'enfant tourne
      // encore, et c'est justement sa fermeture qui nous ramène ici. Le garder
      // sous `if (!closed)` faisait fuiter le jeton d'écriture du tracker.
      const finalize = () => {
        if (killer) { clearTimeout(killer); killer = undefined; }
        releaseWriteTokenOnce();
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* */ }
      };

      // Run ONE attempt of the chain. Resolves true when it produced a clean, real
      // result (terminal "done" — for pdf, after render — already sent; the caller
      // must stop). Resolves false when it failed: a soft "bascule…" status was
      // sent if another attempt remains, or the terminal error when this was last.
      const runAttempt = (runner: Runner, isLast: boolean) =>
        new Promise<boolean>((resolve) => {
          const isClaude = runner.cliId === "claude";
          const attemptArgs = isClaude
            ? ["-p", prompt, "--output-format", "stream-json", "--verbose", "--include-partial-messages",
               "--permission-mode", "acceptEdits",
               "--allowedTools", tools.allowed,
               "--disallowedTools", tools.disallowed]
            : runner.args(prompt);
          // Base env + this attempt's overrides (undefined value = delete the var,
          // e.g. clearing GEMINI_API_KEY to force the OAuth/Google-login path).
          const env: NodeJS.ProcessEnv = { ...process.env };
          if (runner.env) {
            for (const [k, v] of Object.entries(runner.env)) {
              if (v === undefined) delete env[k];
              else env[k] = v;
            }
          }

          // Per-attempt state (reset each try) — a later attempt's success is
          // judged only by ITS OWN output and file writes, not a prior attempt's.
          const reportsBefore = persists ? countReports() : 0;
          let buf = "";
          let emittedText = false; // any assistant text delta → the CLI actually ran
          let sawError = false;
          let lastTokens = 0; // per-run token cost from the Claude result event (#6) — local only
          let lastCostUsd: number | null = null;
          let settled = false;
          const finishAttempt = (ok: boolean) => {
            if (settled) return;
            settled = true;
            if (killer) { clearTimeout(killer); killer = undefined; }
            resolve(ok);
          };

          // Announce which CLI is being tried (only when there's a real chain).
          if (chain.length > 1) send({ type: "status", label: `Essai via ${runner.label}…` });

          // Windows can't spawn the extensionless shim findBin returns — resolve
          // to the real .exe (claude) or the wrapped node entry (gemini / gemini-rotate).
          const { file, prefixArgs } = spawnTarget(runner.binPath);
          const child = spawn(file, [...prefixArgs, ...attemptArgs], { cwd: careerOpsRoot(), env });
          activeChild = child;

          // pdf-mode's agent only tailors content now (rendering moved to the
          // backend, #2172) — but its killMs still has to leave real headroom
          // inside the route's overall maxDuration (800s): the render+mark phase
          // (renderPdf, below) starts only after this timer's window and has no
          // timeout of its own. 600s agent / ~200s render is ample.
          const killMs = kind === "pdf" ? 600_000 : 285_000;
          killer = setTimeout(() => {
            try { child.kill("SIGTERM"); } catch { /* ignore */ }
          }, killMs);

          child.stdout.on("data", (d: Buffer) => {
            if (closed) return;
            if (!isClaude) {
              emittedText = true;
              send({ type: "text", text: d.toString() });
              return;
            }
            buf += d.toString();
            let nl: number;
            while ((nl = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line) continue;
              try {
                const ev = JSON.parse(line);
                if (ev.type === "stream_event") {
                  const e = ev.event;
                  if (e?.type === "content_block_start" && e.content_block?.type === "tool_use") {
                    send({ type: "tool", name: e.content_block.name });
                  } else if (e?.type === "content_block_delta" && e.delta?.text) {
                    emittedText = true;
                    send({ type: "text", text: e.delta.text });
                  }
                } else if (ev.type === "system" && ev.subtype === "init") {
                  send({ type: "status", label: "Agent ready" });
                } else if (ev.type === "result") {
                  // Capture the per-run cost; the authoritative "done" is sent on close
                  // (so the honesty gate decides done-vs-error first). Tokens = the same
                  // formula /api/usage uses: input + output + cache-creation.
                  const u = ev.usage || {};
                  lastTokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0);
                  if (typeof ev.total_cost_usd === "number") lastCostUsd = ev.total_cost_usd;
                }
              } catch {
                /* partial line */
              }
            }
          });
          child.stderr.on("data", (d: Buffer) => {
            const s = d.toString();
            // Widened: auth/login/quota failures are the most common real error and
            // the old narrow regex missed them (silent false "success").
            if (/error|denied|fatal|not found|unauthorized|forbidden|auth|login|credential|api[ -]?key|quota|rate limit|not authenticated/i.test(s)) {
              sawError = true;
              // Surface as a hard error only on the last attempt; otherwise this is
              // just the reason we'll fall through to the next CLI (soft status on close).
              if (isLast) send({ type: "error", msg: s.trim().slice(0, 200) });
            }
          });

          // Render + mark-tracker-ready live in pdf-render.mjs (plain, dependency-
          // injected, unit-tested). Runs generate-pdf.mjs and mark-pdf-ready.mjs as
          // plain Node child processes — no agent CLI or its sandbox involved — so a
          // browser launch never depends on an interactive approval nobody is present
          // to grant (#2172). The tracker is marked ✅ only after a CONFIRMED
          // successful render, not optimistically — same honesty-gate discipline.
          const renderPdf = async (paths: PdfPaths) => {
            send({ type: "status", label: "Rendering PDF…" });
            try {
              const result = await renderAndMarkPdf({
                spawnFn: spawn,
                execPath: process.execPath,
                root: careerOpsRoot(),
                pdfPaths: paths,
                reportNum: input,
              });
              if (result.kind === "render-failed") {
                send({ type: "error", msg: result.error.slice(0, 200) });
                return;
              }
              // Non-fatal issues (missing format sidecar, tracker not marked) still
              // surface here rather than only in a server log nobody sees.
              for (const w of result.warnings) send({ type: "text", text: `⚠️ ${w}\n` });
              send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
            } catch (e) {
              send({ type: "error", msg: `PDF rendering crashed unexpectedly: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) });
            }
          };

          child.on("error", (e) => {
            activeChild = null;
            if (closed) return finishAttempt(false);
            // A binary that won't spawn (missing / not executable) isn't a real
            // failure of this run — try the next CLI, or surface it if it was last.
            if (isLast) send({ type: "error", msg: e.message });
            else send({ type: "status", label: `${runner.label} indisponible — bascule vers le CLI suivant…` });
            finishAttempt(false);
          });
          child.on("close", (code) => {
            activeChild = null;
            // A client disconnect can fire cancel() (which kills `child`) before
            // this event finally arrives. Without this guard a pdf run could still
            // start a brand-new render after the stream — and its writeToken guard —
            // is already gone.
            if (closed) return finishAttempt(false);
            const cleanExit = code === 0; // non-zero OR null (killed/signal) = NOT clean

            // Fall through to the next CLI (soft status) or, if this was the last
            // attempt, surface the terminal error. Either way this attempt failed.
            const fail = (terminalMsg: string) => {
              if (isLast) send({ type: "error", msg: terminalMsg });
              else send({ type: "status", label: `${runner.label} n'a pas abouti — bascule vers le CLI suivant…` });
              finishAttempt(false);
            };

            // Shared honesty check: a CLI that produced no output at all is the same
            // failure mode whether evaluating or tailoring a PDF.
            const noOutputError = (): string | null => {
              if (!emittedText && !sawError && !cleanExit) return "Le CLI s'est arrêté sur une erreur — est-il bien installé et connecté ?";
              if (!emittedText && !sawError) return "Le CLI n'a rien produit — est-il bien installé et connecté ? (career-ops fonctionne au mieux avec Claude Code.)";
              return null;
            };

            if (kind === "cv-yaml") {
              const baseErrCv = noOutputError();
              if (baseErrCv) return fail(baseErrCv);
              if (!cvYamlPaths) return fail("Chemins de travail du CV manquants : ce traitement n'a rien pu écrire.");
              let rendu = "";
              try {
                rendu = fs.readFileSync(cvYamlPaths.sortie, "utf8");
              } catch {
                rendu = "";
              }
              // Un fichier vide, c'est un echec : il n'y a rien a verifier.
              if (!rendu.trim()) {
                return fail(
                  "Ce traitement n'a produit aucun CV adapté — le CV d'origine n'a pas été modifié. Relancez-le pour vérifier.",
                );
              }
              // `cleanExit` et `sawError` NE decident PLUS ici, et c'est le coeur du
              // correctif du 2026-08-10.
              //
              // Ce qu'il s'est passe. Claude Code a fait le travail, deux fois, et
              // rendu « VERDICT: 5/5 — coupe paie/DSN/projets redondants, sous
              // budget », un CV conforme de ~4 600 caracteres. Les deux tentatives
              // ont ete jetees, puis Gemini a echoue sur son quota, et l'alerte n'a
              // montre que le quota Gemini. Cause : `sawError` vient d'une regex sur
              // stderr qui contient `auth`, `error` et `not found` en SOUS-CHAINE.
              // « author », « Authorization », un message d'outil « not found » —
              // n'importe quel mot anodin sur stderr suffisait a tout annuler.
              //
              // Pourquoi c'est le bon sens de la correction. On dispose ici d'un juge
              // bien meilleur que du texte sur stderr : l'artefact lui-meme, passe au
              // crible de cinq verifications deterministes. Si elles passent, le CV
              // est bon, quoi que le CLI ait murmure au passage. C'est exactement la
              // doctrine deja ecrite dans cv-adapt.mjs : un prompt se contourne, une
              // verification non.
              //
              // Les anomalies ne sont pas perdues pour autant : elles remontent en
              // avertissement, pour qu'un vrai probleme reste visible sans annuler un
              // travail verifie.
              const verdict = verifieCvAdapte({ original: cvYamlOriginal, adapte: rendu });
              if (!verdict.ok) return fail(`CV adapté refusé : ${verdict.motif}`);
              if (!cleanExit) send({ type: "text", text: "⚠️ Le CLI s'est arrêté sur un code non nul, mais le CV rendu passe les cinq vérifications : il est retenu.\n" });
              if (sawError) send({ type: "text", text: "⚠️ Un message d'erreur est apparu sur la sortie d'erreur du CLI, mais le CV rendu passe les cinq vérifications : il est retenu.\n" });
              for (const w of verdict.avertissements) send({ type: "text", text: `⚠️ ${w}\n` });
              // L'artefact EST le résultat : n8n lit cet évènement et rien d'autre.
              send({ type: "artifact", artifact: "cv-yaml", adaptedYaml: verdict.adaptedYaml });
              send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
              return finishAttempt(true);
            }

            if (kind === "pdf") {
              // Non-empty, not just existing: paired with clearing pdfPaths.html/meta
              // before the agent started, this proves the file is both fresh and real.
              const wroteHtml = pdfPaths !== undefined && fs.existsSync(pdfPaths.html) && fs.statSync(pdfPaths.html).size > 0;
              const baseErr = noOutputError();
              if (baseErr) return fail(baseErr);
              if (!wroteHtml || !cleanExit || sawError || !pdfPaths) {
                return fail("Ce traitement n'a produit aucun CV adapté à rendre, donc aucun PDF n'a été généré — relancez-le pour vérifier.");
              }
              // Success: render (sends "done") then finalize the whole stream. The
              // attempt resolves true only after render settles, so cancel() can
              // defer releasing writeToken until mark-pdf-ready.mjs is done.
              pdfRenderPromise = renderPdf(pdfPaths).then(() => finalize());
              pdfRenderPromise.finally(() => finishAttempt(true));
              return;
            }

            const wroteReport = countReports() > reportsBefore;
            // Honesty gate (#9): a green "done" with a parsed score requires a CLEAN
            // exit, real output, AND (for evaluations) a report actually written.
            const baseErr = noOutputError();
            if (baseErr) return fail(baseErr);
            if (persists && !wroteReport) {
              return fail("Cette évaluation n'a pas enregistré de rapport, elle n'est donc pas dans votre tracker. L'évaluation complète est validée sur Claude Code.");
            }
            if (!cleanExit || sawError) {
              return fail("Ce traitement a rencontré une erreur avant la fin, il n'est donc pas enregistré comme résultat fiable — relancez-le pour vérifier.");
            }
            send({ type: "done", tokens: lastTokens, costUsd: lastCostUsd });
            finishAttempt(true);
          });
        });

      // Drive the chain: try each CLI in order until one produces a clean result.
      (async () => {
        for (let i = 0; i < chain.length; i++) {
          if (closed) break;
          const ok = await runAttempt(chain[i], i === chain.length - 1);
          if (ok) break;
        }
        // pdf success finalizes inside its render chain; everything else here.
        if (!pdfRenderPromise) finalize();
      })();
    },
    // Déconnexion du client — typiquement l'onglet rechargé, fermé, ou une
    // navigation. On coupe le flux, PAS le travail.
    //
    // Avant, on envoyait un SIGTERM à l'enfant ici : recharger la page tuait
    // l'évaluation en cours. Or « evaluate » persiste lui-même ses artefacts
    // canoniques (reserve-report-num → reports/{num}-… → batch/tracker-additions
    // → merge-tracker → data/applications.md). Tuer l'agent à mi-chemin jetait
    // des jetons déjà dépensés et pouvait laisser un numéro de rapport réservé
    // sans ligne de tracker — un état qu'aucun écran ne rattrape.
    //
    // On laisse donc l'enfant finir et écrire. La borne dure reste le timer
    // `killer` (285 s / 600 s en pdf), volontairement NON annulé ici : sans lui,
    // un agent bloqué survivrait indéfiniment à l'onglet qui l'a lancé.
    // `closed` suffit à rendre send() inerte, et le handler `close` de l'enfant
    // libère writeToken via finalize().
    cancel() {
      closed = true;
      if (pdfRenderPromise) {
        // Render/mark keeps running after this client disconnects — wait for
        // it to settle before releasing the guard, so a concurrent tracker
        // delete can't race mark-pdf-ready.mjs's still-in-flight write.
        pdfRenderPromise.finally(releaseWriteTokenOnce);
      } else if (!activeChild) {
        // Aucun enfant en vol : plus personne ne passera par finalize().
        releaseWriteTokenOnce();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
