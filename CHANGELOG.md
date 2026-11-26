# Changelog

## 0.4.0

The README quick start now works on a TypeScript repository, and `check` stops blocking commits over text that is not a real problem.

### Fixed

- `init --project --yes` followed by `compile` and `check` exited 1 on any repo with a `tsconfig.json`. A stack the repo looks like but that has no file in `~/.brief/stacks/` is now skipped with a note. A stack you name in `stacks` with no file is still an error.
- `check` reported backtick text such as `feat/login` or `application/json` as a missing path. Paths found in prose are now warnings; paths in `paths:` front matter stay errors. `@scope/pkg` is not treated as a path.
- Any symbolic link in a path stopped the tool, including a dotfiles-managed `~/.claude`. Links are now refused only inside the project. Outside it they are followed, and a linked file is written through so the link stays.
- A framework agentbrief cannot detect (NestJS, Hono, Astro…) was an error. It is now a warning that it could not be checked.
- Front matter `applies_to: ["src/api/**"]` produced a rule with a broken glob. Inline `[a, b]` lists now work, and `#` inside quotes is kept.
- `brief.toml` read a multi-line array as empty and ignored `chars_per_token = 3.5`. Both now work, and escapes are decoded in one pass.
- `capture --include-outside` captured the same text again after it was accepted.
- MCP `propose_rule` on the stack layer without `file` targeted `stacks/preferences.md`. It now asks for the file.
- Two proposals with the same title in the same second shared an id and the second overwrote the first.

### Changed

- Front matter and `brief.toml` that agentbrief cannot read now stop compilation with the file and line, instead of being read wrongly. This covers nested maps, `|` blocks, unquoted TOML strings, and unknown lines.
- `--native` no longer turns on a target that `brief.toml` sets to `false`. `init --lean` now leaves Cursor, Windsurf, and Grok unset instead of writing `false`. If you created a lean config with an earlier version and want `--native` to work, delete those three lines.
- The pre-commit hook fails the commit when the command fails, even if your own hook lines follow it. It follows `core.hooksPath` (husky) and works in git worktrees.
- `hook install --mode compile` runs the new `compile --project --stage`, which `git add`s the files it regenerated and the manifest.
- `hook ci` pins the workflow to the installed version.

## 0.3.1 and earlier

See the git history.
