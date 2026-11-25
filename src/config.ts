import path from "node:path";
import type { BriefConfig, Profile, TargetId, Variant } from "./types.js";
import { TARGET_IDS } from "./types.js";
import { parseToml, tomlGet, type Toml, type TomlValue } from "./toml.js";
import { readText } from "./util.js";

export const LEAN_OFF: TargetId[] = ["cursor", "windsurf", "grok"];

export function baseConfig(): BriefConfig {
  const targets = {} as Record<TargetId, boolean>;
  for (const id of TARGET_IDS) targets[id] = true;
  return {
    version: 1,
    variant: "full",
    composition: "full",
    profile: "native",
    stacks: null,
    targets,
    budgetFull: 4000,
    budgetShort: 1500,
    charsPerToken: 4,
    budgetByTarget: {},
  };
}

export async function loadConfigFile(file: string): Promise<Partial<BriefConfig> & { stacksSpecified: boolean }> {
  const text = await readText(file);
  if (text === null) return { stacksSpecified: false };
  return configFromToml(parseToml(text));
}

export function configFromToml(toml: Toml): Partial<BriefConfig> & { stacksSpecified: boolean } {
  const partial: Partial<BriefConfig> & { stacksSpecified: boolean } = { stacksSpecified: false };
  const version = tomlGet(toml, "version");
  if (typeof version === "number") partial.version = version;
  const variant = tomlGet(toml, "variant");
  if (variant === "short" || variant === "full") partial.variant = variant;
  const composition = tomlGet(toml, "composition");
  if (composition === "full" || composition === "layered") partial.composition = composition;
  const profile = tomlGet(toml, "profile");
  if (profile === "native" || profile === "lean") partial.profile = profile;
  if (Object.prototype.hasOwnProperty.call(toml, "stacks")) {
    partial.stacksSpecified = true;
    partial.stacks = stringList(toml["stacks"]);
  }
  const pm = tomlGet(toml, "package_manager");
  if (typeof pm === "string" && pm.trim()) partial.packageManager = pm.trim();
  const framework = tomlGet(toml, "framework");
  if (typeof framework === "string" && framework.trim()) partial.framework = framework.trim();
  const remote = tomlGet(toml, "sync.remote");
  if (typeof remote === "string") partial.remote = remote;

  const targetsTable = tomlGet(toml, "targets");
  if (isTable(targetsTable)) {
    const targets = {} as Record<TargetId, boolean>;
    let any = false;
    for (const id of TARGET_IDS) {
      if (typeof targetsTable[id] === "boolean") {
        targets[id] = targetsTable[id] as boolean;
        any = true;
      }
    }
    if (any) partial.targets = { ...baseConfig().targets, ...targets };
  }

  const budget = tomlGet(toml, "budget");
  if (isTable(budget)) {
    if (typeof budget["full"] === "number") partial.budgetFull = budget["full"];
    if (typeof budget["short"] === "number") partial.budgetShort = budget["short"];
    if (typeof budget["chars_per_token"] === "number") partial.charsPerToken = budget["chars_per_token"];
    const byTarget: BriefConfig["budgetByTarget"] = {};
    for (const id of TARGET_IDS) {
      const entry = budget[id];
      if (!isTable(entry)) continue;
      const next: { full?: number; short?: number } = {};
      if (typeof entry["full"] === "number") next.full = entry["full"];
      if (typeof entry["short"] === "number") next.short = entry["short"];
      byTarget[id] = next;
    }
    partial.budgetByTarget = byTarget;
  }
  return partial;
}

export function mergeConfig(global: Partial<BriefConfig>, project: Partial<BriefConfig>): BriefConfig {
  const base = baseConfig();
  const profile = project.profile ?? global.profile ?? base.profile;
  const targets = {
    ...base.targets,
    ...(global.targets ?? {}),
    ...(project.targets ?? {}),
  };
  return {
    version: project.version ?? global.version ?? base.version,
    variant: project.variant ?? global.variant ?? base.variant,
    composition: project.composition ?? global.composition ?? base.composition,
    profile,
    stacks: project.stacks !== undefined ? project.stacks ?? null : global.stacks ?? null,
    packageManager: project.packageManager ?? global.packageManager,
    framework: project.framework ?? global.framework,
    targets,
    budgetFull: project.budgetFull ?? global.budgetFull ?? base.budgetFull,
    budgetShort: project.budgetShort ?? global.budgetShort ?? base.budgetShort,
    charsPerToken: project.charsPerToken ?? global.charsPerToken ?? base.charsPerToken,
    budgetByTarget: { ...global.budgetByTarget, ...project.budgetByTarget },
    remote: global.remote,
  };
}

export function applyProfile(config: BriefConfig, override: Profile | undefined): BriefConfig {
  if (override === "native") {
    const targets = { ...config.targets };
    for (const id of TARGET_IDS) targets[id] = true;
    return { ...config, profile: "native", targets };
  }
  if (override === "lean" || config.profile === "lean") {
    const targets = { ...config.targets };
    for (const id of LEAN_OFF) targets[id] = false;
    return { ...config, profile: "lean", targets };
  }
  return config;
}

export function budgetFor(config: BriefConfig, target: TargetId, variant: Variant): number {
  const override = config.budgetByTarget[target];
  if (variant === "short") return override?.short ?? config.budgetShort;
  return override?.full ?? config.budgetFull;
}

export function globalConfigPath(briefHome: string): string {
  return path.join(briefHome, "brief.toml");
}

export function projectConfigPath(cwd: string): string {
  return path.join(cwd, ".brief", "brief.toml");
}

function stringList(value: TomlValue | undefined): string[] {
  if (Array.isArray(value)) return value.filter((item) => item.trim());
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function isTable(value: TomlValue | undefined): value is Toml {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
