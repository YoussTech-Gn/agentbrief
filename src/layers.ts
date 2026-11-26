import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { loadConfigFile, mergeConfig } from "./config.js";
import { parseFrontMatter } from "./frontmatter.js";
import type { BriefConfig, SourceDoc } from "./types.js";
import { asBool, guardRoot, readText, toPosix } from "./util.js";

export interface LayerSet {
  config: BriefConfig;
  globalStacks: string[] | null;
  projectStacks: string[] | null;
  personal: SourceDoc[];
  stacks: SourceDoc[];
  project: SourceDoc[];
  hasGlobal: boolean;
  hasProject: boolean;
}

export async function loadLayers(cwd: string, briefHome: string): Promise<LayerSet> {
  guardRoot(cwd);
  const globalLoaded = await loadConfigFile(path.join(briefHome, "brief.toml"));
  const projectLoaded = await loadConfigFile(path.join(cwd, ".brief", "brief.toml"));
  const { stacksSpecified: globalSpecified, ...globalPartial } = globalLoaded;
  const { stacksSpecified: projectSpecified, ...projectPartial } = projectLoaded;
  if (!globalSpecified) delete globalPartial.stacks;
  if (!projectSpecified) delete projectPartial.stacks;
  const config = mergeConfig(globalPartial, projectPartial);
  const hasGlobal = (await stat(briefHome).catch(() => null))?.isDirectory() ?? false;
  const hasProject = (await stat(path.join(cwd, ".brief")).catch(() => null))?.isDirectory() ?? false;
  const personal = hasGlobal ? await readDocs(briefHome, "personal", { skip: new Set(["stacks"]) }) : [];
  const stacks = hasGlobal ? await readDocs(path.join(briefHome, "stacks"), "stack") : [];
  const project = hasProject ? await readDocs(path.join(cwd, ".brief"), "project", { skip: new Set(["inbox", "backups"]) }) : [];
  return {
    config,
    globalStacks: globalSpecified ? globalLoaded.stacks ?? [] : null,
    projectStacks: projectSpecified ? projectLoaded.stacks ?? [] : null,
    personal,
    stacks,
    project,
    hasGlobal,
    hasProject,
  };
}

export function stackById(stacks: SourceDoc[], id: string): SourceDoc | undefined {
  return stacks.find((doc) => doc.stackId === id);
}

async function readDocs(
  dir: string,
  layer: SourceDoc["layer"],
  options: { skip?: Set<string> } = {},
): Promise<SourceDoc[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const docs: SourceDoc[] = [];
  for (const name of names) {
    if (options.skip?.has(name)) continue;
    if (!name.endsWith(".md")) continue;
    if (name.toLowerCase() === "readme.md") continue;
    const absPath = path.join(dir, name);
    const info = await stat(absPath).catch(() => null);
    if (!info?.isFile()) continue;
    const text = await readText(absPath);
    if (text === null) continue;
    let parsed: ReturnType<typeof parseFrontMatter>;
    try {
      parsed = parseFrontMatter(text);
    } catch (error) {
      throw new Error(`${absPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const title = titleOf(parsed.data["title"], parsed.body, name);
    const order = typeof parsed.data["order"] === "number" ? parsed.data["order"] : 100;
    const stackId = layer === "stack" ? name.replace(/\.md$/, "") : undefined;
    docs.push({
      absPath,
      relPath: toPosix(name),
      layer,
      stackId,
      title,
      order,
      body: parsed.body,
      data: parsed.data,
    });
  }
  docs.sort((a, b) => a.order - b.order || a.relPath.localeCompare(b.relPath));
  return docs;
}

function titleOf(raw: unknown, body: string, filename: string): string {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  const heading = /^#\s+(.+)$/m.exec(body);
  if (heading?.[1]) return heading[1].trim();
  return filename.replace(/\.md$/, "").replace(/[-_]/g, " ");
}

export function isGlobalStack(doc: SourceDoc): boolean {
  return asBool(doc.data["global"]) === true;
}
