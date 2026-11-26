/**
 * A small TOML reader for the subset brief writes and expects: comments,
 * basic strings, booleans, integers, floats, string arrays (on one line or
 * several), and [tables]. Anything else is refused with its line number,
 * because a config value that is silently misread is worse than an error.
 */

export interface Toml {
  [key: string]: TomlValue;
}
export type TomlValue = string | number | boolean | string[] | Toml;

export function parseToml(input: string): Toml {
  const root: Toml = {};
  let current: Toml = root;
  const lines = input.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const line = stripComment(lines[i] ?? "").trim();
    if (!line) continue;
    const table = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (table) {
      current = ensureTable(root, table[1] ?? "");
      continue;
    }
    const field = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!field) fail(lineNo, `expected key = value or [table], got "${line}"`);
    let raw = field[2] ?? "";
    // A multi-line array: keep reading until its brackets balance.
    if (raw.startsWith("[")) {
      const start = lineNo;
      while (!arrayClosed(raw)) {
        i += 1;
        if (i >= lines.length) fail(start, "unclosed array");
        raw += ` ${stripComment(lines[i] ?? "").trim()}`;
      }
    }
    current[field[1] ?? ""] = parseValue(raw, lineNo);
  }
  return root;
}

function fail(lineNo: number, message: string): never {
  throw new Error(`TOML line ${lineNo}: ${message}.`);
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

/** Cut a # comment that is outside a string. Escaped quotes stay inside. */
function stripComment(line: string): string {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted && ch === "\\") i += 1;
    else if (ch === '"') quoted = !quoted;
    else if (ch === "#" && !quoted) return line.slice(0, i);
  }
  return line;
}

function arrayClosed(raw: string): boolean {
  let quoted = false;
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quoted && ch === "\\") i += 1;
    else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "[") depth += 1;
    else if (!quoted && ch === "]") depth -= 1;
  }
  return depth <= 0;
}

function parseValue(raw: string, lineNo: number): TomlValue {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^[+-]?\d+$/.test(value)) return Number(value);
  if (/^[+-]?\d+\.\d+$/.test(value)) return Number(value);
  if (value.startsWith("[")) return parseArray(value, lineNo);
  if (/^"(?:\\.|[^"\\])*"$/.test(value)) return unescape(value.slice(1, -1));
  return fail(lineNo, `unsupported value ${value}; strings need double quotes`);
}

function parseArray(raw: string, lineNo: number): string[] {
  const inner = raw.replace(/^\[/, "").replace(/\]$/, "").trim();
  const items: string[] = [];
  const re = /\s*"((?:\\.|[^"\\])*)"\s*(,|$)/y;
  let index = 0;
  while (index < inner.length) {
    re.lastIndex = index;
    const match = re.exec(inner);
    if (!match) return fail(lineNo, "arrays may only hold double-quoted strings");
    items.push(unescape(match[1] ?? ""));
    index = re.lastIndex;
  }
  return items;
}

/** One pass, so `\\n` stays a backslash followed by n. */
function unescape(value: string): string {
  return value.replace(/\\(["\\nt])/g, (_all, ch: string) => (ch === "n" ? "\n" : ch === "t" ? "\t" : ch));
}

export function tomlGet(root: Toml, dotted: string): TomlValue | undefined {
  let cursor: TomlValue | undefined = root;
  for (const part of dotted.split(".")) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return undefined;
    cursor = cursor[part];
  }
  return cursor;
}
