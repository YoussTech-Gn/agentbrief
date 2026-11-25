import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const cliPath = path.join(repoRoot, "dist", "cli.js");

export async function makeWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "brief-"));
  const cwd = path.join(root, "project");
  const userHome = path.join(root, "user");
  const briefHome = path.join(root, "brief");
  await mkdir(cwd, { recursive: true });
  await mkdir(userHome, { recursive: true });
  await mkdir(briefHome, { recursive: true });
  return {
    root,
    cwd,
    userHome,
    briefHome,
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export function compileOptions(workspace, extra = {}) {
  return {
    cwd: workspace.cwd,
    briefHome: workspace.briefHome,
    userHome: workspace.userHome,
    env: {},
    ...extra,
  };
}

export async function write(file, contents) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents.endsWith("\n") ? contents : `${contents}\n`);
}

export async function read(file) {
  return readFile(file, "utf8");
}

export function runCli(args, workspace, extraEnv = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: workspace.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: workspace.userHome,
      USER: "ada",
      BRIEF_HOME: workspace.briefHome,
      CLAUDE_CONFIG_DIR: "",
      CODEX_HOME: "",
      COPILOT_HOME: "",
      GROK_HOME: "",
      GIT_AUTHOR_NAME: "Brief Test",
      GIT_AUTHOR_EMAIL: "brief@example.com",
      GIT_COMMITTER_NAME: "Brief Test",
      GIT_COMMITTER_EMAIL: "brief@example.com",
      ...extraEnv,
    },
  });
}

export function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Brief Test",
      GIT_AUTHOR_EMAIL: "brief@example.com",
      GIT_COMMITTER_NAME: "Brief Test",
      GIT_COMMITTER_EMAIL: "brief@example.com",
    },
  }).trim();
}

export const PERSONAL = `---
title: Preferences
order: 10
---

# Preferences

Keep functions small.

<!-- brief:detail -->

Explain why a function is split when the split is not obvious.
`;

export const PROJECT = `---
title: Project
order: 10
---

# Project

A sample service with one module.
`;

export const GLOBAL_TOML = `version = 1
variant = "full"
composition = "full"
profile = "native"

[budget]
full = 4000
short = 1500

[targets]
claude = true
agents = true
gemini = true
cursor = true
copilot = true
windsurf = true
codex = true
grok = true
`;

export const PROJECT_TOML = `version = 1
variant = "full"
composition = "full"
profile = "native"
stacks = []
`;
