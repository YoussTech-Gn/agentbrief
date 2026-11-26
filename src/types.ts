/** Shared types for the brief compiler. */

export const TARGET_IDS = [
  "claude",
  "agents",
  "gemini",
  "cursor",
  "copilot",
  "windsurf",
  "codex",
  "grok",
] as const;

export type TargetId = (typeof TARGET_IDS)[number];
export type Variant = "short" | "full";
export type Composition = "full" | "layered";
export type Scope = "global" | "project";
export type LayerName = "personal" | "stack" | "project";
export type Profile = "native" | "lean";

export type Scalar = string | number | boolean;
export type FmValue = Scalar | string[];
export type FrontMatter = Record<string, FmValue>;

export interface SourceDoc {
  absPath: string;
  /** Path relative to the layer root, using forward slashes. */
  relPath: string;
  layer: LayerName;
  stackId?: string;
  title: string;
  order: number;
  /** Markdown body with the front matter removed. */
  body: string;
  data: FrontMatter;
}

export interface BriefConfig {
  version: number;
  variant: Variant;
  composition: Composition;
  profile: Profile;
  /** null means the key was omitted and the caller should auto-select. */
  stacks: string[] | null;
  packageManager?: string;
  framework?: string;
  targets: Record<TargetId, boolean>;
  /** Targets a brief.toml sets to false. No profile or flag turns them back on. */
  explicitOff: TargetId[];
  budgetFull: number;
  budgetShort: number;
  charsPerToken: number;
  budgetByTarget: Partial<Record<TargetId, { full?: number; short?: number }>>;
  remote?: string;
}

export interface CompileOptions {
  cwd: string;
  briefHome: string;
  /** Directory that contains `.claude`, `.gemini`, and the other tool homes. */
  userHome: string;
  variant?: Variant;
  /** Which scopes to write. Defaults to every scope that has a source root. */
  scopes?: Scope[];
  force?: boolean;
  dryRun?: boolean;
  /** Override the saved profile for this run. */
  profile?: Profile;
  /**
   * Environment used to resolve tool homes (CLAUDE_CONFIG_DIR, CODEX_HOME,
   * COPILOT_HOME, GROK_HOME). Tests pass an empty object so a developer
   * machine cannot redirect output.
   */
  env?: NodeJS.ProcessEnv;
}

export interface PlannedFile {
  scoped?: boolean;
  scope: Scope;
  target: TargetId;
  /** Absolute path that would be written. */
  absPath: string;
  /** Display path, tilde-relative when under userHome. */
  displayPath: string;
  /** Path key stored in the manifest. */
  manifestKey: string;
  contents: string;
  /** Body inside the generated markers. */
  inner: string;
  hash: string;
  tokens: number;
  chars: number;
  bytes: number;
  overBudget: boolean;
  budget: number;
  charLimit?: number;
  byteLimit?: number;
}

export interface FileAction {
  displayPath: string;
  manifestKey: string;
  scope: Scope;
  target: TargetId;
  status: "wrote" | "unchanged" | "merged" | "skipped" | "dry-run";
  reason?: string;
  backup?: string;
  tokens: number;
  overBudget: boolean;
}

export interface CompileReport {
  files: FileAction[];
  warnings: string[];
  scopes: Scope[];
  variant: Variant;
  composition: Composition;
}

export type FindingSeverity = "error" | "warning";

export interface Finding {
  severity: FindingSeverity;
  code:
    | "missing"
    | "stale"
    | "edited"
    | "diverged"
    | "budget"
    | "char-limit"
    | "byte-limit"
    | "overlap"
    | "command"
    | "path"
    | "package-manager"
    | "framework"
    | "stack"
    | "declaration"
    | "orphan";
  message: string;
  path?: string;
}

export interface SessionEstimate {
  id: string;
  label: string;
  tokens: number;
  parts: string[];
  docs: string;
  overBudget: boolean;
}

export interface CheckReport {
  findings: Finding[];
  sessions: SessionEstimate[];
  files: Array<{
    displayPath: string;
    status: "ok" | "missing" | "stale" | "edited" | "diverged";
    tokens: number;
  }>;
  variant: Variant;
  composition: Composition;
}

export interface Proposal {
  id: string;
  title: string;
  status: "pending" | "accepted" | "rejected";
  layer: LayerName;
  file: string;
  action: "append" | "prepend";
  created: string;
  source: string;
  reason?: string;
  resolved?: string;
  body: string;
  absPath: string;
}
