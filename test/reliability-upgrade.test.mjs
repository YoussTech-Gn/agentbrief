import assert from "node:assert/strict";
import test from "node:test";
import { baseConfig, configFromToml, mergeConfig } from "../dist/config.js";
import { globalConfig, projectConfig } from "../dist/templates.js";

test("personal layer is private by default in new configurations", () => {
  assert.equal(baseConfig().composition, "layered");
  const ctx = { name: "Test", focus: "Test", stacks: [], profile: "native", commands: [], paths: [] };
  assert.match(globalConfig(ctx), /composition = "layered"/);
  assert.match(projectConfig(ctx), /composition = "layered"/);
});

test("partial project target settings preserve global target exclusions", () => {
  const global = configFromToml({ targets: { cursor: false, grok: false } });
  const project = configFromToml({ targets: { claude: true } });
  const result = mergeConfig(global, project);
  assert.equal(result.targets.cursor, false);
  assert.equal(result.targets.grok, false);
  assert.equal(result.targets.claude, true);
  assert.equal(result.targets.agents, true);
});
import path from "node:path";
import { mkdir, symlink, unlink } from "node:fs/promises";
import { compileBrief } from "../dist/compile.js";
import { checkBrief } from "../dist/check.js";
import { compileOptions, makeWorkspace, read, write } from "./helpers.mjs";

test("scoped rules update globs, prune clean orphans and retain local edits", async () => {
  const workspace = await makeWorkspace();
  try {
    const options = compileOptions(workspace, { scopes: ["project"] });
    const source = path.join(workspace.cwd, ".brief", "api.md");
    const rule = glob => `---\napplies_to: ["${glob}"]\n---\nValidate input.\n`;
    const cursor = path.join(workspace.cwd, ".cursor/rules/brief-api.mdc");
    const claude = path.join(workspace.cwd, ".claude/rules/brief-api.md");
    await write(source, rule("api/**"));
    await compileBrief(options);
    await write(source, rule("lib/**"));
    assert.ok((await checkBrief(options)).findings.some(f => f.code === "stale"));
    await compileBrief(options);
    assert.match(await read(cursor), /lib\/\*\*/);
    const edited = (await read(cursor)).replace("lib/**", "custom/**");
    await write(cursor, edited);
    await unlink(source);
    await compileBrief({ ...options, dryRun: true });
    assert.match(await read(claude), /lib\/\*\*/);
    await compileBrief(options);
    await assert.rejects(read(claude), { code: "ENOENT" });
    assert.equal(await read(cursor), edited);
    assert.ok((await checkBrief(options)).findings.some(f => f.code === "orphan"));
  } finally {
    await workspace.cleanup();
  }
});

test("duplicate sections render once and scoped name collisions fail before writing", async () => {
  const workspace = await makeWorkspace();
  try {
    const options = compileOptions(workspace, { scopes: ["project"] });
    const dir = path.join(workspace.cwd, ".brief");
    for (const name of ["a-b", "a b"]) await write(path.join(dir, name + ".md"), "# Shared\nSame instruction.");
    await compileBrief(options);
    assert.equal((await read(path.join(workspace.cwd, "AGENTS.md"))).split("Same instruction.").length, 2);
    for (const name of ["a-b", "a b"]) await write(path.join(dir, name + ".md"), '---\napplies_to: ["src/**"]\n---\nScoped');
    await assert.rejects(compileBrief(options), /Multiple rules target/);
  } finally {
    await workspace.cleanup();
  }
});

test("compile rejects a linked output directory", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.cwd, ".brief", "project.md"), "Instructions.");
    const outside = path.join(workspace.root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(workspace.cwd, ".cursor"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(compileBrief(compileOptions(workspace, { scopes: ["project"] })), /symbolic link/);
    await assert.rejects(read(path.join(outside, "rules", "brief.mdc")), { code: "ENOENT" });
  } finally {
    await workspace.cleanup();
  }
});
