import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { captureEdits } from "../dist/capture.js";
import { compileBrief } from "../dist/compile.js";
import { installHook, uninstallHook, writeCiWorkflow } from "../dist/hook.js";
import { initBrief } from "../dist/init.js";
import { handleMcpRequest } from "../dist/mcp.js";
import { listPending } from "../dist/proposals.js";
import { matchGlob } from "../dist/scoped.js";
import { compileOptions, GLOBAL_TOML, makeWorkspace, PERSONAL, PROJECT, PROJECT_TOML, read, write } from "./helpers.mjs";

test("smart init detects project metadata, test runner, directories, and monorepo", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(
      path.join(workspace.cwd, "package.json"),
      JSON.stringify({
        name: "acme-api",
        description: "Core billing API",
        packageManager: "pnpm@9.0.0",
        workspaces: ["packages/*"],
        scripts: { test: "vitest run", build: "tsc" },
        dependencies: { fastify: "5.0.0" },
        devDependencies: { vitest: "2.0.0", typescript: "5.8.0" },
      }),
    );
    await write(path.join(workspace.cwd, "Dockerfile"), "FROM node:20\n");
    await write(path.join(workspace.cwd, "src", "server.ts"), "export const ok = true;\n");
    await write(path.join(workspace.cwd, "tests", "server.test.ts"), "export {};\n");
    await write(path.join(workspace.cwd, "packages", "core", "index.ts"), "export {};\n");

    await initBrief({
      cwd: workspace.cwd,
      briefHome: workspace.briefHome,
      global: false,
      project: true,
      yes: true,
    });

    const projectMd = await read(path.join(workspace.cwd, ".brief", "project.md"));
    assert.match(projectMd, /acme-api/);
    assert.match(projectMd, /Core billing API/);
    assert.match(projectMd, /framework: fastify/);
    assert.match(projectMd, /package_manager: pnpm/);
    assert.match(projectMd, /vitest/);
    assert.match(projectMd, /monorepo/);
    assert.match(projectMd, /Docker/);
    assert.match(projectMd, /tests/);
    assert.match(projectMd, /packages/);
  } finally {
    await workspace.cleanup();
  }
});

test("capture turns hand/tool edits inside generated regions into deduplicated proposals", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.briefHome, "brief.toml"), GLOBAL_TOML);
    await write(path.join(workspace.briefHome, "preferences.md"), PERSONAL);
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), PROJECT_TOML);
    await write(path.join(workspace.cwd, ".brief", "project.md"), PROJECT);

    await compileBrief(compileOptions(workspace));

    const claudeFile = path.join(workspace.cwd, "CLAUDE.md");
    const original = await read(claudeFile);
    const modified = original.replace(
      "<!-- brief:end -->",
      "- Always run pnpm instead of npm.\n<!-- brief:end -->",
    );
    await write(claudeFile, modified);

    const first = await captureEdits(compileOptions(workspace, { scopes: ["project"] }));
    assert.equal(first.created.length, 1);
    assert.match(first.created[0].body, /Always run pnpm instead of npm\./);
    assert.equal(first.created[0].source, "capture:claude");

    // Running capture a second time deduplicates against pending proposals.
    const second = await captureEdits(compileOptions(workspace, { scopes: ["project"] }));
    assert.equal(second.created.length, 0);
    assert.equal((await listPending(workspace.cwd, workspace.briefHome)).length, 1);
  } finally {
    await workspace.cleanup();
  }
});

test("hook install, uninstall, and CI workflow generation are idempotent", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.cwd, ".git", "hooks", "pre-commit"), "#!/bin/sh\necho user-hook\n");

    const installed = await installHook(workspace.cwd, "check");
    assert.equal(installed.action, "installed");
    const hookContent = await read(path.join(workspace.cwd, ".git", "hooks", "pre-commit"));
    assert.match(hookContent, /echo user-hook/);
    assert.match(hookContent, /agentbrief check --project/);

    const again = await installHook(workspace.cwd, "check");
    assert.equal(again.action, "unchanged");

    const updated = await installHook(workspace.cwd, "compile");
    assert.equal(updated.action, "updated");
    assert.match(await read(path.join(workspace.cwd, ".git", "hooks", "pre-commit")), /agentbrief compile --project/);

    const removed = await uninstallHook(workspace.cwd);
    assert.equal(removed.action, "removed");
    const afterRemove = await read(path.join(workspace.cwd, ".git", "hooks", "pre-commit"));
    assert.match(afterRemove, /echo user-hook/);
    assert.doesNotMatch(afterRemove, /agentbrief/);

    const ci = await writeCiWorkflow(workspace.cwd);
    assert.equal(ci.action, "installed");
    assert.match(await read(path.join(workspace.cwd, ".github", "workflows", "agentbrief.yml")), /check --project --strict/);
  } finally {
    await workspace.cleanup();
  }
});

test("scoped rules compile to native path-filtered files and match globs", async () => {
  assert.equal(matchGlob("src/api/users.ts", "src/api/**"), true);
  assert.equal(matchGlob("src/ui/button.tsx", "src/api/**"), false);
  assert.equal(matchGlob("src/api/v1/auth.ts", "**/*.ts"), true);

  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.briefHome, "brief.toml"), GLOBAL_TOML);
    await write(path.join(workspace.briefHome, "preferences.md"), PERSONAL);
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), PROJECT_TOML);
    await write(path.join(workspace.cwd, ".brief", "project.md"), PROJECT);
    await write(
      path.join(workspace.cwd, ".brief", "api.md"),
      `---\ntitle: API Rules\napplies_to:\n  - src/api/**\n---\n\nAlways validate request payloads with zod.\n`,
    );

    await compileBrief(compileOptions(workspace, { scopes: ["project"] }));

    const agents = await read(path.join(workspace.cwd, "AGENTS.md"));
    assert.doesNotMatch(agents, /validate request payloads with zod/);

    const cursorScoped = await read(path.join(workspace.cwd, ".cursor", "rules", "brief-api.mdc"));
    assert.match(cursorScoped, /alwaysApply: false/);
    assert.match(cursorScoped, /src\/api\/\*\*/);
    assert.match(cursorScoped, /validate request payloads with zod/);

    const claudeScoped = await read(path.join(workspace.cwd, ".claude", "rules", "brief-api.md"));
    assert.match(claudeScoped, /paths:/);
    assert.match(claudeScoped, /src\/api\/\*\*/);

    const copilotScoped = await read(
      path.join(workspace.cwd, ".github", "instructions", "brief-api.instructions.md"),
    );
    assert.match(copilotScoped, /applyTo:/);
  } finally {
    await workspace.cleanup();
  }
});

test("MCP server handles initialize, tools/list, get_brief, get_rules_for_path, and propose_rule", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(path.join(workspace.briefHome, "brief.toml"), GLOBAL_TOML);
    await write(path.join(workspace.briefHome, "preferences.md"), PERSONAL);
    await write(path.join(workspace.cwd, ".brief", "brief.toml"), PROJECT_TOML);
    await write(path.join(workspace.cwd, ".brief", "project.md"), PROJECT);
    await write(
      path.join(workspace.cwd, ".brief", "api.md"),
      `---\ntitle: API Rules\napplies_to:\n  - src/api/**\n---\n\nReturn RFC 7807 problem details on error.\n`,
    );

    const ctx = { ...compileOptions(workspace), version: "0.2.0" };

    const initRes = await handleMcpRequest({ id: 1, method: "initialize" }, ctx);
    assert.equal(initRes?.result?.serverInfo?.name, "agentbrief");

    const listRes = await handleMcpRequest({ id: 2, method: "tools/list" }, ctx);
    const toolNames = listRes?.result?.tools.map((t) => t.name);
    assert.ok(toolNames.includes("get_brief"));
    assert.ok(toolNames.includes("get_rules_for_path"));
    assert.ok(toolNames.includes("propose_rule"));
    assert.ok(toolNames.includes("check_brief"));

    const rulesRes = await handleMcpRequest(
      { id: 3, method: "tools/call", params: { name: "get_rules_for_path", arguments: { path: "src/api/orders.ts" } } },
      ctx,
    );
    assert.match(rulesRes?.result?.content[0].text, /RFC 7807/);

    const proposeRes = await handleMcpRequest(
      {
        id: 4,
        method: "tools/call",
        params: {
          name: "propose_rule",
          arguments: { title: "Prefer pnpm", body: "Use pnpm instead of npm.", layer: "project" },
        },
      },
      ctx,
    );
    assert.match(proposeRes?.result?.content[0].text, /"status": "pending"/);

    const pending = await listPending(workspace.cwd, workspace.briefHome);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].source, "mcp");
  } finally {
    await workspace.cleanup();
  }
});
