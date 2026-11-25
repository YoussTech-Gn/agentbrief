import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyProfile, budgetFor } from "./config.js";
import { detectProject } from "./detect.js";
import { isGlobalStack, loadLayers, type LayerSet } from "./layers.js";
import { assemble, hashInner, parseRegion, PRESERVED_NOTE, renderBlock } from "./markers.js";
import { renderBrief } from "./render.js";
import { preambleFor, SESSIONS, TARGETS, toolHomes, type TargetSpec } from "./targets.js";
import type {
  BriefConfig,
  CompileOptions,
  CompileReport,
  Composition,
  FileAction,
  PlannedFile,
  Scope,
  SourceDoc,
  TargetId,
  Variant,
} from "./types.js";
import { displayPath, estimateTokens, normalize, readText, toPosix, writeText } from "./util.js";

export interface ManifestFile {
  target: TargetId;
  scope: Scope;
  variant: Variant;
  hash: string;
  bytes: number;
  tokens: number;
}

export interface Manifest {
  version: 1;
  compiledAt: string;
  variant: Variant;
  composition: Composition;
  files: Record<string, ManifestFile>;
}

export async function compileBrief(options: CompileOptions): Promise<CompileReport> {
  const planned = await planCompilation(options);
  const actions: FileAction[] = [];
  for (const scope of planned.scopes) {
    const manifestPath = manifestFile(options, scope);
    const previous = await readManifest(manifestPath);
    const next: Manifest = {
      version: 1,
      compiledAt: new Date().toISOString(),
      variant: planned.variant,
      composition: planned.composition,
      files: { ...(previous?.files ?? {}) },
    };
    const scopePlans = planned.plans.filter((plan) => plan.scope === scope);
    for (const plan of scopePlans) {
      const action = await applyPlan(plan, options, previous?.files[plan.manifestKey]?.hash);
      actions.push(action);
      if (action.status === "wrote" || action.status === "merged" || action.status === "unchanged") {
        next.files[plan.manifestKey] = {
          target: plan.target,
          scope: plan.scope,
          variant: planned.variant,
          hash: plan.hash,
          bytes: plan.bytes,
          tokens: plan.tokens,
        };
      }
    }
    const filesChanged = !previous || JSON.stringify(previous.files) !== JSON.stringify(next.files);
    if (!options.dryRun && scopePlans.length > 0 && filesChanged) {
      await writeText(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
    }
  }
  return {
    files: actions,
    warnings: planned.warnings,
    scopes: planned.scopes,
    variant: planned.variant,
    composition: planned.composition,
  };
}

export interface Plan {
  plans: PlannedFile[];
  warnings: string[];
  scopes: Scope[];
  variant: Variant;
  composition: Composition;
  config: BriefConfig;
  layers: LayerSet;
  missingStacks: string[];
}

export async function planCompilation(options: CompileOptions): Promise<Plan> {
  const layers = await loadLayers(options.cwd, options.briefHome);
  const applied = applyProfile(layers.config, options.profile);
  const config: BriefConfig = options.variant ? { ...applied, variant: options.variant } : applied;
  const scopes = resolveScopes(options, layers);
  if (scopes.length === 0) {
    throw new Error("Nothing to compile. Run `brief init` to create ~/.brief, .brief, or both.");
  }
  const facts = await detectProject(options.cwd);
  const warnings: string[] = [];
  const missingStacks: string[] = [];
  const plans: PlannedFile[] = [];
  for (const scope of scopes) {
    const { docs: stackDocs, missing } = selectStacks(layers, scope, facts.stacks);
    missingStacks.push(...missing);
    for (const id of missing) {
      warnings.push(`Stack "${id}" is selected but ~/.brief/stacks/${id}.md does not exist.`);
    }
    const inner = renderBrief({
      variant: config.variant,
      composition: config.composition,
      scope,
      personal: scope === "global" || config.composition === "full" ? layers.personal : [],
      stacks: stackDocs,
      project: scope === "project" ? layers.project : [],
    });
    for (const spec of TARGETS) {
      if (!config.targets[spec.id]) continue;
      const absPath = await outputPath(options, spec, scope);
      if (!absPath) continue;
      const preamble = preambleFor(spec.wrap, scope);
      const block = renderBlock({
        target: spec.id,
        variant: config.variant,
        composition: config.composition,
        inner,
      });
      const contents = assemble(preamble, block, "");
      const budget = budgetFor(config, spec.id, config.variant);
      const tokens = estimateTokens(contents, config.charsPerToken);
      const limit = scope === "global" ? spec.charLimit?.global : spec.charLimit?.project;
      const byteLimit = scope === "global" ? spec.byteLimit?.global : spec.byteLimit?.project;
      const bytes = Buffer.byteLength(contents);
      if (tokens > budget) {
        warnings.push(
          `${displayPath(absPath, options.userHome, options.cwd)} is about ${tokens} tokens, over the ${budget} token budget.`,
        );
      }
      if (limit && contents.length > limit) {
        warnings.push(
          `${displayPath(absPath, options.userHome, options.cwd)} is ${contents.length} characters, over the ${limit} character limit documented for this file.`,
        );
      }
      if (byteLimit && bytes > byteLimit) {
        warnings.push(
          `${displayPath(absPath, options.userHome, options.cwd)} is ${bytes} bytes, over the ${byteLimit} byte limit documented for this file.`,
        );
      }
      plans.push({
        scope,
        target: spec.id,
        absPath,
        displayPath: displayPath(absPath, options.userHome, options.cwd),
        manifestKey: manifestKey(absPath, options, scope),
        contents,
        inner: normalize(inner),
        hash: hashInner(inner),
        tokens,
        chars: contents.length,
        bytes,
        overBudget: tokens > budget,
        budget,
        charLimit: limit,
        byteLimit,
      });
    }
  }
  warnings.push(...sessionWarnings(plans, budgetFor(config, "agents", config.variant)));
  if (scopes.includes("project") && config.composition === "full" && layers.personal.length === 0) {
    warnings.push("No personal layer found. Project files will not include who you are. Run `brief init --global`.");
  }
  const claudeDot = path.join(options.cwd, ".claude", "CLAUDE.md");
  const claudeRoot = path.join(options.cwd, "CLAUDE.md");
  if ((await readText(claudeDot)) !== null && plans.some((plan) => plan.absPath === claudeRoot)) {
    warnings.push(
      "Both ./CLAUDE.md and ./.claude/CLAUDE.md exist. brief writes ./CLAUDE.md. If Claude Code loads both, delete or empty the one you do not want.",
    );
  }
  return {
    plans,
    warnings: unique(warnings),
    scopes,
    variant: config.variant,
    composition: config.composition,
    config,
    layers,
    missingStacks: unique(missingStacks),
  };
}

export function manifestFile(options: Pick<CompileOptions, "cwd" | "briefHome">, scope: Scope): string {
  return scope === "global"
    ? path.join(options.briefHome, "manifest.json")
    : path.join(options.cwd, ".brief", "manifest.json");
}

export async function readManifest(file: string): Promise<Manifest | null> {
  const text = await readText(file);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text) as Manifest;
    if (!parsed || parsed.version !== 1 || !parsed.files) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function applyPlan(plan: PlannedFile, options: CompileOptions, previousHash: string | undefined): Promise<FileAction> {
  const base: Omit<FileAction, "status"> = {
    displayPath: plan.displayPath,
    manifestKey: plan.manifestKey,
    scope: plan.scope,
    target: plan.target,
    tokens: plan.tokens,
    overBudget: plan.overBudget,
  };
  const existing = await readText(plan.absPath);
  if (existing === null || normalize(existing) === "") {
    if (!options.dryRun) await writeText(plan.absPath, plan.contents);
    return { ...base, status: options.dryRun ? "dry-run" : "wrote" };
  }
  if (normalize(existing) === normalize(plan.contents)) {
    return { ...base, status: options.dryRun ? "dry-run" : "unchanged" };
  }
  const region = parseRegion(existing);
  const backupRoot = plan.scope === "global"
    ? path.join(options.briefHome, "backups")
    : path.join(options.cwd, ".brief", "backups");
  if (!region) {
    if (options.dryRun) {
      return { ...base, status: "dry-run", reason: "would keep hand-written content and prepend the generated block" };
    }
    const backup = await backupOf(plan.absPath, backupRoot, plan.manifestKey);
    const postamble = `${PRESERVED_NOTE}${existing.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")}`;
    await writeText(plan.absPath, assemble(preambleOf(plan), blockFrom(plan), postamble));
    return { ...base, status: "merged", reason: "kept hand-written content below the generated block", backup };
  }
  const clean = regionIsClean(region.inner, region.attrs["hash"], plan.hash, previousHash);
  const preamble = choosePreamble(region.preamble, preambleOf(plan));
  const next = assemble(preamble, blockFrom(plan), region.postamble);
  if (!clean && !options.force) {
    if (options.dryRun) {
      return { ...base, status: "dry-run", reason: "would skip a hand-edited generated region" };
    }
    const backup = await backupOf(plan.absPath, backupRoot, plan.manifestKey);
    await writeText(`${backup}.incoming`, plan.contents);
    return {
      ...base,
      status: "skipped",
      reason: "generated region was edited by hand; re-run with --force to replace it (a backup is kept)",
      backup,
    };
  }
  if (normalize(existing) === normalize(next)) {
    return { ...base, status: options.dryRun ? "dry-run" : "unchanged" };
  }
  if (options.dryRun) return { ...base, status: "dry-run" };
  let backup: string | undefined;
  if (!clean || preamble !== region.preamble) {
    backup = await backupOf(plan.absPath, backupRoot, plan.manifestKey);
  }
  await writeText(plan.absPath, next);
  return {
    ...base,
    status: clean ? "wrote" : "wrote",
    reason: clean ? undefined : "replaced a hand-edited generated region after writing a backup",
    backup,
  };
}

function regionIsClean(inner: string, markerHash: string | undefined, expectedHash: string, manifestHash: string | undefined): boolean {
  const bodyHash = hashInner(inner);
  if (bodyHash === expectedHash) return true;
  if (!markerHash || bodyHash !== markerHash) return false;
  if (manifestHash && manifestHash !== bodyHash) return false;
  return true;
}

function choosePreamble(existing: string, expected: string): string {
  if (!existing.trim()) return expected;
  if (normalize(existing) === normalize(expected)) return expected;
  return existing.endsWith("\n") ? existing : `${existing}\n`;
}

function preambleOf(plan: PlannedFile): string {
  const region = parseRegion(plan.contents);
  return region?.preamble ?? "";
}

function blockFrom(plan: PlannedFile): string {
  const region = parseRegion(plan.contents);
  if (!region) return plan.contents;
  const hash = region.attrs["hash"] ?? plan.hash;
  const target = region.attrs["target"] ?? plan.target;
  const variant = region.attrs["variant"] ?? "full";
  const composition = region.attrs["composition"] ?? "full";
  return `<!-- brief:generated target=${target} variant=${variant} composition=${composition} hash=${hash} -->\n${region.inner}\n<!-- brief:end -->\n`;
}

async function backupOf(file: string, root: string, key: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rel = key.replace(/^~\//, "");
  const dest = path.join(root, stamp, rel);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, await readFile(file));
  return dest;
}

function selectStacks(
  layers: LayerSet,
  scope: Scope,
  detected: string[],
): { docs: SourceDoc[]; missing: string[] } {
  const available = new Map(layers.stacks.map((doc) => [doc.stackId ?? "", doc]));
  let ids: string[];
  if (scope === "global") {
    ids = layers.globalStacks ?? layers.stacks.filter(isGlobalStack).map((doc) => doc.stackId ?? "");
  } else if (layers.projectStacks) {
    ids = layers.projectStacks;
  } else {
    ids = unique([...detected, ...layers.stacks.filter(isGlobalStack).map((doc) => doc.stackId ?? "")]);
  }
  const docs: SourceDoc[] = [];
  const missing: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    const doc = available.get(id);
    if (!doc) missing.push(id);
    else docs.push(doc);
  }
  return { docs, missing };
}

async function outputPath(options: CompileOptions, spec: TargetSpec, scope: Scope): Promise<string | null> {
  const homes = toolHomes(options.userHome, options.env ?? process.env);
  if (scope === "global") return spec.globalFile(homes);
  if (!spec.projectFile) return null;
  if (spec.id === "claude") {
    const root = path.join(options.cwd, "CLAUDE.md");
    const dot = path.join(options.cwd, ".claude", "CLAUDE.md");
    if ((await readText(root)) === null && (await readText(dot)) !== null) return dot;
    return root;
  }
  return path.join(options.cwd, spec.projectFile);
}

function manifestKey(absPath: string, options: CompileOptions, scope: Scope): string {
  if (scope === "project") return toPosix(path.relative(options.cwd, absPath));
  return displayPath(absPath, options.userHome, options.cwd);
}

function resolveScopes(options: CompileOptions, layers: LayerSet): Scope[] {
  if (options.scopes && options.scopes.length > 0) return options.scopes;
  const scopes: Scope[] = [];
  if (layers.hasGlobal) scopes.push("global");
  if (layers.hasProject) scopes.push("project");
  return scopes;
}

function sessionWarnings(plans: PlannedFile[], budget: number): string[] {
  const warnings: string[] = [];
  for (const session of SESSIONS) {
    const parts = session.parts.flatMap((part) => {
      const plan = plans.find((item) => item.target === part.target && item.scope === part.scope);
      return plan ? [plan] : [];
    });
    if (parts.length < 2) continue;
    const tokens = parts.reduce((sum, plan) => sum + plan.tokens, 0);
    if (tokens > budget) {
      warnings.push(
        `${session.label} may load ${parts.length} generated files (~${tokens} tokens combined): ${parts
          .map((plan) => plan.displayPath)
          .join(", ")}.`,
      );
    }
  }
  return warnings;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
