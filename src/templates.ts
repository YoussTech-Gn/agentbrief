/** Starter layers. Written once by `agentbrief init` and never overwritten. */

export interface TemplateContext {
  name: string;
  focus: string;
  stacks: string[];
  packageManager?: string;
  framework?: string;
  commands: string[];
  paths: string[];
  profile: "native" | "lean";
  projectName?: string;
  projectDescription?: string;
  testRunners?: string[];
  monorepo?: boolean;
  hasDocker?: boolean;
  hasCi?: boolean;
}

export function globalReadme(): string {
  return `# Builder brief

This folder is the personal layer of a brief install. It is yours: methodology, goals, preferences, and stacks. Projects keep their own context in \`.brief/\` and compile both layers into the instruction files each coding tool already reads.

Edit the markdown. Then run \`agentbrief compile\`.

This directory is a git repo so \`agentbrief sync\` can move it between machines. Do not put secrets in it.
`;
}

export function globalGitignore(): string {
  return `backups/\n`;
}

export function globalConfig(ctx: TemplateContext): string {
  const targets = targetTable(ctx.profile);
  const stacks =
    ctx.stacks.length > 0 ? `stacks = [${ctx.stacks.map((id) => `"${id}"`).join(", ")}]\n` : "";
  return `# Personal brief. Human-editable. Copied into every tool by \`agentbrief compile\`.
version = 1
variant = "full"
composition = "layered"
profile = "${ctx.profile}"
${stacks}
[budget]
full = 4000
short = 1500
chars_per_token = 4

${targets}
[sync]
remote = ""
`;
}

export function projectConfig(ctx: TemplateContext): string {
  const lines = [
    "# Project layer. Overrides ~/.brief/brief.toml for this repo.",
    "version = 1",
    `variant = "full"`,
    `composition = "layered"`,
    `profile = "${ctx.profile}"`,
  ];
  if (ctx.stacks.length) {
    lines.push(`stacks = [${ctx.stacks.map((id) => JSON.stringify(id)).join(", ")}]`);
  }
  if (ctx.packageManager) lines.push(`package_manager = ${JSON.stringify(ctx.packageManager)}`);
  if (ctx.framework) lines.push(`framework = ${JSON.stringify(ctx.framework)}`);
  lines.push("", targetTable(ctx.profile).trimEnd(), "");
  return `${lines.join("\n")}\n`;
}

export function identityTemplate(ctx: TemplateContext): string {
  return `---
title: Who I am
order: 10
---

# Who I am

I am ${ctx.name}. ${ctx.focus}

Done means a slice a person can run, with the check that proves it, and a note about what I did not verify.

<!-- brief:detail -->

## What I want from an agent

- Restate the job in a sentence before changing code, when the job is easy to misunderstand.
- Prefer the smallest change that solves the actual problem.
- Leave the repository clearer than you found it, without rewriting the parts you did not need to touch.
`;
}

export function methodologyTemplate(): string {
  return `---
title: How I build
order: 20
---

# How I build

1. Read the code that already owns the behavior before adding a new pattern.
2. Name the slice: the smallest end-to-end change a person can run.
3. Implement that slice in the project's existing style.
4. Verify it with the project's own checks. Do not claim it works without saying what ran.
5. When the same correction shows up twice, propose it into this brief instead of repeating it in chat.

<!-- brief:detail -->

## While you are in the code

- Match the local pattern. A second way to do the same thing is a bug.
- Do not refactor neighbors because you are already in the file.
- Handle errors where you have enough context to say what the caller should do.
- Delete a branch of code only when you can say what used to depend on it.
- If a file is generated, edit its source and recompile. The marker \`brief:generated\` means the file is generated.

## When you stop

- Say what changed, why, and which checks ran.
- Say what you did not verify.
- If you learned a durable preference, run \`agentbrief propose\` instead of silently editing a compiled file.
`;
}

export function preferencesTemplate(): string {
  return `---
title: Preferences
order: 30
---

# Preferences

- Names say what the thing is. Avoid abbreviations that only make sense today.
- Early returns over nested branches.
- Comments explain why, and only when the code cannot.
- Tests cover behavior a caller can observe.
- A new dependency has to remove more complexity than it adds.
- Commit messages say why. Keep a commit to one change.
- Do not expand the task. Do not revert changes you did not make.

<!-- brief:detail -->

## Working with me

- Lead with the result, then the evidence.
- When something is ambiguous and expensive to undo, ask. Otherwise pick the conservative option and say what you picked.
- Do not invent files, commands, or metrics.
- Plain sentences. No status-theater prose.
`;
}

export function goalsTemplate(): string {
  return `---
title: Goals
order: 40
---

# Goals

Rewrite this file when the work changes. A stale goal is worse than a short one.

## Now

- Ship one complete slice of the current project and write down what I learned from it.

## Next

- Turn a repeated correction into a line in this brief, via \`agentbrief propose\`.

## Not now

- Rewriting a working system without a concrete failure.
- Adding a service, a framework, or a dependency the slice does not need.

<!-- brief:detail -->

## How to use this file

Keep "Now" to a handful of lines. Agents treat everything here as in-scope, so a wish list becomes a pile of unrequested work.
`;
}

export function projectTemplate(ctx: TemplateContext): string {
  const fm: string[] = ["---", "title: Project", "order: 10"];
  if (ctx.packageManager) fm.push(`package_manager: ${ctx.packageManager}`);
  if (ctx.framework) fm.push(`framework: ${ctx.framework}`);
  if (ctx.commands.length) {
    fm.push("commands:");
    for (const command of ctx.commands) fm.push(`  - ${command}`);
  }
  if (ctx.paths.length) {
    fm.push("paths:");
    for (const filePath of ctx.paths) fm.push(`  - ${filePath}`);
  }
  fm.push("---");

  const summaryParts: string[] = [];
  if (ctx.projectName && ctx.projectDescription) {
    summaryParts.push(`\`${ctx.projectName}\` — ${ctx.projectDescription}`);
  } else if (ctx.projectName) {
    summaryParts.push(`Repository: \`${ctx.projectName}\`.`);
  } else {
    summaryParts.push("Describe what this repo is, who it is for, and the slice currently in progress.");
  }

  const stackBits: string[] = [];
  if (ctx.framework) stackBits.push(`Framework: ${ctx.framework}`);
  if (ctx.packageManager) stackBits.push(`Package manager: ${ctx.packageManager}`);
  if (ctx.testRunners && ctx.testRunners.length > 0) stackBits.push(`Tests: ${ctx.testRunners.join(", ")}`);
  if (ctx.monorepo) stackBits.push("Layout: monorepo");
  if (ctx.hasDocker) stackBits.push("Containerized (Docker)");
  if (ctx.hasCi) stackBits.push("CI: GitHub Actions");

  const overview =
    stackBits.length > 0
      ? `${summaryParts.join(" ")}\n\n- ${stackBits.join("\n- ")}`
      : summaryParts.join(" ");

  const layoutSection =
    ctx.paths.length > 0
      ? `\n\n## Layout\n\nKey directories detected: ${ctx.paths.map((p) => `\`${p}\``).join(", ")}.`
      : "";

  return `${fm.join("\n")}

# Project

${overview}${layoutSection}

## Commands

Use the commands declared above. If a command is missing, fix the declaration instead of inventing a new script.

## Boundaries

- Stay inside this repository unless the task says otherwise.
- Follow the personal brief for how to work, and this file for what this repo is.
`;
}

export function stackTemplate(id: string): string {
  const writers: Record<string, () => string> = {
    typescript: typescriptStack,
    python: pythonStack,
    go: goStack,
    rust: rustStack,
  };
  return (writers[id] ?? customStack(id))();
}

function typescriptStack(): string {
  return `---
title: TypeScript
order: 10
global: true
---

# TypeScript

- Strict TypeScript. Do not add \`any\` unless the comment next to it says why.
- ESM. Keep the module style the repo already uses.
- Validate data at the boundary. Trust types inside the program.

<!-- brief:detail -->

- Exported functions get an explicit return type when the inference is not obvious.
- Prefer a narrowing check to a cast.
- Do not silence the compiler with a directive. Fix the type or narrow the value.
- If the project is plain JavaScript, do not invent a TypeScript migration as part of an unrelated task.
`;
}

function pythonStack(): string {
  return `---
title: Python
order: 10
global: true
---

# Python

- Type hints on public functions. Match the version the repo already runs.
- Raise specific exceptions. Do not swallow an error with a bare \`except\`.
- Keep I/O at the edges so the core logic can be tested without a network.

<!-- brief:detail -->

- Virtual environments and the lockfile are the source of truth for dependencies.
- Prefer the standard library until a dependency clearly pays for itself.
`;
}

function goStack(): string {
  return `---
title: Go
order: 10
global: true
---

# Go

- Return errors. Do not panic for a condition a caller can handle.
- Accept interfaces, return structs, when that is already the local pattern.
- \`gofmt\` is not optional. Do not hand-format around it.

<!-- brief:detail -->

- Context is the first parameter when a function does I/O or can be cancelled.
- Keep packages focused. Do not invent a framework inside a library.
`;
}

function rustStack(): string {
  return `---
title: Rust
order: 10
global: true
---

# Rust

- Use \`Result\` and \`Option\`. \`unwrap\` belongs in a test or a comment that says why it cannot fail.
- Keep \`unsafe\` in a tiny module with the invariant written above it.
- Match the edition and the clippy level the repo already uses.

<!-- brief:detail -->

- Prefer borrowing to cloning unless the clone makes the ownership obvious and cheap.
- Do not add a crate to avoid a few lines of standard library.
`;
}

function customStack(id: string): () => string {
  return () => `---
title: ${id}
order: 50
global: true
---

# ${id}

Write the rules an agent should follow in every ${id} project. Keep the short version above the detail marker.

<!-- brief:detail -->

Add the longer explanation here. \`agentbrief compile --variant short\` drops everything after the detail marker.
`;
}

function targetTable(profile: "native" | "lean"): string {
  const off = profile === "lean";
  const row = (name: string, enabled: boolean) => `${name} = ${enabled ? "true" : "false"}\n`;
  return (
    "[targets]\n" +
    row("claude", true) +
    row("agents", true) +
    row("gemini", true) +
    row("cursor", !off) +
    row("copilot", true) +
    row("windsurf", !off) +
    row("codex", true) +
    row("grok", !off)
  );
}
