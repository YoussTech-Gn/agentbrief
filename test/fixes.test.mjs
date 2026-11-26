import assert from "node:assert/strict";
import { lstat, mkdir, readlink, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { captureEdits } from "../dist/capture.js";
import { checkBrief } from "../dist/check.js";
import { compileBrief } from "../dist/compile.js";
import { applyProfile, configFromToml, mergeConfig } from "../dist/config.js";
import { parseFrontMatter } from "../dist/frontmatter.js";
import { installHook, writeCiWorkflow } from "../dist/hook.js";
import { handleMcpRequest } from "../dist/mcp.js";
import { acceptProposal, listPending, proposeChange } from "../dist/proposals.js";
import { parseToml } from "../dist/toml.js";
import { compileOptions, git, makeWorkspace, read, runCli, write } from "./helpers.mjs";

const ONLY_AGENTS = `version = 1\nstacks = []\n[targets]\nagents = true\nclaude = false\ngemini = false\ncursor = false\ncopilot = false\nwindsurf = false\ncodex = false\ngrok = false\n`;

function errors(report) {
  return report.findings.filter((finding) => finding.severity === "error");
}

function warnings(report) {
  return report.findings.filter((finding) => finding.severity === "warning");
}

async function typescriptRepo(workspace) {
  await write(
    path.join(workspace.cwd, "package.json"),
    JSON.stringify({ name: "demo", scripts: { test: "node --test", build: "tsc" }, devDependencies: { typescript: "5.0.0" } }),
  );
  await write(path.join(workspace.cwd, "tsconfig.json"), "{}");
  await write(path.join(workspace.cwd, "package-lock.json"), "{}");
  await mkdir(path.join(workspace.cwd, "src"), { recursive: true });
}

// 1 ─ README quick start, run literally.
test("the README quick start passes check on a TypeScript repo", async () => {
  const workspace = await makeWorkspace();
  try {
    await typescriptRepo(workspace);
    const init = runCli(["init", "--project", "--yes"], workspace);
    assert.equal(init.status, 0, init.stderr);
    assert.doesNotMatch(await read(path.join(workspace.cwd, ".brief", "brief.toml")), /^stacks/m);
    const project = path.join(workspace.cwd, ".brief", "project.md");
    await write(project, `${await read(project)}\nRun \`npm test\` before submitting a change.\n`);
    const dry = runCli(["compile", "--project", "--dry-run"], workspace);
    assert.equal(dry.status, 0, dry.stderr + dry.stdout);
    const compile = runCli(["compile", "--project"], workspace);
    assert.equal(compile.status, 0, compile.stderr + compile.stdout);
    assert.match(compile.stdout, /typescript/);
    assert.match(await read(path.join(workspace.cwd, "CLAUDE.md")), /npm test/);
    assert.match(await read(path.join(workspace.cwd, "AGENTS.md")), /npm test/);
    const check = runCli(["check", "--project"], workspace);
    assert.equal(check.status, 0, check.stdout + check.stderr);
  } finally {
    await workspace.cleanup();
  }
});

test("a stack declared by hand with no file is still an error", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS.replace("stacks = []", 'stacks = ["typscript"]'));
    await write(path.join(workspace.cwd, ".brief", "project.md"), "# Project\n\nOne module.\n");
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const report = await checkBrief(compileOptions(workspace, { scopes: ["project"] }));
    assert.ok(errors(report).some((finding) => finding.code === "stack" && /typscript/.test(finding.message)));
  } finally {
    await workspace.cleanup();
  }
});

test("init --project keeps a stack whose file already exists", async () => {
  const workspace = await makeWorkspace();
  try {
    await typescriptRepo(workspace);
    await write(path.join(workspace.briefHome, "stacks", "typescript.md"), "# TypeScript\n\nStrict.\n");
    const init = runCli(["init", "--project", "--yes"], workspace);
    assert.equal(init.status, 0, init.stderr);
    assert.match(await read(path.join(workspace.cwd, ".brief", "brief.toml")), /^stacks = \["typescript"\]/m);
  } finally {
    await workspace.cleanup();
  }
});

// 2 ─ Backtick text is not a hard path claim.
test("backtick spans found in prose are warnings, declared paths stay errors", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS);
    await write(
      path.join(workspace.cwd, ".brief", "project.md"),
      "---\ntitle: Project\npaths:\n  - src/missing.ts\n---\n\n# Project\n\nInstall `@types/node`, branch from `feat/login`, send `application/json`.\n",
    );
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const report = await checkBrief(compileOptions(workspace, { scopes: ["project"] }));
    const pathErrors = errors(report).filter((finding) => finding.code === "path");
    assert.deepEqual(pathErrors.map((finding) => finding.path), ["src/missing.ts"]);
    const pathWarnings = warnings(report).filter((finding) => finding.code === "path").map((finding) => finding.path);
    assert.ok(pathWarnings.includes("feat/login"));
    assert.equal(pathWarnings.includes("@types/node"), false);
  } finally {
    await workspace.cleanup();
  }
});

// 3 ─ Symbolic links: trusted outside the project, refused inside it.
test("a symlinked tool home outside the project is followed, and the link survives", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.briefHome, "preferences.md"), "# Preferences\n\nKeep it small.\n");
    const dotfiles = path.join(workspace.root, "dotfiles", "claude");
    await mkdir(dotfiles, { recursive: true });
    await symlink(dotfiles, path.join(workspace.userHome, ".claude"), process.platform === "win32" ? "junction" : "dir");
    // A dotfiles manager that links the file itself (GNU stow style).
    const geminiReal = path.join(workspace.root, "dotfiles", "GEMINI.md");
    await write(geminiReal, "");
    await mkdir(path.join(workspace.userHome, ".gemini"), { recursive: true });
    await symlink(geminiReal, path.join(workspace.userHome, ".gemini", "GEMINI.md"));
    const report = await compileBrief(compileOptions(workspace, { scopes: ["global"] }));
    assert.equal(report.files.some((file) => file.status === "skipped"), false);
    assert.match(await read(path.join(dotfiles, "CLAUDE.md")), /Keep it small/);
    assert.ok((await lstat(path.join(workspace.userHome, ".gemini", "GEMINI.md"))).isSymbolicLink());
    assert.equal(await readlink(path.join(workspace.userHome, ".gemini", "GEMINI.md")), geminiReal);
    assert.match(await read(geminiReal), /Keep it small/);
  } finally {
    await workspace.cleanup();
  }
});

test("a project file linked to a file outside the repo is refused", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS);
    await write(path.join(workspace.cwd, ".brief", "project.md"), "# Project\n\nOne module.\n");
    const secret = path.join(workspace.root, "secret.txt");
    await write(secret, "TOP SECRET\n");
    await symlink(secret, path.join(workspace.cwd, "AGENTS.md"));
    await assert.rejects(compileBrief(compileOptions(workspace, { scopes: ["project"] })), /symbolic link/);
    assert.equal(await read(secret), "TOP SECRET\n");
  } finally {
    await workspace.cleanup();
  }
});

test("a project that itself lives under a symlinked directory still compiles", async () => {
  const workspace = await makeWorkspace();
  try {
    const linkedCwd = path.join(workspace.root, "linked-project");
    await symlink(workspace.cwd, linkedCwd, process.platform === "win32" ? "junction" : "dir");
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS);
    await write(path.join(workspace.cwd, ".brief", "project.md"), "# Project\n\nOne module.\n");
    const options = { ...compileOptions(workspace, { scopes: ["project"] }), cwd: linkedCwd };
    await compileBrief(options);
    assert.match(await read(path.join(workspace.cwd, "AGENTS.md")), /One module/);
  } finally {
    await workspace.cleanup();
  }
});

// 4 ─ Unknown frameworks cannot be verified, so they warn.
test("an unknown framework is a warning, a known missing framework is an error", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.cwd, "package.json"), JSON.stringify({ name: "x", dependencies: { hono: "4.0.0" } }));
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS.replace("version = 1", 'version = 1\nframework = "NestJS"'));
    await write(path.join(workspace.cwd, ".brief", "project.md"), "# Project\n\nOne module.\n");
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    let report = await checkBrief(compileOptions(workspace, { scopes: ["project"] }));
    assert.equal(errors(report).some((finding) => finding.code === "framework"), false);
    assert.ok(warnings(report).some((finding) => finding.code === "framework" && /NestJS/.test(finding.message)));

    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS.replace("version = 1", 'version = 1\nframework = "next"'));
    report = await checkBrief(compileOptions(workspace, { scopes: ["project"] }));
    assert.ok(errors(report).some((finding) => finding.code === "framework"));
  } finally {
    await workspace.cleanup();
  }
});

// 5 ─ Front matter.
test("front matter reads flow lists and keeps # inside quoted values", () => {
  const parsed = parseFrontMatter('---\napplies_to: ["src/api/**", \'lib/*.ts\']\nglobs: [a, b]\ntitle: "C# #1 tips" # comment\n---\nBody\n');
  assert.deepEqual(parsed.data["applies_to"], ["src/api/**", "lib/*.ts"]);
  assert.deepEqual(parsed.data["globs"], ["a", "b"]);
  assert.equal(parsed.data["title"], "C# #1 tips");
});

test("front matter refuses what it cannot read, and compile names the file", async () => {
  assert.throws(() => parseFrontMatter("---\nmeta:\n  owner: ada\n---\nBody\n"), /line 3/);
  assert.throws(() => parseFrontMatter("---\nnotes: |\n  one\n---\nBody\n"), /block scalar/);
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS);
    await write(path.join(workspace.cwd, ".brief", "api.md"), "---\nmeta:\n  owner: ada\n---\nBody\n");
    await assert.rejects(compileBrief(compileOptions(workspace, { scopes: ["project"] })), /api\.md/);
  } finally {
    await workspace.cleanup();
  }
});

test("a flow-list applies_to compiles to a real glob", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS.replace("claude = false", "claude = true"));
    await write(path.join(workspace.cwd, ".brief", "api.md"), '---\ntitle: API\napplies_to: ["src/api/**"]\n---\nValidate input.\n');
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const rule = await read(path.join(workspace.cwd, ".claude", "rules", "brief-api.md"));
    assert.match(rule, /- "src\/api\/\*\*"/);
  } finally {
    await workspace.cleanup();
  }
});

// 6 ─ TOML.
test("TOML reads multi-line arrays, floats, and escapes", () => {
  const toml = parseToml('version = 1\nstacks = [\n  "go", # main\n  "rust",\n]\nname = "a\\\\nb \\"q\\" # not a comment"\n[budget]\nchars_per_token = 3.5\n');
  assert.deepEqual(toml["stacks"], ["go", "rust"]);
  assert.equal(toml["name"], 'a\\nb "q" # not a comment');
  assert.equal(toml["budget"]["chars_per_token"], 3.5);
});

test("TOML refuses lines it cannot read and says which line", () => {
  assert.throws(() => parseToml("version = 1\nvariant = full\n"), /line 2/);
  assert.throws(() => parseToml("version = 1\njust some words\n"), /line 2/);
  assert.throws(() => parseToml('stacks = [\n  "go"\n'), /unclosed array/);
});

// 7 ─ Capture does not re-propose accepted text.
test("capture --include-outside does not re-capture accepted text", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS);
    await write(path.join(workspace.cwd, ".brief", "project.md"), "# Project\n\nOne module.\n");
    const options = compileOptions(workspace, { scopes: ["project"], includeOutside: true });
    await compileBrief(options);
    const agents = path.join(workspace.cwd, "AGENTS.md");
    await write(agents, `${await read(agents)}\n- Always use pnpm\n`);
    const first = await captureEdits(options);
    assert.equal(first.created.length, 1);
    await acceptProposal(workspace.cwd, workspace.briefHome, first.created[0].id);
    await compileBrief(options);
    const second = await captureEdits(options);
    assert.equal(second.created.length, 0);
    await write(agents, `${await read(agents)}- Prefer early returns\n`);
    const third = await captureEdits(options);
    assert.equal(third.created.length, 1);
    assert.doesNotMatch(third.created[0].body, /pnpm/);
    assert.match(third.created[0].body, /early returns/);
  } finally {
    await workspace.cleanup();
  }
});

// 8 ─ --native respects a target you turned off yourself.
test("--native re-enables lean targets but not a target set to false", () => {
  const config = mergeConfig(configFromToml(parseToml('profile = "lean"\n')), configFromToml(parseToml("[targets]\ngrok = false\n")));
  const lean = applyProfile(config, undefined);
  assert.equal(lean.targets.cursor, false);
  const native = applyProfile(config, "native");
  assert.equal(native.targets.cursor, true);
  assert.equal(native.targets.windsurf, true);
  assert.equal(native.targets.grok, false);
});

// 9 ─ MCP stack proposal needs a file.
test("MCP propose_rule on the stack layer needs a file", async () => {
  const workspace = await makeWorkspace();
  try {
    const ctx = { ...compileOptions(workspace), version: "test" };
    const res = await handleMcpRequest(
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "propose_rule", arguments: { title: "t", body: "b", layer: "stack" } } },
      ctx,
    );
    assert.equal(res.result.isError, true);
    assert.match(res.result.content[0].text, /--file|file/);
    assert.deepEqual(await listPending(workspace.cwd, workspace.briefHome), []);
  } finally {
    await workspace.cleanup();
  }
});

// Group B.
test("two proposals with the same title in the same second get different ids", async () => {
  const workspace = await makeWorkspace();
  try {
    const input = { cwd: workspace.cwd, briefHome: workspace.briefHome, title: "Same", body: "one", layer: "personal", file: "preferences.md", action: "append", source: "cli" };
    const a = await proposeChange(input);
    const b = await proposeChange({ ...input, body: "two" });
    assert.notEqual(a.id, b.id);
    assert.equal((await listPending(workspace.cwd, workspace.briefHome)).length, 2);
  } finally {
    await workspace.cleanup();
  }
});

test("the hook fails the commit on error and follows core.hooksPath and worktrees", async () => {
  const workspace = await makeWorkspace();
  try {
    git(workspace.cwd, ["init", "-q"]);
    git(workspace.cwd, ["config", "core.hooksPath", ".husky"]);
    const res = await installHook(workspace.cwd, "check");
    assert.equal(await realpath(res.file), path.join(await realpath(workspace.cwd), ".husky", "pre-commit"));
    const hook = await read(res.file);
    assert.match(hook, /agentbrief check --project \|\| exit 1/);

    const repo = path.join(workspace.root, "repo");
    await mkdir(repo);
    git(repo, ["init", "-q"]);
    await write(path.join(repo, "a.txt"), "a");
    git(repo, ["add", "a.txt"]);
    git(repo, ["commit", "-qm", "init"]);
    const tree = path.join(workspace.root, "tree");
    git(repo, ["worktree", "add", "-q", tree]);
    const inTree = await installHook(tree, "compile");
    assert.match(await read(inTree.file), /agentbrief compile --project --stage \|\| exit 1/);
    // git prints the resolved path; on macOS the temp dir sits under the /var -> /private/var link.
    assert.ok((await realpath(inTree.file)).startsWith(path.join(await realpath(repo), ".git")));
  } finally {
    await workspace.cleanup();
  }
});

test("compile --stage adds the generated files to the git index", async () => {
  const workspace = await makeWorkspace();
  try {
    git(workspace.cwd, ["init", "-q"]);
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), ONLY_AGENTS);
    await write(path.join(workspace.cwd, ".brief", "project.md"), "# Project\n\nOne module.\n");
    const res = runCli(["compile", "--project", "--stage"], workspace);
    assert.equal(res.status, 0, res.stderr + res.stdout);
    const staged = git(workspace.cwd, ["diff", "--cached", "--name-only"]).split("\n");
    assert.ok(staged.includes("AGENTS.md"));
    assert.ok(staged.includes(".brief/manifest.json"));
    assert.equal(staged.includes(".brief/project.md"), false);
  } finally {
    await workspace.cleanup();
  }
});

test("the generated CI workflow pins the running version", async () => {
  const workspace = await makeWorkspace();
  try {
    await writeCiWorkflow(workspace.cwd, false, "9.8.7");
    assert.match(await read(path.join(workspace.cwd, ".github", "workflows", "agentbrief.yml")), /@coddrex\/agentbrief@9\.8\.7 check/);
  } finally {
    await workspace.cleanup();
  }
});
