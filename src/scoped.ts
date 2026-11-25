import path from "node:path";
import type { SourceDoc, TargetId } from "./types.js";
import { asStringList, slug } from "./util.js";

/** Return glob patterns declared via `applies_to` or `globs` in front matter. */
export function scopedGlobs(doc: SourceDoc): string[] {
  return [...asStringList(doc.data["applies_to"]), ...asStringList(doc.data["globs"])];
}

/** True when a document targets specific file paths instead of every session. */
export function isScopedDoc(doc: SourceDoc): boolean {
  return doc.layer === "project" && scopedGlobs(doc).length > 0;
}

/** Return all scoped project docs whose `applies_to`/`globs` match `relPath`. */
export function rulesForPath(docs: SourceDoc[], relPath: string): SourceDoc[] {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
  return docs.filter((doc) => {
    const globs = scopedGlobs(doc);
    if (globs.length === 0) return false;
    return globs.some((pattern) => matchGlob(normalized, pattern));
  });
}

/** Lightweight POSIX glob matcher supporting `**`, `*`, and `?`. */
export function matchGlob(filePath: string, pattern: string): boolean {
  const target = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const pat = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  let re = "^";
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === "*") {
      if (pat[i + 1] === "*") {
        if (pat[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += ch?.replace(/[.+^${}()|[\]\\]/g, "\\$&") ?? "";
    }
  }
  re += "$";
  return new RegExp(re).test(target);
}

export interface ScopedTargetOutput {
  target: TargetId;
  absPath: string;
  preamble: string;
}

/**
 * Native path-scoped rule files for tools that support path/glob filtering:
 * - Cursor: `.cursor/rules/brief-<slug>.mdc`
 * - Claude Code: `.claude/rules/brief-<slug>.md`
 * - GitHub Copilot: `.github/instructions/brief-<slug>.instructions.md`
 */
export function scopedOutputsFor(
  cwd: string,
  doc: SourceDoc,
  enabledTargets: Record<TargetId, boolean>,
): ScopedTargetOutput[] {
  const globs = scopedGlobs(doc);
  if (globs.length === 0) return [];
  const id = slug(doc.relPath.replace(/\.md$/, "") || doc.title);
  const out: ScopedTargetOutput[] = [];

  if (enabledTargets.cursor) {
    out.push({
      target: "cursor",
      absPath: path.join(cwd, ".cursor", "rules", `brief-${id}.mdc`),
      preamble: [
        "---",
        `description: ${JSON.stringify(doc.title)}`,
        `globs: ${JSON.stringify(globs.join(", "))}`,
        "alwaysApply: false",
        "---",
        "",
      ].join("\n"),
    });
  }

  if (enabledTargets.claude) {
    out.push({
      target: "claude",
      absPath: path.join(cwd, ".claude", "rules", `brief-${id}.md`),
      preamble: [
        "---",
        "paths:",
        ...globs.map((g) => `  - ${JSON.stringify(g)}`),
        "---",
        "",
      ].join("\n"),
    });
  }

  if (enabledTargets.copilot) {
    out.push({
      target: "copilot",
      absPath: path.join(cwd, ".github", "instructions", `brief-${id}.instructions.md`),
      preamble: [
        "---",
        `applyTo: ${JSON.stringify(globs.join(","))}`,
        "---",
        "",
      ].join("\n"),
    });
  }

  return out;
}
