import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compileBrief } from "../dist/compile.js";
import { applyVariant, renderBrief } from "../dist/render.js";
import { GLOBAL_TOML, PERSONAL, PROJECT, PROJECT_TOML, compileOptions, makeWorkspace, read, write } from "./helpers.mjs";

async function seed(workspace, projectToml = PROJECT_TOML, globalToml = GLOBAL_TOML) {
  await write(path.join(workspace.briefHome, "brief.toml"), globalToml);
  await write(path.join(workspace.briefHome, "preferences.md"), PERSONAL);
  await write(path.join(workspace.cwd, ".brief", "brief.toml"), projectToml);
  await write(path.join(workspace.cwd, ".brief", "project.md"), PROJECT);
}

test("short variant drops the detail section and full keeps it", () => {
  const body = "Keep it short.\n\n<!-- brief:detail -->\n\nThe long explanation.";
  assert.equal(applyVariant(body, "short"), "Keep it short.");
  assert.match(applyVariant(body, "full"), /long explanation/);
  assert.doesNotMatch(applyVariant(body, "full"), /brief:detail/);
});

test("compile writes every verified native file and marks it generated", async () => {
  const workspace = await makeWorkspace();
  try {
    await seed(workspace);
    const report = await compileBrief(compileOptions(workspace));
    assert.equal(report.files.some((file) => file.status === "skipped"), false);
    const projectFiles = [
      "CLAUDE.md",
      "AGENTS.md",
      "GEMINI.md",
      path.join(".cursor", "rules", "brief.mdc"),
      path.join(".github", "copilot-instructions.md"),
      path.join(".windsurf", "rules", "brief.md"),
      path.join(".grok", "rules", "brief.md"),
    ];
    for (const rel of projectFiles) {
      const text = await read(path.join(workspace.cwd, rel));
      assert.match(text, /<!-- brief:generated\b/);
      assert.match(text, /<!-- brief:end -->/);
      assert.match(text, /Keep functions small/);
      assert.match(text, /sample service/);
    }
    const cursor = await read(path.join(workspace.cwd, ".cursor", "rules", "brief.mdc"));
    assert.match(cursor, /alwaysApply: true/);
    const windsurf = await read(path.join(workspace.cwd, ".windsurf", "rules", "brief.md"));
    assert.match(windsurf, /trigger: always_on/);
    const globalWindsurf = await read(
      path.join(workspace.userHome, ".codeium", "windsurf", "memories", "global_rules.md"),
    );
    assert.match(globalWindsurf, /<!-- brief:generated\b/);
    assert.doesNotMatch(globalWindsurf, /trigger:/);
    const globals = [
      path.join(workspace.userHome, ".claude", "CLAUDE.md"),
      path.join(workspace.userHome, ".gemini", "GEMINI.md"),
      path.join(workspace.userHome, ".codex", "AGENTS.md"),
      path.join(workspace.userHome, ".cursor", "rules", "brief.mdc"),
      path.join(workspace.userHome, ".copilot", "copilot-instructions.md"),
      path.join(workspace.userHome, ".grok", "AGENTS.md"),
    ];
    for (const file of globals) {
      const text = await read(file);
      assert.match(text, /Keep functions small/);
      assert.doesNotMatch(text, /sample service/);
    }
    const cursorGlobal = await read(path.join(workspace.userHome, ".cursor", "rules", "brief.mdc"));
    assert.match(cursorGlobal, /alwaysApply: true/);
  } finally {
    await workspace.cleanup();
  }
});

test("layered composition keeps the personal layer out of project files", async () => {
  const workspace = await makeWorkspace();
  try {
    await seed(workspace, `version = 1\ncomposition = "layered"\nstacks = []\nvariant = "full"\n`);
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const agents = await read(path.join(workspace.cwd, "AGENTS.md"));
    assert.match(agents, /sample service/);
    assert.doesNotMatch(agents, /Keep functions small/);
  } finally {
    await workspace.cleanup();
  }
});

test("short compile omits detail and a tiny budget warns without skipping the write", async () => {
  const workspace = await makeWorkspace();
  try {
    await seed(
      workspace,
      PROJECT_TOML,
      `version = 1\nvariant = "full"\nstacks = []\nprofile = "native"\n[budget]\nfull = 1\nshort = 1\n[targets]\nagents = true\nclaude = false\ngemini = false\ncursor = false\ncopilot = false\nwindsurf = false\ncodex = false\ngrok = false\n`,
    );
    const report = await compileBrief(compileOptions(workspace, { scopes: ["project"], variant: "short" }));
    const agents = await read(path.join(workspace.cwd, "AGENTS.md"));
    assert.match(agents, /Keep functions small/);
    assert.doesNotMatch(agents, /not obvious/);
    assert.equal(report.files.some((file) => file.overBudget), true);
    assert.ok(report.warnings.some((warning) => warning.includes("token budget")));
    await access(path.join(workspace.cwd, "AGENTS.md"));
    await assert.rejects(access(path.join(workspace.cwd, "CLAUDE.md")));
  } finally {
    await workspace.cleanup();
  }
});

test("lean profile does not write the files that would double-load", async () => {
  const workspace = await makeWorkspace();
  try {
    await seed(workspace, `version = 1\nprofile = "lean"\nstacks = []\n`);
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    await access(path.join(workspace.cwd, "AGENTS.md"));
    await access(path.join(workspace.cwd, "CLAUDE.md"));
    await assert.rejects(access(path.join(workspace.cwd, ".cursor", "rules", "brief.mdc")));
    await assert.rejects(access(path.join(workspace.cwd, ".windsurf", "rules", "brief.md")));
    await assert.rejects(access(path.join(workspace.cwd, ".grok", "rules", "brief.md")));
  } finally {
    await workspace.cleanup();
  }
});

test("render lists layers in personal, stack, project order", () => {
  const doc = (layer, title, body) => ({
    absPath: title,
    relPath: `${title}.md`,
    layer,
    stackId: layer === "stack" ? title : undefined,
    title,
    order: 1,
    body,
    data: {},
  });
  const text = renderBrief({
    variant: "full",
    composition: "full",
    scope: "project",
    personal: [doc("personal", "Who", "A person.")],
    stacks: [doc("stack", "typescript", "Strict.")],
    project: [doc("project", "Repo", "One service.")],
  });
  assert.ok(text.indexOf("A person.") < text.indexOf("Strict."));
  assert.ok(text.indexOf("Strict.") < text.indexOf("One service."));
  assert.match(text, /Do not edit this block by hand/);
});
