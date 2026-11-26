import { appendFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { detectProject } from "./detect.js";
import { ensureRepo, initialCommit } from "./sync.js";
import {
  globalConfig,
  globalGitignore,
  globalReadme,
  goalsTemplate,
  identityTemplate,
  methodologyTemplate,
  preferencesTemplate,
  projectConfig,
  projectTemplate,
  stackTemplate,
  type TemplateContext,
} from "./templates.js";
import type { Profile } from "./types.js";
import { assertUnlinked, guardRoot, readText, writeText } from "./util.js";

const FRAMEWORK_PRIORITY = [
  "next",
  "angular",
  "svelte",
  "vue",
  "fastapi",
  "django",
  "flask",
  "express",
  "fastify",
  "react",
  "vite",
];

const KNOWN_STACKS = ["typescript", "python", "go", "rust"];

export interface InitOptions {
  cwd: string;
  briefHome: string;
  global: boolean;
  project: boolean;
  yes: boolean;
  profile?: Profile;
  name?: string;
  focus?: string;
  stacks?: string[];
  prompt?: (question: string, fallback: string) => Promise<string>;
}

export interface InitResult {
  messages: string[];
  created: string[];
  kept: string[];
}

export async function initBrief(options: InitOptions): Promise<InitResult> {
  guardRoot(options.cwd);
  const doGlobal = options.global || !options.project;
  const doProject = options.project || !options.global;
  const facts = await detectProject(options.cwd);
  const detectedStacks = facts.stacks.filter((id) => KNOWN_STACKS.includes(id));
  const answers = await collectAnswers(options, detectedStacks);
  const packageManager = facts.packageManagers.length === 1 ? facts.packageManagers[0] : undefined;
  const framework = FRAMEWORK_PRIORITY.find((name) => facts.frameworks.includes(name));
  const commands: string[] = [];
  if (packageManager && ["npm", "pnpm", "yarn", "bun"].includes(packageManager)) {
    for (const script of ["test", "lint", "typecheck", "build", "dev"]) {
      if (facts.scripts.includes(script)) commands.push(`${packageManager} run ${script}`);
    }
  }
  for (const target of ["test", "lint", "build"]) {
    if (facts.makefileTargets.includes(target)) commands.push(`make ${target}`);
  }
  const paths = [...facts.directories];
  if (paths.length === 0) {
    const src = await stat(path.join(options.cwd, "src")).catch(() => null);
    if (src?.isDirectory()) paths.push("src");
  }
  const ctx: TemplateContext = {
    name: answers.name,
    focus: answers.focus,
    stacks: answers.stacks,
    profile: answers.profile,
    packageManager,
    framework,
    commands,
    paths,
    projectName: facts.projectName,
    projectDescription: facts.projectDescription,
    testRunners: facts.testRunners,
    monorepo: facts.monorepo,
    hasDocker: facts.hasDocker,
    hasCi: facts.hasCi,
  };
  const messages: string[] = [];
  const created: string[] = [];
  const kept: string[] = [];
  if (doGlobal) {
    await writeGlobal(options.briefHome, ctx, created, kept);
    try {
      ensureRepo(options.briefHome);
      if (initialCommit(options.briefHome)) messages.push("Created a git repo in the personal brief.");
    } catch (error) {
      messages.push(`Personal files are in place, but git init did not finish: ${error instanceof Error ? error.message : "git failed"}.`);
    }
    messages.push(`Personal brief: ${options.briefHome}`);
  }
  if (doProject) {
    // Only name stacks whose file exists. A declared stack with no file is a
    // check error, so naming one that init did not create would fail at once.
    const projectStacks: string[] = [];
    for (const id of ctx.stacks) {
      const file = path.join(options.briefHome, "stacks", `${id}.md`);
      if ((await stat(file).catch(() => null))?.isFile()) projectStacks.push(id);
    }
    await writeProject(options.cwd, { ...ctx, stacks: projectStacks }, created, kept);
    await ensureProjectGitignore(options.cwd);
    messages.push(`Project brief: ${path.join(options.cwd, ".brief")}`);
  }
  if (facts.packageManagers.length > 1) {
    messages.push(
      `Detected more than one package manager (${facts.packageManagers.join(", ")}), so none was declared. Set package_manager in .brief/brief.toml when you know which one this repo uses.`,
    );
  }
  messages.push("Next: edit the markdown, then run `agentbrief compile`.");
  return { messages, created, kept };
}

async function collectAnswers(
  options: InitOptions,
  detectedStacks: string[],
): Promise<{ name: string; focus: string; stacks: string[]; profile: Profile }> {
  const fallbackName = options.name || process.env["USER"] || "the builder";
  const fallbackFocus = options.focus || "I build software by shipping a thin working slice and then tightening it.";
  const fallbackStacks = options.stacks ?? (detectedStacks.length > 0 ? detectedStacks : []);
  const fallbackProfile = options.profile ?? "native";
  if (options.yes || !options.prompt) {
    return { name: fallbackName, focus: fallbackFocus, stacks: cleanStacks(fallbackStacks), profile: fallbackProfile };
  }
  const ask = options.prompt;
  const name = (await ask("Your name", fallbackName)).trim() || fallbackName;
  const focus = (await ask("What do you build, in one sentence", fallbackFocus)).trim() || fallbackFocus;
  const stackAnswer = (
    await ask(`Stacks to include (${KNOWN_STACKS.join(", ")}; comma separated)`, fallbackStacks.join(", ") || "none")
  ).trim();
  const stacks = cleanStacks(parseStacks(stackAnswer));
  const profileAnswer = (await ask("Profile: native (every tool file) or lean (skip files tools would double-load)", fallbackProfile)).trim();
  const profile: Profile = profileAnswer === "lean" ? "lean" : "native";
  return { name, focus, stacks, profile };
}

function parseStacks(answer: string): string[] {
  if (!answer || answer === "none") return [];
  return answer
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

function cleanStacks(ids: string[]): string[] {
  return ids.filter((id) => /^[a-z0-9][a-z0-9_-]*$/.test(id));
}

async function writeGlobal(briefHome: string, ctx: TemplateContext, created: string[], kept: string[]): Promise<void> {
  await assertUnlinked(path.join(briefHome, "stacks"));
  await mkdir(path.join(briefHome, "stacks"), { recursive: true });
  await createIfMissing(path.join(briefHome, "README.md"), globalReadme(), created, kept);
  await createIfMissing(path.join(briefHome, ".gitignore"), globalGitignore(), created, kept);
  await createIfMissing(path.join(briefHome, "brief.toml"), globalConfig(ctx), created, kept);
  await createIfMissing(path.join(briefHome, "identity.md"), identityTemplate(ctx), created, kept);
  await createIfMissing(path.join(briefHome, "methodology.md"), methodologyTemplate(), created, kept);
  await createIfMissing(path.join(briefHome, "preferences.md"), preferencesTemplate(), created, kept);
  await createIfMissing(path.join(briefHome, "goals.md"), goalsTemplate(), created, kept);
  for (const id of ctx.stacks.filter((stack) => /^[a-z0-9][a-z0-9_-]*$/.test(stack))) {
    await createIfMissing(path.join(briefHome, "stacks", `${id}.md`), stackTemplate(id), created, kept);
  }
}

async function writeProject(cwd: string, ctx: TemplateContext, created: string[], kept: string[]): Promise<void> {
  await assertUnlinked(path.join(cwd, ".brief"));
  await mkdir(path.join(cwd, ".brief"), { recursive: true });
  await createIfMissing(path.join(cwd, ".brief", "brief.toml"), projectConfig(ctx), created, kept);
  await createIfMissing(path.join(cwd, ".brief", "project.md"), projectTemplate(ctx), created, kept);
}

async function createIfMissing(file: string, contents: string, created: string[], kept: string[]): Promise<void> {
  if ((await readText(file)) !== null) {
    kept.push(file);
    return;
  }
  await writeText(file, contents.endsWith("\n") ? contents : `${contents}\n`);
  created.push(file);
}

async function ensureProjectGitignore(cwd: string): Promise<void> {
  const file = path.join(cwd, ".gitignore");
  const marker = ".brief/backups/";
  const existing = (await readText(file)) ?? "";
  if (existing.includes(marker)) return;
  const block = `${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}# brief local state\n.brief/backups/\n.brief/inbox/\n`;
  if (existing.length === 0) await writeText(file, block.replace(/^\n/, ""));
  else await appendFile(file, block);
}
