import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Server-only (node imports). The agnostic runtimes career-ops can delegate to
// in headless mode (AGENTS.md). Install URLs from career-ops-docs.
export type CliSpec = {
  id: string;
  name: string;
  bin: string;
  run: string;
  url: string;
  /** headless invocation args for a single prompt */
  args: (prompt: string) => string[];
};

export const KNOWN: CliSpec[] = [
  { id: "claude", name: "Claude Code", bin: "claude", run: "claude -p", url: "https://claude.ai/code", args: (p) => ["-p", p] },
  { id: "codex", name: "Codex", bin: "codex", run: "codex exec", url: "https://github.com/openai/codex", args: (p) => ["exec", p] },
  { id: "gemini", name: "Gemini CLI", bin: "gemini", run: "gemini -p", url: "https://github.com/google-gemini/gemini-cli", args: (p) => ["-p", p] },
  { id: "opencode", name: "OpenCode", bin: "opencode", run: "opencode run", url: "https://opencode.ai", args: (p) => ["run", p] },
  { id: "copilot", name: "GitHub Copilot CLI", bin: "copilot", run: "copilot -p", url: "https://docs.github.com/en/copilot/github-copilot-in-the-cli", args: (p) => ["-p", p] },
  { id: "qwen", name: "Qwen CLI", bin: "qwen", run: "qwen -p", url: "https://qwen.ai/qwencode", args: (p) => ["-p", p] },
  { id: "antigravity", name: "Antigravity CLI", bin: "agy", run: "agy -p", url: "https://antigravity.google", args: (p) => ["-p", p] },
];

function searchDirs(): string[] {
  const home = os.homedir();
  const extra = [
    path.join(home, ".local/bin"),
    path.join(home, ".npm-global/bin"),
    path.join(home, ".bun/bin"),
    path.join(home, ".deno/bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
  if (process.platform === "win32") {
    // Windows CLIs frequently install under per-user AppData roots and don't
    // reliably add themselves to PATH (e.g. Antigravity → %LOCALAPPDATA%\agy\bin).
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    extra.push(
      path.join(localAppData, "agy", "bin"), // Antigravity CLI
      path.join(localAppData, "Microsoft", "WindowsApps"), // winget/Store shims
      path.join(appData, "npm"), // npm global prefix on Windows
    );
  }
  const fromPath = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  return [...new Set([...fromPath, ...extra])];
}

// On Windows, executables carry an extension (claude.exe, claude.cmd, ...).
// Mirror the shell's PATHEXT resolution so a native-installer claude.exe is
// found, not just an extensionless npm shim. On POSIX, "" keeps the bare name.
function binCandidates(bin: string): string[] {
  if (process.platform !== "win32") return [bin];
  const pathext = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  const exts = pathext
    .split(";")
    .map((e) => e.trim())
    .filter(Boolean)
    // Only include extensions that `child_process.spawn()` can execute directly.
    .filter((e) => [".com", ".exe", ".bat", ".cmd"].includes(e.toLowerCase()));

  // Try the bare name too (some environments provide an extensionless shim).
  return [bin, ...exts.map((ext) => bin + ext)];
}

export function findBin(bin: string, dirs = searchDirs()): string | null {
  for (const dir of dirs) {
    for (const candidate of binCandidates(bin)) {
      const p = path.join(dir, candidate);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch {
        /* not here */
      }
    }
  }
  return null;
}

export function detectClis() {
  const dirs = searchDirs();
  return KNOWN.map((c) => {
    const found = findBin(c.bin, dirs);
    return { id: c.id, name: c.name, run: c.run, url: c.url, installed: !!found, path: found };
  });
}

export function resolveCli(id: string): { spec: CliSpec; binPath: string } | null {
  const spec = KNOWN.find((c) => c.id === id);
  if (!spec) return null;
  const binPath = findBin(spec.bin);
  if (!binPath) return null;
  return { spec, binPath };
}

// Windows can't `child_process.spawn()` an extensionless npm/sh shim (e.g. the
// bare `claude` / `gemini-rotate` scripts findBin returns) or a `.cmd` without a
// shell — and shell:true mangles the multi-line prompt arg. Resolve each known
// CLI's REAL executable (claude ships a native .exe) or the node entry script it
// wraps (gemini, gemini-rotate) and run THAT directly: clean arg passing, no shell.
// POSIX (and any resolved .exe) spawns the bin as-is.
export function spawnTarget(binPath: string): { file: string; prefixArgs: string[] } {
  if (process.platform !== "win32") return { file: binPath, prefixArgs: [] };
  if (/\.(exe|com)$/i.test(binPath)) return { file: binPath, prefixArgs: [] };

  const dir = path.dirname(binPath);
  const base = path.basename(binPath).replace(/\.(cmd|bat|ps1|exe)$/i, "").toLowerCase();

  if (base === "claude") {
    const exe = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (fs.existsSync(exe)) return { file: exe, prefixArgs: [] };
  }
  if (base === "gemini-rotate") {
    const entry = path.join(os.homedir(), ".gemini", "rotate.mjs");
    if (fs.existsSync(entry)) return { file: process.execPath, prefixArgs: [entry] };
  }
  if (base === "gemini") {
    const entry = path.join(dir, "node_modules", "@google", "gemini-cli", "bundle", "gemini.js");
    if (fs.existsSync(entry)) return { file: process.execPath, prefixArgs: [entry] };
  }

  // Fallback for other CLIs: a sibling .exe if present, else the .cmd via cmd.exe
  // (Node escapes the args; shell:false avoids a second cmd re-parse). Multi-line
  // args through cmd.exe are best-effort — the known CLIs above avoid it entirely.
  const siblingExe = path.join(dir, `${base}.exe`);
  if (fs.existsSync(siblingExe)) return { file: siblingExe, prefixArgs: [] };
  const cmd = path.join(dir, `${base}.cmd`);
  if (fs.existsSync(cmd)) return { file: process.env.ComSpec || "cmd.exe", prefixArgs: ["/d", "/s", "/c", cmd] };
  return { file: binPath, prefixArgs: [] };
}

// A single concrete attempt the run route can spawn. The resilience chain is an
// ordered list of these: each is tried until one produces a clean, real result.
export type Runner = {
  /** unique attempt id (also the analytics label) */
  id: string;
  /** the KNOWN cli this maps to — drives Claude-specific arg handling */
  cliId: string;
  /** human-readable label shown in the progress stream */
  label: string;
  /** resolved executable path */
  binPath: string;
  /** headless invocation args for a single prompt */
  args: (prompt: string) => string[];
  /** extra env for THIS attempt; a key mapped to undefined is DELETED from the child env */
  env?: Record<string, string | undefined>;
};

// Gemini auto-approval per task kind — mirrors the per-kind tool scoping the
// route hands Claude (read-only research → plan; pdf edits only → auto_edit;
// evaluate/fix-portal need the shell → yolo). Without this, headless Gemini would
// stall waiting for an approval nobody is present to grant.
function geminiArgsFor(kind: string): (prompt: string) => string[] {
  const approval =
    kind === "research" ? ["--approval-mode", "plan"] : kind === "pdf" ? ["--approval-mode", "auto_edit"] : ["--yolo"];
  return (p: string) => [...approval, "-p", p];
}

// Antigravity CLI (`agy`) auto-approval per task kind — same intent as Gemini's:
// read-only research → plan; pdf edits → accept-edits; evaluate/fix-portal need
// the shell → skip all permission prompts. Otherwise headless `agy` stalls waiting
// for an approval nobody is present to grant.
function antigravityArgsFor(kind: string): (prompt: string) => string[] {
  const approval =
    kind === "research" ? ["--mode", "plan"] : kind === "pdf" ? ["--mode", "accept-edits"] : ["--dangerously-skip-permissions"];
  return (p: string) => [...approval, "-p", p];
}

// Ordered resilience chain: the CLI saved in Configuration first, then Gemini's
// free tiers as fallbacks (AGENTS.md: career-ops runs best on Claude Code; Gemini
// free tiers are the safety net). Each attempt is tried in order until one
// produces a clean, real result. Entries whose binary isn't installed are skipped.
//   1. <primary>    — the CLI saved in Configuration (usually Claude Code / the Claude account)
//   2. antigravity  — Antigravity CLI (Google-account free tier), ONLY if `agy` is installed
//                     (replaces Gemini's retired "Sign in with Google" path)
//   3. gemini-keys  — Gemini via API keys; uses the `gemini-rotate` wrapper (10-key pool, auto-rotates on quota) when installed
export function buildChain(primaryCliId: string, kind: string): Runner[] {
  const chain: Runner[] = [];
  const seen = new Set<string>();
  const add = (r: Runner | null) => {
    if (r && !seen.has(r.id)) {
      seen.add(r.id);
      chain.push(r);
    }
  };
  const geminiArgs = geminiArgsFor(kind);

  const primary = resolveCli(primaryCliId);
  if (primary) {
    add({
      id: primaryCliId,
      cliId: primaryCliId,
      label: primary.spec.name,
      binPath: primary.binPath,
      args: primaryCliId === "gemini" ? geminiArgs : primary.spec.args,
    });
  }

  // Failover 2e compte Max : si le compte primaire (CLAUDE_CODE_OAUTH_TOKEN) est
  // rate-limited ou échoue, retente Claude Code avec CLAUDE_CODE_OAUTH_TOKEN_2
  // AVANT de tomber sur Gemini. Toute la chaîne (éval, apply, etc.) en profite.
  const claudeToken2 = process.env.CLAUDE_CODE_OAUTH_TOKEN_2;
  if (primary && primaryCliId === "claude" && claudeToken2) {
    add({
      id: "claude-token2",
      cliId: "claude",
      label: "Claude Code · compte 2",
      binPath: primary.binPath,
      args: primary.spec.args,
      env: { CLAUDE_CODE_OAUTH_TOKEN: claudeToken2 },
    });
  }

  // Google-account free tier: Gemini's individual "Sign in with Google" (Code
  // Assist) path was RETIRED by Google — the CLI now answers "This client is no
  // longer supported for Gemini Code Assist for individuals… migrate to
  // Antigravity", so it is NOT a usable tier and is deliberately omitted.
  // Antigravity CLI (`agy`) is Google's replacement free tier — slot it in here
  // (Google-account, no key) whenever it's installed.
  const agyBin = findBin("agy");
  if (agyBin) {
    add({ id: "antigravity", cliId: "antigravity", label: "Antigravity · compte Google", binPath: agyBin, args: antigravityArgsFor(kind) });
  }

  const geminiBin = findBin("gemini");
  const rotateBin = findBin("gemini-rotate");
  if (rotateBin) {
    add({
      id: "gemini-keys",
      cliId: "gemini",
      label: "Gemini · clés API (rotation)",
      binPath: rotateBin,
      args: geminiArgs,
      env: { GEMINI_CLI_TRUST_WORKSPACE: "true" },
    });
  } else if (geminiBin) {
    add({
      id: "gemini-keys",
      cliId: "gemini",
      label: "Gemini · clé API",
      binPath: geminiBin,
      args: geminiArgs,
      env: { GEMINI_DEFAULT_AUTH_TYPE: "gemini-api-key", GEMINI_CLI_TRUST_WORKSPACE: "true" },
    });
  }

  return chain;
}
