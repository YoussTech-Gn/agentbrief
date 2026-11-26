import { execFileSync } from "node:child_process";
import { chmod, stat } from "node:fs/promises";
import path from "node:path";
import { guardRoot, readText, writeText } from "./util.js";

const BEGIN_MARK = "# agentbrief:hook:begin";
const END_MARK = "# agentbrief:hook:end";

export type HookMode = "check" | "compile";

export interface HookResult {
  action: "installed" | "updated" | "removed" | "unchanged";
  file: string;
  message: string;
}

/**
 * Install or update an idempotent git pre-commit hook that checks or
 * recompiles the project brief before commits.
 */
export async function installHook(cwd: string, mode: HookMode = "check"): Promise<HookResult> {
  guardRoot(cwd);
  const hookFile = path.join(await hooksDir(cwd), "pre-commit");
  const existing = await readText(hookFile);
  const block = renderHookBlock(mode);

  let next: string;
  let action: HookResult["action"];
  if (!existing) {
    next = `#!/bin/sh\n\n${block}\n`;
    action = "installed";
  } else if (existing.includes(BEGIN_MARK) && existing.includes(END_MARK)) {
    const replaced = replaceBlock(existing, block);
    if (replaced === existing) {
      return { action: "unchanged", file: hookFile, message: `pre-commit hook already configured (${mode}).` };
    }
    next = replaced;
    action = "updated";
  } else {
    const base = existing.endsWith("\n") ? existing : `${existing}\n`;
    next = `${base}\n${block}\n`;
    action = "installed";
  }

  await writeText(hookFile, next);
  if (process.platform !== "win32") {
    await chmod(hookFile, 0o755);
  }
  return {
    action,
    file: hookFile,
    message: `${action === "updated" ? "Updated" : "Installed"} pre-commit hook (${mode}) at ${hookFile}.`,
  };
}

/**
 * Where git runs hooks from. `git rev-parse --git-path hooks` follows
 * `core.hooksPath` (husky) and resolves worktrees and submodules, whose
 * `.git` is a file. Without git, fall back to a plain `.git/hooks`.
 */
async function hooksDir(cwd: string): Promise<string> {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) return path.resolve(cwd, out);
  } catch {
    /* not a repository, or git is missing */
  }
  const gitDir = path.join(cwd, ".git");
  const info = await stat(gitDir).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`No git repository found in ${cwd}. Run \`git init\` first.`);
  }
  return path.join(gitDir, "hooks");
}

/** Remove the agentbrief block from `.git/hooks/pre-commit`, preserving user lines. */
export async function uninstallHook(cwd: string): Promise<HookResult> {
  guardRoot(cwd);
  const hookFile = path.join(await hooksDir(cwd), "pre-commit");
  const existing = await readText(hookFile);
  if (!existing || !existing.includes(BEGIN_MARK)) {
    return { action: "unchanged", file: hookFile, message: "No agentbrief pre-commit hook found." };
  }
  const next = removeBlock(existing);
  await writeText(hookFile, next);
  return { action: "removed", file: hookFile, message: `Removed agentbrief hook from ${hookFile}.` };
}

/** Write a GitHub Actions workflow that runs `agentbrief check --project --strict`. */
export async function writeCiWorkflow(cwd: string, force = false, version?: string): Promise<HookResult> {
  guardRoot(cwd);
  // Pin the version that wrote the workflow, so a new release cannot change
  // what runs in every repository's CI until its owner upgrades on purpose.
  const spec = version ? `@coddrex/agentbrief@${version}` : "@coddrex/agentbrief";
  const file = path.join(cwd, ".github", "workflows", "agentbrief.yml");
  const existing = await readText(file);
  if (existing !== null && !force) {
    return {
      action: "unchanged",
      file,
      message: `${file} already exists. Pass --force to overwrite.`,
    };
  }
  const contents = `name: AgentBrief Check

on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx --yes ${spec} check --project --strict
`;
  await writeText(file, contents);
  return {
    action: existing ? "updated" : "installed",
    file,
    message: `Wrote GitHub Actions workflow to ${file}.`,
  };
}

function renderHookBlock(mode: HookMode): string {
  // compile mode stages what it regenerated, so the commit carries it.
  const cmd =
    mode === "compile"
      ? "agentbrief compile --project --stage"
      : "agentbrief check --project";
  // `|| exit 1` fails the commit even when user lines follow this block.
  return [
    BEGIN_MARK,
    "if command -v agentbrief >/dev/null 2>&1; then",
    `  ${cmd} || exit 1`,
    "else",
    '  echo "agentbrief is not installed; skipping the brief check." >&2',
    "fi",
    END_MARK,
  ].join("\n");
}

function replaceBlock(text: string, block: string): string {
  const start = text.indexOf(BEGIN_MARK);
  const end = text.indexOf(END_MARK);
  if (start === -1 || end === -1 || end < start) return text;
  return `${text.slice(0, start)}${block}${text.slice(end + END_MARK.length)}`;
}

function removeBlock(text: string): string {
  const start = text.indexOf(BEGIN_MARK);
  const end = text.indexOf(END_MARK);
  if (start === -1 || end === -1 || end < start) return text;
  const before = text.slice(0, start).replace(/\n+$/, "\n");
  const after = text.slice(end + END_MARK.length).replace(/^\n+/, "");
  return `${before}${after}`;
}
