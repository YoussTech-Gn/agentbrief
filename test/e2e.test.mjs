import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { git, makeWorkspace, read, runCli, write } from "./helpers.mjs";

test("init, compile, check, propose, and review run as a CLI", async () => {
  const workspace = await makeWorkspace();
  try {
    await write(
      path.join(workspace.cwd, "package.json"),
      JSON.stringify({
        name: "sample-service",
        private: true,
        scripts: { test: "node --test" },
        dependencies: { express: "4.0.0" },
      }),
    );
    await write(path.join(workspace.cwd, "src", "index.js"), "export function health() { return { ok: true }; }\n");

    const init = runCli(["init", "--yes"], workspace);
    assert.equal(init.status, 0, init.stderr);
    assert.match(await read(path.join(workspace.briefHome, "methodology.md")), /How I build/);
    assert.match(await read(path.join(workspace.cwd, ".brief", "project.md")), /framework: express/);
    assert.match(await read(path.join(workspace.cwd, ".brief", "project.md")), /src/);

    const compile = runCli(["compile"], workspace);
    assert.equal(compile.status, 0, compile.stderr + compile.stdout);
    assert.doesNotMatch(await read(path.join(workspace.cwd, "AGENTS.md")), /How I build/);
    assert.match(await read(path.join(workspace.cwd, "CLAUDE.md")), /express|Project/);
    assert.match(await read(path.join(workspace.userHome, ".claude", "CLAUDE.md")), /How I build/);

    const check = runCli(["check"], workspace);
    assert.equal(check.status, 0, check.stdout + check.stderr);

    const proposed = runCli(
      ["propose", "--title", "Prefer early returns", "--body", "When a branch is a guard, return early.", "--layer", "personal", "--file", "preferences.md", "--source", "agent"],
      workspace,
    );
    assert.equal(proposed.status, 0, proposed.stderr);
    const id = /pending\s+(\S+)/.exec(proposed.stdout)?.[1];
    assert.ok(id);
    assert.doesNotMatch(await read(path.join(workspace.briefHome, "preferences.md")), /return early/);

    const review = runCli(["review", "--accept", id], workspace);
    assert.equal(review.status, 0, review.stderr);
    assert.match(await read(path.join(workspace.briefHome, "preferences.md")), /return early/);

    const stale = runCli(["check"], workspace);
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /stale/);

    const again = runCli(["compile"], workspace);
    assert.equal(again.status, 0, again.stderr);
    assert.doesNotMatch(await read(path.join(workspace.cwd, "AGENTS.md")), /return early/);
    assert.match(await read(path.join(workspace.userHome, ".claude", "CLAUDE.md")), /return early/);
    const clean = runCli(["check"], workspace);
    assert.equal(clean.status, 0, clean.stdout);

    const version = runCli(["--version"], workspace);
    assert.equal(version.status, 0);
    assert.match(version.stdout, /\d+\.\d+\.\d+/);
  } finally {
    await workspace.cleanup();
  }
});

test("sync pushes the personal layer and pulls it on another machine", async () => {
  const workspace = await makeWorkspace();
  try {
    const bare = path.join(workspace.root, "remote.git");
    execFileSync("git", ["init", "--bare", "-b", "main", bare], { encoding: "utf8" });
    const init = runCli(["init", "--yes", "--global"], workspace);
    assert.equal(init.status, 0, init.stderr);
    const remote = pathToFileURL(bare).href;
    const first = runCli(["sync", "--remote", remote], workspace);
    assert.equal(first.status, 0, first.stderr + first.stdout);
    assert.match(first.stdout, /Pushed/);

    const otherHome = path.join(workspace.root, "other-brief");
    git(workspace.root, ["clone", remote, otherHome]);
    await write(path.join(otherHome, "goals.md"), `${await read(path.join(otherHome, "goals.md"))}\nA goal from the other machine.\n`);
    const other = {
      cwd: workspace.cwd,
      userHome: workspace.userHome,
      briefHome: otherHome,
    };
    const pushed = runCli(["sync"], other);
    assert.equal(pushed.status, 0, pushed.stderr + pushed.stdout);

    const pulled = runCli(["sync"], workspace);
    assert.equal(pulled.status, 0, pulled.stderr + pulled.stdout);
    assert.match(await read(path.join(workspace.briefHome, "goals.md")), /other machine/);
  } finally {
    await workspace.cleanup();
  }
});
