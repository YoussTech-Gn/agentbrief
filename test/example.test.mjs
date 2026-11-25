import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "./helpers.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the committed sample checks clean against its source layers", () => {
  const result = runCli(["check", "--project"], {
    cwd: path.join(repoRoot, "examples", "sample-app"),
    userHome: path.join(repoRoot, "examples", "user"),
    briefHome: path.join(repoRoot, "examples", "home"),
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /0 error\(s\)/);
});
