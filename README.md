# AgentBrief

**Write your project instructions once. Generate the files your AI coding tools read.**

If your team uses Claude Code and Codex on the same project, you may already maintain the same rules in `CLAUDE.md` and `AGENTS.md`. With AgentBrief, you edit one Markdown file and regenerate both. It runs locally and requires no API key.

## Quick start

Install AgentBrief with Node.js 20 or newer:

```bash
npm install -g @coddrex/agentbrief
```

From your project directory, create a starter brief:

```bash
agentbrief init --project --yes
```

Open `.brief/project.md` and add a rule your team follows. For example:

```markdown
Run `npm test` before submitting a change.
```

Preview the files AgentBrief will update:

```bash
agentbrief compile --project --dry-run
```

When you're ready, generate them:

```bash
agentbrief compile --project
```

Open `CLAUDE.md` and `AGENTS.md` in your project. Both now contain your test instruction. When the command changes, update the rule in `.brief/project.md` and compile again. Commit the project brief and the generated files so your teammates pick up the same rule.

### Already have an instructions file?

If your project already has a handwritten `CLAUDE.md` or `AGENTS.md`, the first compile backs it up in `.brief/backups/` and keeps your text below the generated section. You can keep editing that text. To update the generated section, edit the source brief and compile again.

### Want personal preferences across projects?

Run `agentbrief init --global`, edit the Markdown files in `~/.brief/`, then run `agentbrief compile --global`. The default `layered` setting puts personal instructions in your tools' global files. Projects configured with `composition = "full"` also include them in repository files.

[Supported tools](#target-matrix) · [Command reference](#commands) · [Example project](#example) · [Benchmarks](#does-it-help)

## Layer model

Three layers, top to bottom. Later layers are more specific. They are concatenated, not used as a fallback that hides the earlier ones.

| Layer | Where | What it holds |
| --- | --- | --- |
| Personal | `~/.brief/` | Who you are, how you build, preferences, goals. A git repo. |
| Stack | `~/.brief/stacks/<id>.md` | TypeScript, Python, Go, Rust, or a stack you add. |
| Project | `<repo>/.brief/` | What this repository is, its commands, its boundaries. |

`BRIEF_HOME` overrides `~/.brief` when you want a brief somewhere else.

Every source file is markdown with a small front matter block:

```markdown
---
title: How I build
order: 20
---
```

Project files can also declare facts `agentbrief check` compares to the repo:

```markdown
---
title: Project
package_manager: npm
commands:
  - npm run test
paths:
  - src
---
```

`order` sorts files inside a layer. Anything you drop in as another `.md` is included. `README.md` is not; it is for you.

### Full and short

Put the part every session needs above a marker, and the rest below it.

```markdown
Lead with the result.

<!-- brief:detail -->

The longer explanation. `agentbrief compile --variant short` drops this.
```

`variant` in `brief.toml` is `full` or `short`. `--variant` overrides it for one run. There is one variant at a time, so a tool is not given both.

### What gets included

`composition` in `brief.toml`:

- `full` writes personal + selected stacks + project into the repository files. A tool that only reads the repo still sees how you work.
- `layered` (the default) writes personal content only into the global tool files (`~/.claude/CLAUDE.md` and the others). Repository files get the stacks and the project. Use this when the personal layer should not be committed.

Global tool files never include the project layer. Project files are selected like this:

- `stacks = ["typescript"]` in `.brief/brief.toml` uses those stack files.
- If `stacks` is omitted, brief uses stacks it can detect (`tsconfig.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`) plus any stack file marked `global: true`.
- `stacks = []` includes none.

## Commands

| Command | What it does |
| --- | --- |
| `agentbrief init` | Create the personal layer, the project layer, or both, auto-detecting framework, test runner, commands, directories, monorepo, Docker, and CI. `--yes` skips questions. `--global` and `--project` limit which layer is created. |
| `agentbrief compile` | Write the native files (including path-scoped rules). `agentbrief build` is the same command. `--dry-run` prints the plan. `--force` replaces a generated region you edited by hand, after a backup. `--lean` writes only the files a tool would not otherwise load a second time. |
| `agentbrief check` | Exit 1 when a generated file is missing, stale, or hand-edited, or when a declared command, path, package manager, or framework does not match the repo. Budget and overlap problems are warnings unless you pass `--strict`. |
| `agentbrief capture` | Inspect compiled files for edits made by hand or by tool memory (e.g. Claude auto-memory, Gemini `/memory add`) and turn added lines into pending inbox proposals. Pass `--include-outside` to also capture text outside markers. |
| `agentbrief hook` | `agentbrief hook install [--mode check|compile]` installs an idempotent git `pre-commit` hook; `agentbrief hook uninstall` removes it; `agentbrief hook ci` writes `.github/workflows/agentbrief.yml`. |
| `agentbrief mcp` | Start a zero-dependency stdio MCP server exposing `get_brief`, `get_rules_for_path`, `propose_rule`, `list_proposals`, and `check_brief` to MCP-compatible coding agents. |
| `agentbrief propose` | Append a suggestion to the inbox. Does not edit the source. |
| `agentbrief review` | Accept or reject pending suggestions. `--accept <id>`, `--accept all`, `--reject <id>`. In a terminal with no flags, it asks one at a time. |
| `agentbrief sync` | Commit the personal layer and, if it has a remote, pull with rebase and push. `--remote <url>` sets `origin`. |
| `agentbrief watch` | Recompile when a source file changes. |
| `agentbrief eval` | Write a with-brief / without-brief prompt pair. Does not call a model. See [evals/README.md](evals/README.md). |

### Path-scoped rules (`applies_to`)

Add `applies_to` (or `globs`) to any `.brief/*.md` file so those rules are loaded only when working on matching paths instead of bloating every session:

```markdown
---
title: API Rules
applies_to:
  - src/api/**
---

Always validate request payloads with zod.
```

`agentbrief compile` omits scoped files from the main `AGENTS.md` and compiles them into native path-filtered rules for Cursor (`.cursor/rules/brief-<slug>.mdc`), Claude Code (`.claude/rules/brief-<slug>.md`), and Copilot (`.github/instructions/brief-<slug>.instructions.md`). MCP clients can query them dynamically via `get_rules_for_path`.

The manifest records the entire generated scoped file, including its path filters. Recompiling updates an untouched file when its glob changes and removes an untouched rule when its source disappears. Locally edited files and obsolete files from older manifests are retained for review. Run `agentbrief compile --dry-run` to preview removal. Conflicting source names that resolve to the same output stop compilation.

Repeated rendered sections appear once per brief. The native profile still generates separate files for tools that need them. Managed text reads and writes reject symbolic links and Windows junctions in their path. Use physical paths for the project, brief, and tool directories.

### MCP server (`agentbrief mcp`)

Point any MCP-compatible tool (Claude Code, Cursor, Windsurf, Gemini CLI) at `agentbrief mcp`:

```json
{
  "mcpServers": {
    "agentbrief": {
      "command": "agentbrief",
      "args": ["mcp"]
    }
  }
}
```

Generated files carry a marker:

```html
<!-- brief:generated target=agents variant=full composition=full hash=… -->
…brief…
<!-- brief:end -->
```

Text outside the marker is yours. agentbrief will not delete it. The first time agentbrief sees a file it did not generate, it copies the original into `.brief/backups/` (or `~/.brief/backups/` for a global file) and leaves that text below the generated block. If you edit inside the marker, `agentbrief compile` refuses to overwrite it until you pass `--force`, which writes a backup first.

Commit the project files agentbrief writes. The tools read those files, not `.brief/`. The personal layer stays in `~/.brief` and moves between machines with `agentbrief sync`.

## Target matrix

Checked against the docs linked here on 22 November 2026. `agentbrief compile` writes the file in the Project column into the repository, and the file in the Global column into your home directory.

| Tool | Project file | Global file | Docs |
| --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` (or `.claude/CLAUDE.md` if that already exists and `CLAUDE.md` does not) | `~/.claude/CLAUDE.md` | [Memory](https://code.claude.com/docs/en/memory) |
| Generic agents, and the project file Codex reads | `AGENTS.md` | — | [agents.md](https://agents.md) |
| OpenAI Codex | the same `AGENTS.md` | `~/.codex/AGENTS.md` | [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md) |
| Gemini CLI | `GEMINI.md` | `~/.gemini/GEMINI.md` | [GEMINI.md](https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html) |
| Cursor | `.cursor/rules/brief.mdc` (`alwaysApply: true`) | `~/.cursor/rules/brief.mdc` | [Rules](https://cursor.com/docs/rules) |
| GitHub Copilot | `.github/copilot-instructions.md` | `~/.copilot/copilot-instructions.md` | [Copilot CLI instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions) |
| Windsurf | `.windsurf/rules/brief.md` (`trigger: always_on`) | `~/.codeium/windsurf/memories/global_rules.md` | [Memories, localized docs](https://docs.windsurf.com/fr/windsurf/cascade/memories) |
| Grok Build | `.grok/rules/brief.md` | `~/.grok/AGENTS.md` | [Project rules](https://docs.x.ai/build/features/project-rules) |

`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `COPILOT_HOME`, and `GROK_HOME` are honored when they are set. Those are the overrides the tools document.

Cursor rules need the `.mdc` extension and front matter or Cursor ignores them. Windsurf workspace rules take `trigger` front matter. The Windsurf global file and `AGENTS.md` do not; they are always on. Grok reads every `*.md` file in `.grok/rules/`.

### What one session actually loads

Several tools read more than one of these files. `agentbrief check` prints the sum. With the default budget of 4000 tokens, the starter brief fits in each file and trips the warning only for Copilot CLI, which loads five of them.

| Tool | Loads, from the docs above |
| --- | --- |
| Claude Code | `~/.claude/CLAUDE.md` and `./CLAUDE.md`. With the default setting it does not also read `AGENTS.md` when a `CLAUDE.md` is present. |
| Gemini CLI | `~/.gemini/GEMINI.md` and `./GEMINI.md`, concatenated. |
| Codex | `~/.codex/AGENTS.md`, then `AGENTS.md` from the repo root down to the working directory. Combined project docs stop at `project_doc_max_bytes` (32 KiB by default). |
| Cursor | `~/.cursor/rules`, `.cursor/rules/*.mdc`, `AGENTS.md`, and `CLAUDE.md`. |
| Copilot CLI | `~/.copilot/copilot-instructions.md`, `.github/copilot-instructions.md`, `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`. |
| Windsurf | `~/.codeium/windsurf/memories/global_rules.md`, `.windsurf/rules/*.md`, and root `AGENTS.md`. |
| Grok Build | `~/.grok/`, then `AGENTS.md`, `CLAUDE.md`, and `.grok/rules/*.md`. |

`agentbrief init --lean`, or `profile = "lean"`, turns off the Cursor, Windsurf, and Grok copies, because those tools also read `AGENTS.md` or `CLAUDE.md`. Claude, Gemini, Copilot, and Codex stay on: each of them has a file the others do not reliably read. `--native` turns every target back on for one run.

Turn a single target off in `brief.toml`:

```toml
[targets]
cursor = false
```

## Token budget

The estimate is `characters / chars_per_token` (default 4). It is not a model tokenizer. `[budget] full` and `[budget] short` are the warning lines, 4000 and 1500 by default. A target can override them:

```toml
[budget.claude]
full = 6000
```

`agentbrief compile` still writes a file that is over budget. `agentbrief check` reports it as a warning, and as an error if you pass `--strict`.

Two hard caps from the docs are checked the same way:

- Windsurf workspace rules, 12,000 characters. The global Windsurf file, 6,000 characters.
- Codex project docs, 32 KiB by default.

## Drift

`agentbrief check` compares each generated region with the source layers and with the hash stored in the marker.

- The region matches the source: ok.
- The hash in the marker matches the body, and the body does not match the source: the file is stale. Compile again.
- The body does not match the hash in the marker: the region was edited by hand.

It also checks the project layer, not the personal one, against the repository:

- `npm run`, `pnpm run`, `yarn run`, and `bun run` names against `package.json` scripts.
- `make <target>` against a Makefile, when one exists.
- `paths:` entries, and backtick paths in the project markdown, against the tree.
- `package_manager` against the lockfile or the `packageManager` field.
- `framework` against dependencies in `package.json` or `pyproject.toml` (`next`, `react`, `vue`, `svelte`, `angular`, `express`, `fastify`, `vite`, `django`, `fastapi`, `flask`).

A personal note that mentions `src/app.ts` is not checked. That path belongs to one repo, and the personal layer is used in all of them.

## Propose and review

An agent, or you, records a suggestion. The source files stay as they are.

```bash
agentbrief propose \
  --layer personal \
  --file preferences.md \
  --title "Prefer early returns" \
  --body "When a branch is a guard, return early." \
  --source agent
```

`--layer` is `personal`, `stack`, or `project`. `--action` is `append` (the default) or `prepend`. `--body-file` reads the suggestion from a file, and a pipe is used when stdin is not a terminal.

```bash
agentbrief review --accept 20261122T120000Z-prefer-early-returns
agentbrief review --reject 20261122T120000Z-prefer-early-returns --reason "Not a real preference"
agentbrief compile
```

Accepting writes a `## Learned:` section into the source file and moves the proposal to `inbox/accepted/`. Rejecting moves it to `inbox/rejected/` and does not touch the source. Personal and stack proposals live in `~/.brief/inbox/`. Project proposals live in `.brief/inbox/`, which `agentbrief init` adds to `.gitignore`.

Tell an agent to run `agentbrief propose` instead of editing `AGENTS.md`. The generated file says the same thing.

## Sync

`~/.brief` is a git repository from the moment `agentbrief init` creates it. `agentbrief sync` commits local edits. With a remote it fetches, rebases, and pushes. It does not force-push. If the rebase conflicts, agentbrief aborts the rebase, leaves your commit in place, and stops.

```bash
agentbrief sync --remote git@github.com:you/agentbrief-personal.git
agentbrief sync
```

The remote is your personal methodology. Do not put secrets in it. Project instructions stay in the project's own git history; `agentbrief sync` does not push those.

On a new machine, clone that repo to `~/.brief`, or set `BRIEF_HOME`, then run `agentbrief compile` so the global tool files exist.

## Example

[examples/home](examples/home) is a personal layer for someone named Ada. [examples/sample-app](examples/sample-app) is a one-function module whose `.brief/project.md` names `npm` and `npm run test`. The `package-lock.json` there is only a marker so brief can see npm. It is not a full install. `npm test` in that directory runs without installing anything.

The source starts like this:

```markdown
# Who I am

I am Ada. I build software by shipping a thin working slice and then tightening it.
```

`agentbrief compile` turns the layers into `examples/sample-app/AGENTS.md` (and the other native files). The top of that file:

```markdown
<!-- brief:generated target=agents variant=full composition=full hash=… -->
# Builder brief

Generated by brief. Do not edit this block by hand.

Variant: full. Composition: full. Scope: project.
Layers: personal (identity, methodology, preferences, goals), project (project).
```

To recompile the sample against that personal layer, instead of whatever is in your real `~/.brief`:

```bash
export BRIEF_HOME="$PWD/examples/home"
cd examples/sample-app
agentbrief check --project
```

## Does it help?

To inspect what a brief adds to a prompt, run this from the AgentBrief source checkout:

```bash
agentbrief eval --task evals/tasks/add-health-check.md
```

For a paired comparison, the benchmark runs the same task in two fresh workspaces, one with AgentBrief and one without. Its mock runner exercises the harness with scripted edits. Measuring model performance requires a live run. See the [benchmark guide](https://github.com/YoussTech-Gn/agentbrief/blob/main/evals/benchmark_README.md) for commands and metrics.

## Development

To build and test from source:

```bash
git clone https://github.com/YoussTech-Gn/agentbrief.git
cd agentbrief
npm ci
npm test
```

That builds `dist/` and runs the tests for compile output, merge safety, drift checks, the proposal inbox, sync against a local bare repo, and the sample app. The tests do not write into your real home directory.

## Limits

These are the locations this version does not write, or writes with a caveat, because the docs and the files do not line up cleanly.

- Cursor account User Rules, the ones in Customize, are stored on the Cursor account. There is no file. The help center documents user rule files in `~/.cursor/rules` and says they stay on that machine. It does not name the extension. Project rules must be `.mdc` or Cursor ignores them, and brief uses `.mdc` for the global file too.
- The English Windsurf page names `global_rules.md` and a 12,000 character workspace cap, and does not print the home directory. The localized Windsurf docs do: `~/.codeium/windsurf/memories/global_rules.md`, with a 6,000 character cap. That is the global path brief writes. A 12,000 character cap is checked on `.windsurf/rules/brief.md`. Some third-party guides also mention `~/.windsurf/rules/`. That path is not in the official page brief used, so it is not written.
- Devin, which the current Windsurf docs describe as the desktop and CLI agent, prefers `.devin/rules/` and a global file at `~/.config/devin/AGENTS.md` or `~/.devin/global_rules.md`. It still imports `.windsurf/rules/`. brief writes the Windsurf files and not the Devin copies. Writing both would load the brief twice, and the Devin docs say both directories are read.
- Grok Build's product docs put global rules in `~/.grok/` and list `AGENTS.md` among the names read in a directory, plus every `*.md` in `.grok/rules/`. brief writes `~/.grok/AGENTS.md` and `.grok/rules/brief.md`. A user guide in the grok-build repository also mentions `~/.grok/rules/*.md`. That page returned no body when it was fetched, so brief does not write a second global file there.
- Grok's compatibility scan of `.cursor/rules/` is described as `*.md`. The Cursor file brief writes is `.mdc`, so Grok may not load it. Grok does load `AGENTS.md` and `CLAUDE.md`.
- Copilot instructions that live in GitHub account settings are not a file. `~/.copilot/copilot-instructions.md` is the Copilot CLI path. Which of `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` an editor surface loads varies; the repo-wide file they share is `.github/copilot-instructions.md`.
- Claude Code, Gemini, and Codex can be pointed at extra filenames in their own settings. brief uses each tool's default.
- Files an organization manages (`/etc/claude-code/CLAUDE.md`, Copilot organization instructions, `/etc/windsurf/rules/`) are not touched.
- Gemini's `/memory add` and Claude's auto memory rewrite their own stores. If they rewrite a file agentbrief generated, `agentbrief check` reports drift and `agentbrief capture` can turn those additions into inbox proposals.
- `agentbrief sync` is `git pull --rebase` and `git push`. A conflict stops the command. There is no force-push and no three-way merge of two people's methodology beyond what git already does.

## License

MIT.
