import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { parseFrontMatter, stringifyDocument } from "./frontmatter.js";
import type { LayerName, Proposal } from "./types.js";
import { assertUnlinked, readText, resolveInside, slug, stamp, writeText } from "./util.js";

export interface ProposeInput {
  cwd: string;
  briefHome: string;
  title: string;
  body: string;
  layer: LayerName;
  file: string;
  action: "append" | "prepend";
  source: string;
}

export async function proposeChange(input: ProposeInput): Promise<Proposal> {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) throw new Error("A proposal needs a --title.");
  if (!body) throw new Error("A proposal needs a --body, --body-file, or text on stdin.");
  const proposal: Proposal = {
    id: `${stamp()}-${slug(title)}`,
    title,
    status: "pending",
    layer: input.layer,
    file: normalizeFile(input.layer, input.file),
    action: input.action,
    created: new Date().toISOString(),
    source: input.source || "cli",
    body,
    absPath: "",
  };
  // Touch the destination now so a bad path fails before we write the inbox.
  await assertUnlinked(targetPath(input.cwd, input.briefHome, proposal));
  const inbox = inboxDir(input.cwd, input.briefHome, proposal.layer);
  proposal.absPath = path.join(inbox, `${proposal.id}.md`);
  await writeText(proposal.absPath, serialize(proposal));
  return proposal;
}

export async function listPending(cwd: string, briefHome: string): Promise<Proposal[]> {
  const dirs = [path.join(briefHome, "inbox"), path.join(cwd, ".brief", "inbox")];
  const found: Proposal[] = [];
  for (const dir of dirs) found.push(...(await readPending(dir)));
  found.sort((a, b) => a.created.localeCompare(b.created));
  return found;
}

export async function acceptProposal(cwd: string, briefHome: string, id: string): Promise<Proposal> {
  const proposal = await requirePending(cwd, briefHome, id);
  const target = targetPath(cwd, briefHome, proposal);
  const marker = `<!-- proposal:${proposal.id}`;
  const existing = (await readText(target)) ?? defaultTarget(proposal.file);
  if (!existing.includes(marker)) {
    const section = [
      "",
      `## Learned: ${proposal.title}`,
      "",
      `<!-- proposal:${proposal.id} accepted:${new Date().toISOString()} -->`,
      "",
      proposal.body.trim(),
      "",
    ].join("\n");
    const next = proposal.action === "prepend" ? prepend(existing, section) : `${existing.replace(/\s*$/, "\n")}${section}`;
    await writeText(target, next.endsWith("\n") ? next : `${next}\n`);
  }
  return moveProposal(proposal, "accepted");
}

export async function rejectProposal(cwd: string, briefHome: string, id: string, reason?: string): Promise<Proposal> {
  const proposal = await requirePending(cwd, briefHome, id);
  proposal.reason = reason?.trim() || "rejected";
  return moveProposal(proposal, "rejected");
}

async function requirePending(cwd: string, briefHome: string, id: string): Promise<Proposal> {
  const pending = await listPending(cwd, briefHome);
  const found = pending.find((item) => item.id === id);
  if (!found) throw new Error(`No pending proposal with id ${id}.`);
  return found;
}

async function moveProposal(proposal: Proposal, status: "accepted" | "rejected"): Promise<Proposal> {
  const next: Proposal = { ...proposal, status, resolved: new Date().toISOString() };
  const destDir = path.join(path.dirname(proposal.absPath), status);
  const dest = path.join(destDir, path.basename(proposal.absPath));
  await writeText(dest, serialize(next));
  await unlink(proposal.absPath);
  next.absPath = dest;
  return next;
}

async function readPending(dir: string): Promise<Proposal[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const proposals: Proposal[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const absPath = path.join(dir, name);
    const info = await stat(absPath).catch(() => null);
    if (!info?.isFile()) continue;
    const text = await readText(absPath);
    if (!text) continue;
    const parsed = parseFrontMatter(text);
    const status = parsed.data["status"];
    if (status === "accepted" || status === "rejected") continue;
    const id = typeof parsed.data["id"] === "string" ? parsed.data["id"] : name.replace(/\.md$/, "");
    proposals.push({
      id,
      title: typeof parsed.data["title"] === "string" ? parsed.data["title"] : id,
      status: "pending",
      layer: layerOf(parsed.data["layer"]),
      file: typeof parsed.data["file"] === "string" ? parsed.data["file"] : "preferences.md",
      action: parsed.data["action"] === "prepend" ? "prepend" : "append",
      created: typeof parsed.data["created"] === "string" ? parsed.data["created"] : "",
      source: typeof parsed.data["source"] === "string" ? parsed.data["source"] : "cli",
      body: parsed.body.trim(),
      absPath,
    });
  }
  return proposals;
}

function serialize(proposal: Proposal): string {
  const data: Record<string, string> = {
    id: proposal.id,
    title: proposal.title,
    status: proposal.status,
    layer: proposal.layer,
    file: proposal.file,
    action: proposal.action,
    created: proposal.created,
    source: proposal.source,
  };
  if (proposal.reason) data["reason"] = proposal.reason;
  if (proposal.resolved) data["resolved"] = proposal.resolved;
  return stringifyDocument(data, proposal.body);
}

function prepend(existing: string, section: string): string {
  const parsed = parseFrontMatter(existing);
  if (existing.startsWith("---\n")) {
    return stringifyDocument(parsed.data, `${section.trim()}\n\n${parsed.body.trim()}\n`);
  }
  return `${section}${existing.startsWith("\n") ? "" : "\n"}${existing}`;
}

function defaultTarget(file: string): string {
  const title = path.basename(file, ".md").replace(/[-_]/g, " ");
  return `---\ntitle: ${title}\n---\n\n# ${title}\n`;
}

function inboxDir(cwd: string, briefHome: string, layer: LayerName): string {
  return layer === "project" ? path.join(cwd, ".brief", "inbox") : path.join(briefHome, "inbox");
}

function targetPath(cwd: string, briefHome: string, proposal: Proposal): string {
  const rel = normalizeFile(proposal.layer, proposal.file);
  if (proposal.layer === "project") return resolveInside(path.join(cwd, ".brief"), rel);
  return resolveInside(briefHome, rel);
}

function normalizeFile(layer: LayerName, file: string): string {
  const cleaned = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!cleaned || cleaned === "." || cleaned.split("/").includes("..")) {
    throw new Error(`Refusing proposal path ${file}.`);
  }
  if (cleaned.startsWith("inbox/") || cleaned.startsWith("backups/") || cleaned === "brief.toml") {
    throw new Error(`Proposals cannot target ${cleaned}.`);
  }
  if (layer === "stack") {
    if (cleaned.startsWith("stacks/")) return cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
    const base = cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
    return `stacks/${base}`;
  }
  return cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
}

function layerOf(value: unknown): LayerName {
  if (value === "personal" || value === "stack" || value === "project") return value;
  return "personal";
}
