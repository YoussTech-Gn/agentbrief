import path from "node:path";
import type { Scope, TargetId } from "./types.js";

/**
 * Native instruction files, checked against official docs on 2026-11-22.
 * See README for the source of each path and the things that could not be
 * verified. Paths here are the ones those docs name.
 */

export type Wrap = "plain" | "cursor-mdc" | "windsurf-rule";

export interface TargetSpec {
  id: TargetId;
  label: string;
  docs: string;
  /** Project-relative output, or null when this target has no project file. */
  projectFile: string | null;
  /** Absolute global output, or null when this target has no global file. */
  globalFile: (homes: ToolHomes) => string | null;
  wrap: Wrap;
  /** Hard character cap documented by the tool, applied to the whole file. */
  charLimit?: { project?: number; global?: number };
  /** Hard byte cap documented by the tool. */
  byteLimit?: { project?: number; global?: number };
}

export interface ToolHomes {
  claude: string;
  codex: string;
  copilot: string;
  grok: string;
  gemini: string;
  cursor: string;
  windsurfMemories: string;
}

export function toolHomes(userHome: string, env: NodeJS.ProcessEnv = process.env): ToolHomes {
  return {
    claude: env.CLAUDE_CONFIG_DIR || path.join(userHome, ".claude"),
    codex: env.CODEX_HOME || path.join(userHome, ".codex"),
    copilot: env.COPILOT_HOME || path.join(userHome, ".copilot"),
    grok: env.GROK_HOME || path.join(userHome, ".grok"),
    gemini: path.join(userHome, ".gemini"),
    cursor: path.join(userHome, ".cursor"),
    windsurfMemories: path.join(userHome, ".codeium", "windsurf", "memories"),
  };
}

export const TARGETS: TargetSpec[] = [
  {
    id: "claude",
    label: "Claude Code",
    docs: "https://code.claude.com/docs/en/memory",
    projectFile: "CLAUDE.md",
    globalFile: (h) => path.join(h.claude, "CLAUDE.md"),
    wrap: "plain",
  },
  {
    id: "agents",
    label: "AGENTS.md (generic, Codex, Cursor, Copilot, Windsurf, Grok)",
    docs: "https://agents.md",
    projectFile: "AGENTS.md",
    globalFile: () => null,
    wrap: "plain",
    byteLimit: { project: 32768 },
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    docs: "https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html",
    projectFile: "GEMINI.md",
    globalFile: (h) => path.join(h.gemini, "GEMINI.md"),
    wrap: "plain",
  },
  {
    id: "cursor",
    label: "Cursor",
    docs: "https://cursor.com/docs/rules",
    projectFile: path.join(".cursor", "rules", "brief.mdc"),
    globalFile: (h) => path.join(h.cursor, "rules", "brief.mdc"),
    wrap: "cursor-mdc",
  },
  {
    id: "copilot",
    label: "GitHub Copilot",
    docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions",
    projectFile: path.join(".github", "copilot-instructions.md"),
    globalFile: (h) => path.join(h.copilot, "copilot-instructions.md"),
    wrap: "plain",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    docs: "https://docs.windsurf.com/fr/windsurf/cascade/memories",
    projectFile: path.join(".windsurf", "rules", "brief.md"),
    globalFile: (h) => path.join(h.windsurfMemories, "global_rules.md"),
    wrap: "windsurf-rule",
    charLimit: { project: 12000, global: 6000 },
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    docs: "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
    projectFile: null,
    globalFile: (h) => path.join(h.codex, "AGENTS.md"),
    wrap: "plain",
  },
  {
    id: "grok",
    label: "Grok Build",
    docs: "https://docs.x.ai/build/features/project-rules",
    projectFile: path.join(".grok", "rules", "brief.md"),
    globalFile: (h) => path.join(h.grok, "AGENTS.md"),
    wrap: "plain",
  },
];

export function targetById(id: TargetId): TargetSpec {
  const found = TARGETS.find((target) => target.id === id);
  if (!found) throw new Error(`Unknown target ${id}`);
  return found;
}

export interface SessionSpec {
  id: string;
  label: string;
  docs: string;
  parts: Array<{ target: TargetId; scope: Scope }>;
  note: string;
}

/**
 * Files each tool loads in one session, from the docs cited on each row.
 * Used only to warn when the sum will crowd the context window.
 */
export const SESSIONS: SessionSpec[] = [
  {
    id: "claude",
    label: "Claude Code",
    docs: "https://code.claude.com/docs/en/memory",
    parts: [
      { target: "claude", scope: "global" },
      { target: "claude", scope: "project" },
    ],
    note: "By default Claude reads CLAUDE.md and does not also read AGENTS.md when a CLAUDE.md is present. ~/.claude/CLAUDE.md is loaded alongside the project file.",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    docs: "https://google-gemini.github.io/gemini-cli/docs/cli/gemini-md.html",
    parts: [
      { target: "gemini", scope: "global" },
      { target: "gemini", scope: "project" },
    ],
    note: "Gemini concatenates ~/.gemini/GEMINI.md and the project GEMINI.md. The default context filename is GEMINI.md, not AGENTS.md.",
  },
  {
    id: "codex",
    label: "OpenAI Codex",
    docs: "https://learn.chatgpt.com/docs/agent-configuration/agents-md",
    parts: [
      { target: "codex", scope: "global" },
      { target: "agents", scope: "project" },
    ],
    note: "Codex reads ~/.codex/AGENTS.md, then AGENTS.md from the repo root down to the working directory. The combined project docs stop at project_doc_max_bytes (32 KiB by default).",
  },
  {
    id: "cursor",
    label: "Cursor",
    docs: "https://cursor.com/docs/rules",
    parts: [
      { target: "cursor", scope: "global" },
      { target: "cursor", scope: "project" },
      { target: "agents", scope: "project" },
      { target: "claude", scope: "project" },
    ],
    note: "Cursor loads .cursor/rules/*.mdc, user rule files in ~/.cursor/rules, AGENTS.md, and CLAUDE.md. Account User Rules in Customize have no file brief can write.",
  },
  {
    id: "copilot",
    label: "GitHub Copilot CLI",
    docs: "https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-custom-instructions",
    parts: [
      { target: "copilot", scope: "global" },
      { target: "copilot", scope: "project" },
      { target: "agents", scope: "project" },
      { target: "claude", scope: "project" },
      { target: "gemini", scope: "project" },
    ],
    note: "Copilot CLI combines these files. Editor and github.com surfaces vary; the repo-wide file they share is .github/copilot-instructions.md.",
  },
  {
    id: "windsurf",
    label: "Windsurf",
    docs: "https://docs.windsurf.com/fr/windsurf/cascade/memories",
    parts: [
      { target: "windsurf", scope: "global" },
      { target: "windsurf", scope: "project" },
      { target: "agents", scope: "project" },
    ],
    note: "Workspace rules are capped at 12,000 characters and the global file at 6,000. Root AGENTS.md is always on. Devin also imports .windsurf/rules.",
  },
  {
    id: "grok",
    label: "Grok Build",
    docs: "https://docs.x.ai/build/features/project-rules",
    parts: [
      { target: "grok", scope: "global" },
      { target: "grok", scope: "project" },
      { target: "agents", scope: "project" },
      { target: "claude", scope: "project" },
    ],
    note: "Grok reads ~/.grok/, then AGENTS.md and CLAUDE.md, plus every .md file in .grok/rules/. It also scans .cursor/rules and .claude/rules for compatibility; those directories are documented as *.md, so a .mdc rule may not be included.",
  },
];

export function preambleFor(wrap: Wrap, scope: Scope): string {
  if (wrap === "cursor-mdc") {
    return [
      "---",
      "description: Builder brief compiled by brief. Edit the source layers, then run brief compile.",
      "alwaysApply: true",
      "---",
      "",
    ].join("\n");
  }
  // Windsurf global_rules.md is always on and must not carry front matter.
  if (wrap === "windsurf-rule" && scope === "project") {
    return [
      "---",
      "description: Builder brief compiled by brief",
      "trigger: always_on",
      "---",
      "",
    ].join("\n");
  }
  return "";
}
