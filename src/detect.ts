import { stat } from "node:fs/promises";
import path from "node:path";
import type { SourceDoc } from "./types.js";
import { asString, asStringList, readText } from "./util.js";

export interface ProjectFacts {
  /** Package managers implied by lockfiles or a packageManager field. */
  packageManagers: string[];
  frameworks: string[];
  scripts: string[];
  stacks: string[];
  makefileTargets: string[];
  files: string[];
  /** Detected project metadata for smart `init`. */
  projectName?: string;
  projectDescription?: string;
  testRunners: string[];
  directories: string[];
  monorepo: boolean;
  hasDocker: boolean;
  hasCi: boolean;
}

const KNOWN_DIRS = [
  "src",
  "app",
  "lib",
  "packages",
  "apps",
  "test",
  "tests",
  "__tests__",
  "cmd",
  "internal",
  "pkg",
  "docs",
  "scripts",
];

const TEST_RUNNER_PACKAGES: Record<string, string> = {
  vitest: "vitest",
  jest: "jest",
  mocha: "mocha",
  playwright: "@playwright/test",
  cypress: "cypress",
  ava: "ava",
};

const FRAMEWORK_PACKAGES: Record<string, string> = {
  next: "next",
  react: "react",
  vue: "vue",
  svelte: "svelte",
  angular: "@angular/core",
  express: "express",
  fastify: "fastify",
  vite: "vite",
  django: "django",
  fastapi: "fastapi",
  flask: "flask",
};

export async function detectProject(cwd: string): Promise<ProjectFacts> {
  const files = await existing(
    cwd,
    [
      "package.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "package-lock.json",
      "bun.lock",
      "bun.lockb",
      "tsconfig.json",
      "pyproject.toml",
      "requirements.txt",
      "setup.py",
      "poetry.lock",
      "uv.lock",
      "Pipfile",
      "go.mod",
      "Cargo.toml",
      "Makefile",
      "makefile",
      "pnpm-workspace.yaml",
      "turbo.json",
      "Dockerfile",
      "docker-compose.yml",
      "docker-compose.yaml",
    ],
  );
  const present = new Set(files);
  const managers: string[] = [];
  const frameworks: string[] = [];
  const stacks: string[] = [];
  const testRunners: string[] = [];
  let scripts: string[] = [];
  let projectName: string | undefined;
  let projectDescription: string | undefined;
  let monorepo = present.has("pnpm-workspace.yaml") || present.has("turbo.json");

  if (present.has("package.json")) {
    const parsed = await readJson(path.join(cwd, "package.json"));
    if (typeof parsed.name === "string" && parsed.name.trim()) projectName = parsed.name.trim();
    if (typeof parsed.description === "string" && parsed.description.trim()) {
      projectDescription = parsed.description.trim();
    }
    if (Array.isArray(parsed.workspaces) || isRecord(parsed.workspaces)) monorepo = true;
    const pmField = typeof parsed.packageManager === "string" ? parsed.packageManager.split("@")[0] : "";
    if (pmField) managers.push(pmField);
    const scriptRecord = isRecord(parsed.scripts) ? parsed.scripts : {};
    scripts = Object.keys(scriptRecord);
    const deps = new Set<string>([
      ...Object.keys(isRecord(parsed.dependencies) ? parsed.dependencies : {}),
      ...Object.keys(isRecord(parsed.devDependencies) ? parsed.devDependencies : {}),
      ...Object.keys(isRecord(parsed.peerDependencies) ? parsed.peerDependencies : {}),
    ]);
    for (const [framework, pkg] of Object.entries(FRAMEWORK_PACKAGES)) {
      if (deps.has(pkg)) frameworks.push(framework);
    }
    for (const [runner, pkg] of Object.entries(TEST_RUNNER_PACKAGES)) {
      if (deps.has(pkg)) pushUnique(testRunners, runner);
    }
    const testScript = typeof scriptRecord["test"] === "string" ? scriptRecord["test"] : "";
    if (testScript.includes("node --test")) pushUnique(testRunners, "node:test");
    if (present.has("tsconfig.json") || deps.has("typescript")) stacks.push("typescript");
  } else if (present.has("tsconfig.json")) {
    stacks.push("typescript");
  }

  if (present.has("pnpm-lock.yaml")) pushUnique(managers, "pnpm");
  if (present.has("yarn.lock")) pushUnique(managers, "yarn");
  if (present.has("package-lock.json")) pushUnique(managers, "npm");
  if (present.has("bun.lock") || present.has("bun.lockb")) pushUnique(managers, "bun");

  const python = present.has("pyproject.toml") || present.has("requirements.txt") || present.has("setup.py");
  if (python) stacks.push("python");
  if (present.has("poetry.lock")) pushUnique(managers, "poetry");
  if (present.has("uv.lock")) pushUnique(managers, "uv");
  if (present.has("Pipfile")) pushUnique(managers, "pipenv");
  if (present.has("requirements.txt") && !managers.includes("poetry") && !managers.includes("uv")) {
    pushUnique(managers, "pip");
  }
  if (present.has("pyproject.toml")) {
    const text = (await readText(path.join(cwd, "pyproject.toml"))) ?? "";
    for (const name of ["django", "fastapi", "flask"]) {
      if (new RegExp(`["']${name}["']`, "i").test(text)) pushUnique(frameworks, name);
    }
    if (/pytest/i.test(text)) pushUnique(testRunners, "pytest");
  }

  if (present.has("go.mod")) {
    stacks.push("go");
    pushUnique(managers, "go");
    pushUnique(testRunners, "go test");
  }
  if (present.has("Cargo.toml")) {
    stacks.push("rust");
    pushUnique(managers, "cargo");
    pushUnique(testRunners, "cargo test");
  }

  const makefileTargets: string[] = [];
  const makefile = present.has("Makefile") ? "Makefile" : present.has("makefile") ? "makefile" : "";
  if (makefile) {
    const text = (await readText(path.join(cwd, makefile))) ?? "";
    for (const line of text.split(/\r?\n/)) {
      const match = /^([A-Za-z0-9][A-Za-z0-9_-]*):/.exec(line);
      if (match?.[1]) makefileTargets.push(match[1]);
    }
  }

  const directories = await existingDirs(cwd, KNOWN_DIRS);
  const workflowsInfo = await stat(path.join(cwd, ".github", "workflows")).catch(() => null);
  const hasCi = Boolean(workflowsInfo?.isDirectory());
  const hasDocker =
    present.has("Dockerfile") || present.has("docker-compose.yml") || present.has("docker-compose.yaml");

  return {
    packageManagers: managers,
    frameworks,
    scripts,
    stacks,
    makefileTargets,
    files,
    projectName,
    projectDescription,
    testRunners,
    directories,
    monorepo,
    hasDocker,
    hasCi,
  };
}

export interface Declaration {
  packageManagers: string[];
  frameworks: string[];
  commands: string[];
  paths: string[];
  sources: string[];
}

export function declarationsFrom(configPm: string | undefined, configFramework: string | undefined, docs: SourceDoc[]): Declaration {
  const packageManagers: string[] = [];
  const frameworks: string[] = [];
  const commands: string[] = [];
  const paths: string[] = [];
  const sources: string[] = [];
  if (configPm) packageManagers.push(configPm);
  if (configFramework) frameworks.push(configFramework);
  for (const doc of docs) {
    if (doc.layer !== "project") continue;
    const pm = asString(doc.data["package_manager"]);
    const framework = asString(doc.data["framework"]);
    if (pm) packageManagers.push(pm);
    if (framework) frameworks.push(framework);
    commands.push(...asStringList(doc.data["commands"]));
    paths.push(...asStringList(doc.data["paths"]));
    const scanned = scanProjectBody(doc.body);
    commands.push(...scanned.commands);
    paths.push(...scanned.paths);
    if (pm || framework || scanned.commands.length || scanned.paths.length || asStringList(doc.data["commands"]).length) {
      sources.push(doc.relPath);
    }
  }
  return {
    packageManagers: unique(packageManagers),
    frameworks: unique(frameworks),
    commands: unique(commands),
    paths: unique(paths),
    sources,
  };
}

export function scanProjectBody(body: string): { commands: string[]; paths: string[] } {
  const commands: string[] = [];
  const paths: string[] = [];
  const run = /\b(?:npm|pnpm|yarn|bun)\s+run\s+([A-Za-z0-9:_-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = run.exec(body))) commands.push(match[0]);
  const make = /\bmake\s+([A-Za-z0-9_-]+)/g;
  while ((match = make.exec(body))) commands.push(match[0]);
  const code = /`([^`\n]+)`/g;
  while ((match = code.exec(body))) {
    const span = match[1] ?? "";
    if (looksLikePath(span)) paths.push(span);
  }
  return { commands, paths };
}

export function looksLikePath(span: string): boolean {
  if (!span || span.length > 180 || /\s/.test(span) || span.includes("*") || span.includes("://")) return false;
  if (span.startsWith("-") || span.startsWith("$") || span.startsWith("~")) return false;
  if (span.includes("/")) return true;
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|toml|json|yml|yaml|md|sh|css|html)$/.test(span);
}

export function commandScript(command: string): { kind: "npm-script" | "make"; name: string } | null {
  const npm = /^(?:npm|pnpm|yarn|bun)\s+run\s+([A-Za-z0-9:_-]+)$/.exec(command.trim());
  if (npm?.[1]) return { kind: "npm-script", name: npm[1] };
  const make = /^make\s+([A-Za-z0-9_-]+)$/.exec(command.trim());
  if (make?.[1]) return { kind: "make", name: make[1] };
  return null;
}

function pushUnique(list: string[], value: string): void {
  if (value && !list.includes(value)) list.push(value);
}

function unique(list: string[]): string[] {
  return [...new Set(list.map((item) => item.trim()).filter(Boolean))];
}

async function existing(cwd: string, names: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const name of names) {
    const info = await stat(path.join(cwd, name)).catch(() => null);
    if (info?.isFile()) found.push(name);
  }
  return found;
}

async function existingDirs(cwd: string, names: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const name of names) {
    const info = await stat(path.join(cwd, name)).catch(() => null);
    if (info?.isDirectory()) found.push(name);
  }
  return found;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const text = (await readText(file)) ?? "";
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
