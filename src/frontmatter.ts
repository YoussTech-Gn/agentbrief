import type { FmValue, FrontMatter } from "./types.js";

export interface ParsedDoc {
  data: FrontMatter;
  body: string;
}

/**
 * Parse a leading YAML-ish front matter block. Supports scalars, quoted
 * strings, booleans, numbers, and lists of strings. Nested maps are rejected
 * by being left as a raw string, which callers ignore.
 */
export function parseFrontMatter(input: string): ParsedDoc {
  const text = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!text.startsWith("---\n") && text !== "---") {
    return { data: {}, body: text };
  }
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(4, end);
  const after = text.slice(end + 4).replace(/^\n/, "");
  return { data: parseBlock(raw), body: after };
}

export function stringifyDocument(data: FrontMatter, body: string): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(data)) {
    lines.push(formatField(key, value));
  }
  lines.push("---", "");
  const trimmed = body.replace(/^\n+/, "").replace(/\s+$/, "");
  return `${lines.join("\n")}\n${trimmed}\n`;
}

function formatField(key: string, value: FmValue): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return `${key}: []`;
    return `${key}:\n${value.map((item) => `  - ${quoteIfNeeded(item)}`).join("\n")}`;
  }
  if (typeof value === "string") return `${key}: ${quoteIfNeeded(value)}`;
  return `${key}: ${value}`;
}

function quoteIfNeeded(value: string): string {
  if (value === "" || /[:#{}[\],&*!|>%@`]|^\s|\s$/.test(value) || /^(true|false|null)$/i.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function parseBlock(raw: string): FrontMatter {
  const data: FrontMatter = {};
  const lines = raw.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) {
      i += 1;
      continue;
    }
    const key = match[1] ?? "";
    const rest = (match[2] ?? "").trim();
    if (rest === "" || rest === "|" || rest === ">") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? "";
        const item = /^\s*-\s+(.*)$/.exec(next);
        if (!item) break;
        items.push(unquote((item[1] ?? "").trim()));
        j += 1;
      }
      if (items.length > 0) {
        data[key] = items;
        i = j;
        continue;
      }
      data[key] = "";
      i += 1;
      continue;
    }
    if (rest === "[]") {
      data[key] = [];
      i += 1;
      continue;
    }
    data[key] = parseScalar(rest);
    i += 1;
  }
  return data;
}

function parseScalar(raw: string): FmValue {
  const value = raw.replace(/\s+#.*$/, "").trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return unquote(value);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    if (value.startsWith('"')) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === "string") return parsed;
      } catch {
        /* fall through */
      }
    }
    return value.slice(1, -1);
  }
  return value;
}
