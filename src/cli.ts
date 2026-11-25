#!/usr/bin/env node
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { checkBrief } from "./check.js";
import { compileBrief } from "./compile.js";
import { evalBrief } from "./eval.js";
import { initBrief } from "./init.js";
import { checkFailed, formatCheck, formatCompile } from "./print.js";
import { acceptProposal, listPending, proposeChange, rejectProposal } from "./proposals.js";
import { syncBrief } from "./sync.js";
import type { LayerName, Profile, Scope, Variant } from "./types.js";
import { readText } from "./util.js";
import { watchBrief } from "./watch.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const HELP = `agentbrief — one builder brief, compiled into every AI coding tool

Install globally with \`npm install -g github:MYoussouf/agentbrief\` (or \`npm install -g .\` from source).

Usage
  agentbrief init [--global] [--project] [--yes] [--lean]
  agentbrief compile [--global] [--project] [--variant short|full] [--lean|--native] [--force] [--dry-run]
  agentbrief check [--global] [--project] [--strict] [--variant short|full]
  agentbrief sync [--remote <git-url>]
  agentbrief propose --title <text> (--body <text> | --body-file <path>) [--layer personal|stack|project] [--file <path>] [--action append|prepend]
  agentbrief review [--accept <id|all>] [--reject <id>] [--reason <text>]
  agentbrief watch
  agentbrief eval [--task <file>]

The personal layer lives in ~/.brief (override with BRIEF_HOME). The project layer lives in .brief/.
Generated files are marked with brief:generated. Hand-written text outside those markers is kept.
`;

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: true,
    options: {
      help: { type: "boolean", short: "h", default: false },
      version: { type: "boolean", short: "v", default: false },
      yes: { type: "boolean", short: "y", default: false },
      global: { type: "boolean", short: "g", default: false },
      project: { type: "boolean", short: "p", default: false },
      force: { type: "boolean", short: "f", default: false },
      "dry-run": { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      lean: { type: "boolean", default: false },
      native: { type: "boolean", default: false },
      variant: { type: "string" },
      title: { type: "string" },
      body: { type: "string" },
      "body-file": { type: "string" },
      layer: { type: "string" },
      file: { type: "string" },
      action: { type: "string" },
      source: { type: "string" },
      accept: { type: "string" },
      reject: { type: "string" },
      reason: { type: "string" },
      remote: { type: "string" },
      task: { type: "string" },
    },
  });

  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }
  const command = positionals[0] ?? "help";
  if (values.help || command === "help" || command === "--help") {
    process.stdout.write(HELP);
    return;
  }

  const cwd = process.cwd();
  const home = process.env["BRIEF_HOME"] || path.join(os.homedir(), ".brief");
  const userHome = os.homedir();
  const variant = parseVariant(values.variant);
  const profile: Profile | undefined = values.lean ? "lean" : values.native ? "native" : undefined;
  const base = {
    cwd,
    briefHome: home,
    userHome,
    variant,
    scopes: scopesFrom(values.global, values.project),
    force: values.force,
    dryRun: values["dry-run"],
    profile,
    env: process.env,
  };

  switch (command) {
    case "init": {
      const result = await initBrief({
        cwd,
        briefHome: home,
        global: values.global,
        project: values.project,
        yes: values.yes || !input.isTTY,
        profile,
        prompt: values.yes || !input.isTTY ? undefined : ask,
      });
      for (const file of result.created) console.log(`created  ${file}`);
      for (const file of result.kept) console.log(`kept     ${file}`);
      for (const message of result.messages) console.log(message);
      return;
    }
    case "compile":
    case "build": {
      const report = await compileBrief(base);
      console.log(formatCompile(report));
      if (report.files.some((file) => file.status === "skipped")) process.exitCode = 1;
      return;
    }
    case "check": {
      const report = await checkBrief({ ...base, strict: values.strict });
      console.log(formatCheck(report));
      if (checkFailed(report, values.strict)) process.exitCode = 1;
      return;
    }
    case "sync": {
      const result = syncBrief(home, values.remote);
      for (const message of result.messages) console.log(message);
      return;
    }
    case "propose": {
      const layer = await resolveLayer(values.layer, cwd);
      const file = values.file || defaultFile(layer);
      const body = await resolveBody(values.body, values["body-file"]);
      const action = values.action === "prepend" ? "prepend" : "append";
      const proposal = await proposeChange({
        cwd,
        briefHome: home,
        title: values.title ?? "",
        body,
        layer,
        file,
        action,
        source: values.source || "cli",
      });
      console.log(`pending  ${proposal.id}`);
      console.log(`layer    ${proposal.layer}`);
      console.log(`file     ${proposal.file}`);
      console.log("Nothing was changed in the source. Run `brief review` to accept or reject it.");
      return;
    }
    case "review": {
      if (values.accept && values.reject) throw new Error("Pass either --accept or --reject.");
      if (values.accept) {
        const ids = values.accept === "all" ? (await listPending(cwd, home)).map((item) => item.id) : [values.accept];
        if (ids.length === 0) {
          console.log("No pending proposals.");
          return;
        }
        for (const id of ids) {
          const done = await acceptProposal(cwd, home, id);
          console.log(`accepted ${done.id} -> ${done.layer}:${done.file}`);
        }
        console.log("Source updated. Run `brief compile` when you want tools to see it.");
        return;
      }
      if (values.reject) {
        const done = await rejectProposal(cwd, home, values.reject, values.reason);
        console.log(`rejected ${done.id}`);
        return;
      }
      if (!input.isTTY) {
        const pending = await listPending(cwd, home);
        if (pending.length === 0) console.log("No pending proposals.");
        for (const item of pending) console.log(`${item.id}\t${item.layer}\t${item.file}\t${item.title}`);
        if (pending.length > 0) console.log("Re-run with --accept <id> or --reject <id>.");
        return;
      }
      await reviewInteractive(cwd, home);
      return;
    }
    case "watch": {
      const report = await compileBrief(base);
      console.log(formatCompile(report));
      console.log("Watching source layers. Ctrl-C stops.");
      const close = watchBrief(base, (line) => console.log(line));
      await new Promise<void>((resolve) => {
        process.once("SIGINT", () => {
          close();
          resolve();
        });
      });
      return;
    }
    case "eval": {
      const result = await evalBrief({ ...base, task: values.task });
      console.log(`stub     wrote ${result.outFile}`);
      console.log(`tokens   without ${result.withoutBriefTokens}, with brief ${result.withBriefTokens}`);
      console.log("No model was called. See evals/README.md.");
      return;
    }
    default:
      throw new Error(`Unknown command "${command}".\n\n${HELP}`);
  }
}

function parseVariant(value: string | undefined): Variant | undefined {
  if (value === undefined) return undefined;
  if (value === "short" || value === "full") return value;
  throw new Error('--variant must be "short" or "full".');
}

function scopesFrom(global: boolean, project: boolean): Scope[] | undefined {
  if (global && project) return ["global", "project"];
  if (global) return ["global"];
  if (project) return ["project"];
  return undefined;
}

async function resolveLayer(value: string | undefined, cwd: string): Promise<LayerName> {
  if (value === "personal" || value === "stack" || value === "project") return value;
  if (value) throw new Error('--layer must be "personal", "stack", or "project".');
  const project = await readText(path.join(cwd, ".brief", "brief.toml"));
  return project === null ? "personal" : "project";
}

function defaultFile(layer: LayerName): string {
  if (layer === "project") return "project.md";
  if (layer === "stack") throw new Error("A stack proposal needs --file <stack-id>.");
  return "preferences.md";
}

async function resolveBody(body: string | undefined, bodyFile: string | undefined): Promise<string> {
  if (bodyFile) {
    const text = await readText(bodyFile);
    if (text === null) throw new Error(`Could not read ${bodyFile}.`);
    return text;
  }
  if (body) return body;
  if (input.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  return Buffer.concat(chunks).toString("utf8");
}

async function ask(question: string, fallback: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`${question} [${fallback}]: `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

async function reviewInteractive(cwd: string, briefHome: string): Promise<void> {
  const pending = await listPending(cwd, briefHome);
  if (pending.length === 0) {
    console.log("No pending proposals.");
    return;
  }
  const rl = readline.createInterface({ input, output });
  try {
    for (const proposal of pending) {
      console.log(`\n${proposal.id}  ${proposal.layer} -> ${proposal.file} (${proposal.action})`);
      console.log(proposal.title);
      console.log(proposal.body);
      const answer = (await rl.question("[a]ccept  [r]eject  [s]kip  [q]uit: ")).trim().toLowerCase();
      if (answer === "q" || answer === "quit") return;
      if (answer === "a" || answer === "accept") {
        await acceptProposal(cwd, briefHome, proposal.id);
        console.log("accepted");
      } else if (answer === "r" || answer === "reject") {
        const reason = await rl.question("Reason (optional): ");
        await rejectProposal(cwd, briefHome, proposal.id, reason);
        console.log("rejected");
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "brief failed";
  console.error(message);
  process.exitCode = 1;
});
