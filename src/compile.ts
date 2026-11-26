import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { applyProfile, budgetFor } from "./config.js";
import { detectProject } from "./detect.js";
import { isGlobalStack, loadLayers, type LayerSet } from "./layers.js";
import { assemble, hashInner, parseRegion, PRESERVED_NOTE, renderBlock } from "./markers.js";
import { renderBrief, applyVariant } from "./render.js";
import { isScopedDoc, scopedOutputsFor } from "./scoped.js";
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
import { assertUnlinked, displayPath, estimateTokens, normalize, readText, toPosix, writeText } from "./util.js";

export interface ManifestFile {
  target: TargetId;
  scope: Scope;
  variant: Variant;
  hash: string;
  scopedFileHash?: string;
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
      const action = await applyPlan(plan, options, previous?.files[plan.manifestKey]);
      actions.push(action);
      if (action.status === "wrote" || action.status === "merged" || action.status === "unchanged") {
        next.files[plan.manifestKey] = {
          target: plan.target,
          scope: plan.scope,
          variant: planned.variant,
          hash: plan.hash,
          ...(plan.scoped ? { scopedFileHash: fileHash(plan.contents) } : {}),
          bytes: plan.bytes,
          tokens: plan.tokens,
        };
      }
    }
    if (scope === "project") {
      const active = new Set(scopePlans.map(plan => plan.manifestKey));
      for (const [key, entry] of Object.entries(previous?.files ?? {})) {
        if (active.has(key) || !isScopedKey(key)) continue;
        const file = path.join(options.cwd, key);
        const existing = await readText(file);
        if (existing !== null) {
          const region = parseRegion(existing);
          if (!region || region.postamble.trim() || region.attrs.target !== entry.target ||
              hashInner(region.inner) !== entry.hash || fileHash(existing) !== entry.scopedFileHash) {
            planned.warnings.push(`Preserved obsolete scoped rule ${key}; review its contents.`);
            continue;
          }
          if (!options.dryRun) await unlink(file);
          planned.warnings.push(`${options.dryRun ? "Would remove" : "Removed"} obsolete scoped rule ${key}.`);
        }
        delete next.files[key];
      }
    }
    const filesChanged = !previous || JSON.stringify(previous.files) !== JSON.stringify(next.files);
    if (!options.dryRun && (scopePlans.length > 0 || previous) && filesChanged) {
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
    throw new Error("Nothing to compile. Run `agentbrief init` to create ~/.brief, .brief, or both.");
  }
  const facts = await detectProject(options.cwd);
  const warnings: string[] = [];
  if (scopes.includes("project") && config.composition === "full" && layers.personal.length > 0) {
    warnings.push("Full composition includes personal instructions in project files. Review them before committing or sharing; use layered composition to keep personal instructions global.");
  }
  const missingStacks: string[] = [];
  const plans: PlannedFile[] = [];
  for (const scope of scopes) {
    const { docs: stackDocs, missing, undetected } = selectStacks(layers, scope, facts.stacks);
    missingStacks.push(...missing);
    for (const id of missing) {
      warnings.push(`Stack "${id}" is selected but ~/.brief/stacks/${id}.md does not exist.`);
    }
    for (const id of undetected) {
      warnings.push(
        `Detected a ${id} project, but ~/.brief/stacks/${id}.md does not exist, so no ${id} rules were added. Run \`agentbrief init --global\` to create it.`,
      );
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
    if (scope === "project") {
      for (const doc of layers.project.filter(isScopedDoc)) {
        const scopedInner = applyVariant(doc.body, config.variant);
        if (!scopedInner) continue;
        for (const out of scopedOutputsFor(options.cwd, doc, config.targets)) {
          const block = renderBlock({
            target: out.target,
            variant: config.variant,
            composition: config.composition,
            inner: `# ${doc.title}\n\n${scopedInner}`,
          });
          const contents = assemble(out.preamble, block, "");
          const budget = budgetFor(config, out.target, config.variant);
          const tokens = estimateTokens(contents, config.charsPerToken);
          const bytes = Buffer.byteLength(contents);
          plans.push({
            scoped: true,
            scope: "project",
            target: out.target,
            absPath: out.absPath,
            displayPath: displayPath(out.absPath, options.userHome, options.cwd),
            manifestKey: manifestKey(out.absPath, options, "project"),
            contents,
            inner: normalize(`# ${doc.title}\n\n${scopedInner}`),
            hash: hashInner(`# ${doc.title}\n\n${scopedInner}`),
            tokens,
            chars: contents.length,
            bytes,
            overBudget: tokens > budget,
            budget,
          });
        }
      }
    }
  }
  const paths = new Set<string>();
  for (const plan of plans) {
    const key = process.platform === "win32" ? plan.absPath.toLowerCase() : plan.absPath;
    if (paths.has(key)) throw new Error(`Multiple rules target ${plan.displayPath}; rename the conflicting sources.`);
    paths.add(key);
    await assertUnlinked(plan.absPath);
  }
  warnings.push(...sessionWarnings(plans, budgetFor(config, "agents", config.variant)));
  if (scopes.includes("project") && config.composition === "full" && layers.personal.length === 0) {
    warnings.push("No personal layer found. Project files will not include who you are. Run `agentbrief init --global`.");
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

async function applyPlan(plan: PlannedFile, options: CompileOptions, previous: ManifestFile | undefined): Promise<FileAction> {
  const base: Omit<FileAction, "status"> = {
    displayPath: plan.displayPath,
    manifestKey: plan.manifestKey,
    scope: plan.scope,
    target: plan.target,
    tokens: plan.tokens,
    overBudget: plan.overBudget,
  };
  const existing = await readText(plan.absPath);
  if (plan.scoped && existing !== null && fileHash(existing) !== fileHash(plan.contents)) {
    if (previous?.scopedFileHash !== fileHash(existing)) {
      return { ...base, status: "skipped", reason: "scoped rule has local changes or unknown ownership" };
    }
    if (!options.dryRun) await writeText(plan.absPath, plan.contents);
    return { ...base, status: options.dryRun ? "dry-run" : "wrote" };
  }
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
  const clean = regionIsClean(region.inner, region.attrs["hash"], plan.hash, previous?.hash);
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
    status: "wrote",
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

export function isScopedKey(key: string): boolean {
  return /^(?:\.cursor\/rules\/brief-[a-z0-9-]+\.mdc|\.claude\/rules\/brief-[a-z0-9-]+\.md|\.github\/instructions\/brief-[a-z0-9-]+\.instructions\.md)$/.test(key);
}

export function fileHash(text: string): string {
  return createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
}

async function backupOf(file: string, root: string, key: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rel = path.isAbsolute(key) ? path.basename(file) : key.replace(/^~\//, "");
  const dest = path.join(root, stamp, rel);
  const contents = await readText(file);
  if (contents === null) throw new Error(`Missing backup source: ${file}`);
  await writeText(dest, contents);
  return dest;
}

function selectStacks(
  layers: LayerSet,
  scope: Scope,
  detected: string[],
): { docs: SourceDoc[]; missing: string[]; undetected: string[] } {
  const available = new Map(layers.stacks.map((doc) => [doc.stackId ?? "", doc]));
  const globalIds = layers.stacks.filter(isGlobalStack).map((doc) => doc.stackId ?? "");
  // Stacks the user named in brief.toml must exist. Stacks the repo merely
  // looks like are optional: without a stack file there is nothing to add.
  let declared: string[];
  let inferred: string[] = [];
  if (scope === "global") {
    declared = layers.globalStacks ?? [];
    if (!layers.globalStacks) inferred = globalIds;
  } else if (layers.projectStacks) {
    declared = layers.projectStacks;
  } else {
    declared = [];
    inferred = unique([...detected, ...globalIds]);
  }
  const docs: SourceDoc[] = [];
  const missing: string[] = [];
  const undetected: string[] = [];
  for (const id of unique([...declared, ...inferred])) {
    if (!id) continue;
    const doc = available.get(id);
    if (doc) docs.push(doc);
    else if (declared.includes(id)) missing.push(id);
    else undetected.push(id);
  }
  return { docs, missing, undetected };
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
