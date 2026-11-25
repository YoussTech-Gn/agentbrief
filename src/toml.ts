/**
 * A small TOML reader for the subset brief writes and expects:
 * comments, strings, booleans, integers, string arrays, and nested tables.
 */

export interface Toml {
  [key: string]: TomlValue;
}
export type TomlValue = string | number | boolean | string[] | Toml;

export function parseToml(input: string): Toml {
  const root: Toml = {};
  let current: Toml = root;
  for (const rawLine of input.replace(/\r\n/g, "\n").split("\n")) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    const table = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (table) {
      current = ensureTable(root, table[1] ?? "");
      continue;
    }
    const field = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!field) continue;
    current[field[1] ?? ""] = parseValue(field[2] ?? "");
  }
  return root;
}

function ensureTable(root: Toml, dotted: string): Toml {
  let cursor = root;
  for (const part of dotted.split(".")) {
    const existing = cursor[part];
    if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
      const next: Toml = {};
      cursor[part] = next;
      cursor = next;
    } else {
      cursor = existing;
    }
  }
  return cursor;
}

function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === "#" && !quoted) return line.slice(0, i);
  }
  return line;
}

function parseValue(raw: string): TomlValue {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith("[")) return parseArray(value);
  if (value.startsWith('"')) return unquote(value);
  return value;
}

function parseArray(raw: string): string[] {
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "");
  if (!inner.trim()) return [];
  const items: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(inner))) {
    items.push(unescape(match[1] ?? ""));
  }
  if (items.length === 0) {
    return inner
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return items;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return unescape(trimmed.slice(1, -1));
  }
  return trimmed;
}

function unescape(value: string): string {
  return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function tomlGet(root: Toml, dotted: string): TomlValue | undefined {
  let cursor: TomlValue | undefined = root;
  for (const part of dotted.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}
