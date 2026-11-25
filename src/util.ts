import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

export function sha256(text: string): string {
  return createHash("sha256").update(normalize(text), "utf8").digest("hex");
}

export function estimateTokens(text: string, charsPerToken: number): number {
  const divisor = charsPerToken > 0 ? charsPerToken : 4;
  return Math.max(1, Math.ceil(text.length / divisor));
}

/** Refuse linked files and directories before managed filesystem operations. */
export async function assertUnlinked(file: string): Promise<void> {
  const absolute = path.resolve(file);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`Refusing symbolic link: ${current}`);
      }
    } catch (error) {
      if (isEnoent(error)) return;
      throw error;
    }
  }
}

export async function readText(file: string): Promise<string | null> {
  await assertUnlinked(file);
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (isEnoent(error)) return null;
    throw error;
  }
}

export async function writeText(file: string, contents: string): Promise<void> {
  await assertUnlinked(file);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, contents, { encoding: "utf8", flag: "wx" });
  try {
    await rename(tmp, file);
  } finally {
    await unlink(tmp).catch((error: unknown) => { if (!isEnoent(error)) throw error; });
  }
}

export function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ENOENT"
  );
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function slug(input: string, max = 42): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "note";
}

export function stamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Reject paths that escape `root`. Returns an absolute path. */
export function resolveInside(root: string, rel: string): string {
  const cleaned = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (cleaned.split("/").includes("..") || path.isAbsolute(rel)) {
    throw new Error(`Path escapes its layer: ${rel}`);
  }
  const abs = path.resolve(root, cleaned);
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error(`Path escapes its layer: ${rel}`);
  }
  return abs;
}

export function displayPath(file: string, userHome: string, cwd: string): string {
  const abs = path.resolve(file);
  const home = path.resolve(userHome);
  if (abs === home || abs.startsWith(home + path.sep)) {
    return toPosix(path.join("~", path.relative(home, abs)));
  }
  const project = path.resolve(cwd);
  if (abs === project || abs.startsWith(project + path.sep)) {
    return toPosix(path.relative(project, abs));
  }
  return toPosix(abs);
}

export function expandHome(p: string, userHome: string): string {
  if (p === "~") return userHome;
  if (p.startsWith("~/")) return path.join(userHome, p.slice(2));
  return p;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

export function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

export function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export function linesOf(text: string): number {
  if (!text) return 0;
  return text.split("\n").length;
}
