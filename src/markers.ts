import { sha256, normalize } from "./util.js";
import type { Composition, TargetId, Variant } from "./types.js";

export const END_MARK = "<!-- brief:end -->";
const BEGIN_RE = /<!-- brief:generated\b([^>]*)-->/;

export interface Region {
  preamble: string;
  inner: string;
  postamble: string;
  attrs: Record<string, string>;
}

export function hashInner(inner: string): string {
  return sha256(normalize(inner));
}

export function renderBlock(input: {
  target: TargetId;
  variant: Variant;
  composition: Composition;
  inner: string;
}): string {
  const inner = normalize(input.inner);
  const hash = hashInner(inner);
  return `<!-- brief:generated target=${input.target} variant=${input.variant} composition=${input.composition} hash=${hash} -->\n${inner}\n${END_MARK}\n`;
}

export function parseRegion(text: string): Region | null {
  const normalized = text.replace(/\r\n/g, "\n");
  const match = BEGIN_RE.exec(normalized);
  if (!match) return null;
  const start = match.index;
  const after = start + match[0].length;
  const end = normalized.indexOf(END_MARK, after);
  if (end < 0) return null;
  let inner = normalized.slice(after, end);
  if (inner.startsWith("\n")) inner = inner.slice(1);
  if (inner.endsWith("\n")) inner = inner.slice(0, -1);
  let post = normalized.slice(end + END_MARK.length);
  if (post.startsWith("\n")) post = post.slice(1);
  if (post.startsWith("\n")) post = post.slice(1);
  return {
    preamble: normalized.slice(0, start),
    inner,
    postamble: post,
    attrs: parseAttrs(match[1] ?? ""),
  };
}

export function assemble(preamble: string, block: string, postamble: string): string {
  let out = "";
  if (preamble) out += preamble.endsWith("\n") ? preamble : `${preamble}\n`;
  out += block.endsWith("\n") ? block : `${block}\n`;
  if (postamble.trim()) {
    const body = postamble.replace(/^\n+/, "");
    out += `\n${body.endsWith("\n") ? body : `${body}\n`}`;
  }
  return out;
}

export const PRESERVED_NOTE =
  "<!-- brief:preserved\nHand-written content below was kept. brief will not overwrite it.\n-->\n";

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z0-9_-]+)=([^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs[match[1] ?? ""] = match[2] ?? "";
  }
  return attrs;
}
