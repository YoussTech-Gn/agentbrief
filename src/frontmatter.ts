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
    const lineNo = i + 2; // line 1 is the opening ---
    if (!line.trim() || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):(?:\s+(.*))?$/.exec(line);
    if (!match) {
      throw new Error(`Unsupported front matter on line ${lineNo}: "${line.trim()}". Use key: value, or a key followed by "  - item" lines.`);
    }
    const key = match[1] ?? "";
    const rest = stripComment((match[2] ?? "").trim());
    if (/^[|>][+-]?$/.test(rest)) {
      throw new Error(`Unsupported front matter on line ${lineNo}: "${key}" uses a YAML block scalar (| or >). Put long text in the body instead.`);
    }
    if (rest === "") {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length) {
        const next = lines[j] ?? "";
        if (!next.trim()) {
          j += 1;
          continue;
        }
        const item = /^\s*-\s+(.*)$/.exec(next);
        if (item) {
          items.push(unquote(stripComment((item[1] ?? "").trim())));
          j += 1;
          continue;
        }
        if (/^\s/.test(next)) {
          throw new Error(`Unsupported front matter on line ${j + 2}: nested values under "${key}" are not supported.`);
        }
        break;
      }
      data[key] = items.length > 0 ? items : "";
      i = j;
      continue;
    }
    data[key] = parseScalar(rest, lineNo);
    i += 1;
  }
  return data;
}

function parseScalar(value: string, lineNo: number): FmValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw new Error(`Unsupported front matter on line ${lineNo}: a [list] must close on the same line.`);
    return splitFlow(value.slice(1, -1), lineNo);
  }
  if (value.startsWith("{")) {
    throw new Error(`Unsupported front matter on line ${lineNo}: {maps} are not supported.`);
  }
  return unquote(value);
}

/** Split `"a", 'b', c` on commas that are not inside quotes. */
function splitFlow(inner: string, lineNo: number): string[] {
  const items: string[] = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i] ?? "";
    if (quote) {
      current += ch;
      if (ch === "\\" && quote === '"') {
        current += inner[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = "";
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else if (ch === "[" || ch === "{") {
      throw new Error(`Unsupported front matter on line ${lineNo}: nested lists are not supported.`);
    } else {
      current += ch;
    }
  }
  if (quote) throw new Error(`Unsupported front matter on line ${lineNo}: unclosed quote.`);
  items.push(current);
  return items.map((item) => unquote(item.trim())).filter((item) => item !== "");
}

/** Drop a trailing ` # comment` that is not inside quotes. */
function stripComment(value: string): string {
  let quote = "";
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (quote) {
      if (ch === "\\" && quote === '"') i += 1;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "#" && (i === 0 || /\s/.test(value[i - 1] ?? ""))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value;
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
