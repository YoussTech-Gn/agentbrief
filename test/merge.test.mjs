import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compileBrief } from "../dist/compile.js";
import { GLOBAL_TOML, PERSONAL, PROJECT, PROJECT_TOML, compileOptions, makeWorkspace, read, write } from "./helpers.mjs";

async function seed(workspace) {
  await write(path.join(workspace.briefHome, "brief.toml"), GLOBAL_TOML);
  await write(path.join(workspace.briefHome, "preferences.md"), PERSONAL);
  await write(path.join(workspace.cwd, ".brief", "brief.toml"), onlyAgents(PROJECT_TOML));
  await write(path.join(workspace.cwd, ".brief", "project.md"), PROJECT);
}

function onlyAgents(toml) {
  return `${toml}\n[targets]\nagents = true\nclaude = false\ngemini = false\ncursor = false\ncopilot = false\nwindsurf = false\ncodex = false\ngrok = false\n`;
}

test("hand-written files are backed up and preserved below the generated block", async () => {
  const workspace = await makeWorkspace();
  try {
    await seed(workspace);
    const agents = path.join(workspace.cwd, "AGENTS.md");
    await write(agents, "HAND WRITTEN NOTE\nKeep this paragraph.\n");
    const report = await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const merged = report.files.find((file) => file.displayPath === "AGENTS.md");
    assert.equal(merged?.status, "merged");
    assert.ok(merged?.backup);
    const text = await read(agents);
    assert.match(text, /<!-- brief:generated\b/);
    assert.match(text, /HAND WRITTEN NOTE/);
    assert.ok(text.indexOf("brief:end") < text.indexOf("HAND WRITTEN NOTE"));
    const again = await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const second = await read(agents);
    assert.equal(second.split("HAND WRITTEN NOTE").length - 1, 1);
    assert.equal(second.split("brief:generated").length - 1, 1);
    assert.equal(again.files.find((file) => file.displayPath === "AGENTS.md")?.status, "unchanged");
    const backupRoot = path.join(workspace.cwd, ".brief", "backups");
    const entries = await readdir(backupRoot);
    assert.ok(entries.length >= 1);
  } finally {
    await workspace.cleanup();
  }
});

test("a hand-edited generated region is not overwritten unless --force, which keeps a backup", async () => {
  const workspace = await makeWorkspace();
  try {
    await seed(workspace);
    const agents = path.join(workspace.cwd, "AGENTS.md");
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const original = await read(agents);
    const edited = original.replace("Keep functions small.", "HAND EDITED LINE");
    assert.notEqual(edited, original);
    await write(agents, edited);
    const skipped = await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const skippedFile = skipped.files.find((file) => file.displayPath === "AGENTS.md");
    assert.equal(skippedFile?.status, "skipped");
    assert.match(await read(agents), /HAND EDITED LINE/);
    assert.match(await read(`${skippedFile?.backup}.incoming`), /Keep functions small/);
    const forced = await compileBrief(compileOptions(workspace, { scopes: ["project"], force: true }));
    assert.equal(forced.files.find((file) => file.displayPath === "AGENTS.md")?.status, "wrote");
    const restored = await read(agents);
    assert.match(restored, /Keep functions small/);
    assert.doesNotMatch(restored, /HAND EDITED LINE/);
    assert.ok(forced.files.find((file) => file.displayPath === "AGENTS.md")?.backup);
  } finally {
    await workspace.cleanup();
  }
});

test("text outside the generated markers survives a recompile", async () => {
  const workspace = await makeWorkspace();
  try {
    await seed(workspace);
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const agents = path.join(workspace.cwd, "AGENTS.md");
    const text = await read(agents);
    await write(agents, `${text}\nNOTES I WROTE MYSELF\n`);
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const next = await read(agents);
    assert.match(next, /NOTES I WROTE MYSELF/);
    assert.equal(next.split("brief:generated").length - 1, 1);
    await write(path.join(workspace.cwd, ".brief", "project.md"), `${PROJECT}\nExtra project fact.\n`);
    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));
    const updated = await read(agents);
    assert.match(updated, /Extra project fact/);
    assert.match(updated, /NOTES I WROTE MYSELF/);
  } finally {
    await workspace.cleanup();
  }
});
