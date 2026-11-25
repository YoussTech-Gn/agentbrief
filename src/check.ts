import { stat } from "node:fs/promises";
import path from "node:path";
import { budgetFor } from "./config.js";
import { fileHash, isScopedKey, manifestFile, planCompilation, readManifest, type Manifest } from "./compile.js";
import { commandScript, declarationsFrom, detectProject } from "./detect.js";
import { hashInner, parseRegion } from "./markers.js";
import { SESSIONS, TARGETS, toolHomes } from "./targets.js";
import type { CheckReport, CompileOptions, Finding, Scope, SessionEstimate } from "./types.js";
import { displayPath, readText } from "./util.js";

export async function checkBrief(options: CompileOptions & { strict?: boolean }): Promise<CheckReport> {
  const planned = await planCompilation(options);
  const findings: Finding[] = [];
  const files: CheckReport["files"] = [];
  const manifests = new Map<Scope, Manifest | null>();
  for (const scope of planned.scopes) {
    manifests.set(scope, await readManifest(manifestFile(options, scope)));
  }

  for (const plan of planned.plans) {
    const existing = await readText(plan.absPath);
    const manifestHash = manifests.get(plan.scope)?.files[plan.manifestKey]?.hash;
    if (existing === null || existing.trim() === "") {
      findings.push({ severity: "error", code: "missing", path: plan.displayPath, message: `${plan.displayPath} is missing. Run agentbrief compile.` });
      files.push({ displayPath: plan.displayPath, status: "missing", tokens: plan.tokens });
      continue;
    }
    const region = parseRegion(existing);
    if (!region) {
      findings.push({
        severity: "error",
        code: "diverged",
        path: plan.displayPath,
        message: `${plan.displayPath} has no brief markers. It was not produced by the last compile, or the markers were removed.`,
      });
      files.push({ displayPath: plan.displayPath, status: "diverged", tokens: plan.tokens });
      continue;
    }
    const bodyHash = hashInner(region.inner);
    const markerHash = region.attrs["hash"];
    if (plan.scoped && fileHash(existing) !== fileHash(plan.contents) && bodyHash === plan.hash) {
      findings.push({ severity: "error", code: "stale", path: plan.displayPath, message: `${plan.displayPath} has outdated or edited scoped rule metadata.` });
      files.push({ displayPath: plan.displayPath, status: "stale", tokens: plan.tokens });
    } else if (bodyHash === plan.hash) {
      files.push({ displayPath: plan.displayPath, status: "ok", tokens: plan.tokens });
    } else if (markerHash && bodyHash !== markerHash) {
      findings.push({
        severity: "error",
        code: "edited",
        path: plan.displayPath,
        message: `${plan.displayPath} was edited inside the generated region. Move the change into a source layer with agentbrief propose, or recompile with --force.`,
      });
      files.push({ displayPath: plan.displayPath, status: "edited", tokens: plan.tokens });
    } else if (!manifestHash || bodyHash === manifestHash || bodyHash === markerHash) {
      findings.push({
        severity: "error",
        code: "stale",
        path: plan.displayPath,
        message: `${plan.displayPath} is stale. The source layers changed after it was compiled.`,
      });
      files.push({ displayPath: plan.displayPath, status: "stale", tokens: plan.tokens });
    } else {
      findings.push({
        severity: "error",
        code: "diverged",
        path: plan.displayPath,
        message: `${plan.displayPath} does not match the source layers or the last compile.`,
      });
      files.push({ displayPath: plan.displayPath, status: "diverged", tokens: plan.tokens });
    }
    if (plan.overBudget) {
      findings.push({
        severity: "warning",
        code: "budget",
        path: plan.displayPath,
        message: `${plan.displayPath} is about ${plan.tokens} tokens, over the ${plan.budget} token budget. Use --variant short or raise [budget].`,
      });
    }
    if (plan.charLimit && plan.chars > plan.charLimit) {
      findings.push({
        severity: "warning",
        code: "char-limit",
        path: plan.displayPath,
        message: `${plan.displayPath} is ${plan.chars} characters, over the documented ${plan.charLimit} character limit.`,
      });
    }
    if (plan.byteLimit && plan.bytes > plan.byteLimit) {
      findings.push({
        severity: "warning",
        code: "byte-limit",
        path: plan.displayPath,
        message: `${plan.displayPath} is ${plan.bytes} bytes, over the documented ${plan.byteLimit} byte limit.`,
      });
    }
  }

  for (const id of planned.missingStacks) {
    findings.push({
      severity: "error",
      code: "stack",
      message: `Selected stack "${id}" has no file at ~/.brief/stacks/${id}.md.`,
    });
  }

  const active = new Set(planned.plans.filter(plan => plan.scope === "project").map(plan => plan.manifestKey));
  for (const key of Object.keys(manifests.get("project")?.files ?? {})) {
    if (isScopedKey(key) && !active.has(key) && await readText(path.join(options.cwd, key)) !== null) {
      findings.push({ severity: "warning", code: "orphan", path: key, message: `Obsolete scoped rule: ${key}.` });
    }
  }
  await findOrphans(options, planned.plans, planned.scopes, findings);
  if (planned.scopes.includes("project")) {
    findings.push(...(await codeFindings(options.cwd, planned.config.packageManager, planned.config.framework, planned.layers.project)));
  }

  const sessions = sessionEstimates(planned.plans, budgetFor(planned.config, "agents", planned.variant));
  for (const session of sessions) {
    if (!session.overBudget) continue;
    findings.push({
      severity: "warning",
      code: "overlap",
      message: `${session.label} can load ${session.parts.length} generated files in one session (~${session.tokens} tokens, over the ${budgetFor(planned.config, "agents", planned.variant)} budget): ${session.parts.join(", ")}.`,
    });
  }

  return { findings, sessions, files, variant: planned.variant, composition: planned.composition };
}

async function findOrphans(
  options: CompileOptions,
  plans: { absPath: string }[],
  scopes: Scope[],
  findings: Finding[],
): Promise<void> {
  const plannedPaths = new Set(plans.map((plan) => path.resolve(plan.absPath)));
  const homes = toolHomes(options.userHome, options.env ?? process.env);
  for (const spec of TARGETS) {
    const candidates: Array<{ scope: Scope; file: string | null }> = [];
    if (scopes.includes("project")) candidates.push({ scope: "project", file: spec.projectFile ? path.join(options.cwd, spec.projectFile) : null });
    if (scopes.includes("global")) candidates.push({ scope: "global", file: spec.globalFile(homes) });
    for (const candidate of candidates) {
      if (!candidate.file || plannedPaths.has(path.resolve(candidate.file))) continue;
      const text = await readText(candidate.file);
      if (!text || !text.includes("<!-- brief:generated")) continue;
      const shown = displayPath(candidate.file, options.userHome, options.cwd);
      findings.push({
        severity: "warning",
        code: "orphan",
        path: shown,
        message: `${shown} is a generated brief file, but the ${spec.id} target is off. Delete it or turn the target back on.`,
      });
    }
  }
}

async function codeFindings(
  cwd: string,
  configPm: string | undefined,
  configFramework: string | undefined,
  projectDocs: Parameters<typeof declarationsFrom>[2],
): Promise<Finding[]> {
  const facts = await detectProject(cwd);
  const declared = declarationsFrom(configPm, configFramework, projectDocs);
  const findings: Finding[] = [];
  if (declared.packageManagers.length > 1) {
    findings.push({
      severity: "error",
      code: "declaration",
      message: `Package manager is declared more than once and the values differ: ${declared.packageManagers.join(", ")}.`,
    });
  } else if (declared.packageManagers.length === 1 && facts.packageManagers.length > 0) {
    const wanted = declared.packageManagers[0] ?? "";
    if (!facts.packageManagers.includes(wanted)) {
      findings.push({
        severity: "error",
        code: "package-manager",
        message: `Brief declares package manager "${wanted}", but the repo looks like ${facts.packageManagers.join(", ")}.`,
      });
    }
  }
  if (declared.frameworks.length > 1) {
    findings.push({
      severity: "error",
      code: "declaration",
      message: `Framework is declared more than once and the values differ: ${declared.frameworks.join(", ")}.`,
    });
  } else if (declared.frameworks.length === 1) {
    const wanted = declared.frameworks[0] ?? "";
    const hasManifest = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml"].some((file) =>
      facts.files.includes(file),
    );
    if (hasManifest && !facts.frameworks.includes(wanted)) {
      const found = facts.frameworks.length > 0 ? facts.frameworks.join(", ") : "nothing recognizable";
      findings.push({
        severity: "error",
        code: "framework",
        message: `Brief declares framework "${wanted}", but the repo looks like ${found}.`,
      });
    }
  }

  const hasPackage = facts.files.includes("package.json");
  const hasMake = facts.makefileTargets.length > 0;
  for (const command of declared.commands) {
    const parsed = commandScript(command);
    if (!parsed) continue;
    if (parsed.kind === "npm-script" && hasPackage && !facts.scripts.includes(parsed.name)) {
      findings.push({
        severity: "error",
        code: "command",
        path: command,
        message: `Command \`${command}\` references script "${parsed.name}", which is not in package.json.`,
      });
    }
    if (parsed.kind === "make" && hasMake && !facts.makefileTargets.includes(parsed.name)) {
      findings.push({
        severity: "error",
        code: "command",
        path: command,
        message: `Command \`${command}\` references make target "${parsed.name}", which is not in the Makefile.`,
      });
    }
  }
  for (const rel of declared.paths) {
    const info = await stat(path.resolve(cwd, rel)).catch(() => null);
    if (!info) {
      findings.push({
        severity: "error",
        code: "path",
        path: rel,
        message: `Referenced path \`${rel}\` does not exist.`,
      });
    }
  }
  return findings;
}

function sessionEstimates(
  plans: { target: string; scope: string; displayPath: string; tokens: number }[],
  budget: number,
): SessionEstimate[] {
  return SESSIONS.map((session) => {
    const parts = session.parts.flatMap((part) => {
      const plan = plans.find((item) => item.target === part.target && item.scope === part.scope);
      return plan ? [plan] : [];
    });
    const tokens = parts.reduce((sum, plan) => sum + plan.tokens, 0);
    return {
      id: session.id,
      label: session.label,
      tokens,
      parts: parts.map((plan) => plan.displayPath),
      docs: session.docs,
      overBudget: parts.length > 1 && tokens > budget,
    };
  }).filter((session) => session.parts.length > 0);
}
