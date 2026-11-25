import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { checkBrief } from "../dist/check.js";
import { compileBrief } from "../dist/compile.js";
import { GLOBAL_TOML, PERSONAL, compileOptions, makeWorkspace, read, write } from "./helpers.mjs";

function errors(report) {
  return report.findings.filter((finding) => finding.severity === "error");
}

async function seedCompiled(workspace) {
  await write(path.join(workspace.briefHome, "brief.toml"), GLOBAL_TOML);
  await write(path.join(workspace.briefHome, "preferences.md"), PERSONAL);
  await write(
    path.join(workspace.cwd, ".brief", "brief.toml"),
    `version = 1\ncomposition = "full"\nstacks = []\n[targets]\nagents = true\nclaude = false\ngemini = false\ncursor = false\ncopilot = false\nwindsurf = false\ncodex = false\ngrok = false\n`,
  );
  await write(
    path.join(workspace.cwd, ".brief", "project.md"),
    `---\ntitle: Project\norder: 10\npaths:\n  - src/index.js\n---\n\n# Project\n\nOne module.\n`,
  );
  await write(path.join(workspace.cwd, "src", "index.js"), "export const health = () => ({ ok: true });\n");
  await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
}

test("a fresh compile checks clean", async () => {
  const workspace = await makeWorkspace();
  try {
    await seedCompiled(workspace);
    const report = await checkBrief(compileOptions(workspace, { scopes: ["project"] }));
    assert.deepEqual(errors(report), []);
    assert.equal(report.files[0]?.status, "ok");
  } finally {
    await workspace.cleanup();
  }
});

test("hand edits and stale sources are different findings", async () => {
  const workspace = await makeWorkspace();
  try {
    await seedCompiled(workspace);
    const agents = path.join(workspace.cwd, "AGENTS.md");
    const original = await read(agents);
    await write(agents, original.replace("One module.", "EDITED BY HAND"));
    const edited = await checkBrief(compileOptions(workspace, { scopes: ["project"] }));
    assert.ok(errors(edited).some((finding) => finding.code === "edited"));
    await write(agents, original);
    await write(
      path.join(workspace.cwd, ".brief", "project.md"),
      `---\ntitle: Project\norder: 10\npaths:\n  - src/index.js\n---\n\n# Project\n\nA different module.\n`,
    );
    const stale = await checkBrief(compileOptions(workspace, { scopes: ["project"] }));
    assert.ok(errors(stale).some((finding) => finding.code === "stale"));
    assert.equal(errors(stale).some((finding) => finding.code === "edited"), false);
  } finally {
    await workspace.cleanup();
  }
});

test("check flags missing scripts, paths, package manager, and framework", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.briefHome, "brief.toml"), `version = 1\nstacks = []\n[targets]\nagents = true\nclaude = false\ngemini = false\ncursor = false\ncopilot = false\nwindsurf = false\ncodex = false\ngrok = false\n`);
    await write(path.join(workspace.briefHome, "preferences.md"), PERSONAL);
    await write(
      path.join(workspace.cwd, "package.json"),
      JSON.stringify({ name: "demo", scripts: { test: "node --test" }, dependencies: { express: "4.0.0" } }),
    );
    await write(path.join(workspace.cwd, "package-lock.json"), "{}\n");
    await write(
      path.join(workspace.cwd, ".brief", "brief.toml"),
      `version = 1\nstacks = []\npackage_manager = "pnpm"\nframework = "next"\n[targets]\nagents = true\nclaude = false\ngemini = false\ncursor = false\ncopilot = false\nwindsurf = false\ncodex = false\ngrok = false\n`,
    );
    await write(
      path.join(workspace.cwd, ".brief", "project.md"),
      `---\ntitle: Project\ncommands:\n  - npm run lint\npaths:\n  - src/missing.ts\n  - src/index.js\n---\n\n# Project\n\nRun \\\`npm run lint\\\` before you stop.\n`,
    );
    await write(path.join(workspace.cwd, "src", "index.js"), "export {};\n");
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const report = await checkBrief(compileOptions(workspace, { scopes: ["project"] }));
    const codes = errors(report).map((finding) => finding.code);
    assert.ok(codes.includes("command"), codes.join(","));
    assert.ok(codes.includes("path"), codes.join(","));
    assert.ok(codes.includes("package-manager"), codes.join(","));
    assert.ok(codes.includes("framework"), codes.join(","));
    assert.equal(
      errors(report).some((finding) => finding.path === "src/index.js"),
      false,
    );
  } finally {
    await workspace.cleanup();
  }
});
