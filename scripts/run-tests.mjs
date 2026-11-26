// Cross-platform test entry point.
// `node --test test/*.test.mjs` relies on the shell to expand the glob: bash does,
// but Windows cmd and PowerShell pass it through literally, and Node 20 does not
// expand globs itself. Listing the files here works on every shell and Node >=20.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const dir = "test";
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => path.join(dir, name));

if (files.length === 0) {
  console.error(`No *.test.mjs files found in ${dir}/`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
