import readline from "node:readline";
import { checkBrief } from "./check.js";
import { planCompilation } from "./compile.js";
import { loadLayers } from "./layers.js";
import { listPending, proposeChange } from "./proposals.js";
import { applyVariant } from "./render.js";
import { rulesForPath, scopedGlobs } from "./scoped.js";
import type { CompileOptions, LayerName, Scope, Variant } from "./types.js";

export interface McpContext extends CompileOptions {
  version: string;
}

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

const TOOLS = [
  {
    name: "get_brief",
    description:
      "Return the compiled builder brief (personal methodology, stacks, and project instructions).",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["project", "global"], default: "project" },
        variant: { type: "string", enum: ["full", "short"], default: "full" },
      },
    },
  },
  {
    name: "get_rules_for_path",
    description:
      "Return path-scoped rules (declared with applies_to/globs in .brief/*.md) that match a specific repository file path.",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: {
        path: { type: "string", description: "Repository-relative file path, e.g. src/api/users.ts" },
        variant: { type: "string", enum: ["full", "short"], default: "full" },
      },
    },
  },
  {
    name: "propose_rule",
    description:
      "Submit a suggested rule or preference into the agentbrief inbox without directly editing source files.",
    inputSchema: {
      type: "object",
      required: ["title", "body"],
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        layer: { type: "string", enum: ["personal", "stack", "project"], default: "project" },
        file: { type: "string", description: "Target markdown file inside the layer (e.g. preferences.md or project.md)." },
        action: { type: "string", enum: ["append", "prepend"], default: "append" },
      },
    },
  },
  {
    name: "list_proposals",
    description: "List pending proposals waiting for human review in the agentbrief inbox.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "check_brief",
    description:
      "Run agentbrief drift, budget, and project fact checks and return structured findings.",
    inputSchema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["project", "global"] },
        strict: { type: "boolean", default: false },
      },
    },
  },
];

/** Handle a single JSON-RPC 2.0 MCP request. Returns null for notifications. */
export async function handleMcpRequest(
  req: JsonRpcRequest,
  ctx: McpContext,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  if (req.method === "notifications/initialized" || req.method === "notifications/cancelled") {
    return null;
  }

  try {
    if (req.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "agentbrief", version: ctx.version },
        },
      };
    }

    if (req.method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (req.method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    }

    if (req.method === "tools/call") {
      const name = typeof req.params?.["name"] === "string" ? req.params["name"] : "";
      const args = isRecord(req.params?.["arguments"]) ? req.params["arguments"] : {};
      const output = await callTool(name, args, ctx);
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: output }],
        },
      };
    }

    if (isNotification) return null;
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    };
  } catch (error) {
    if (isNotification) return null;
    const message = error instanceof Error ? error.message : String(error);
    if (req.method === "tools/call") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        },
      };
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message },
    };
  }
}

/** Start the MCP server on stdin/stdout using newline-delimited JSON-RPC 2.0. */
export async function serveMcp(ctx: McpContext): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let req: JsonRpcRequest;
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      const err: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      };
      process.stdout.write(`${JSON.stringify(err)}\n`);
      continue;
    }
    const res = await handleMcpRequest(req, ctx);
    if (res) {
      process.stdout.write(`${JSON.stringify(res)}\n`);
    }
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<string> {
  switch (name) {
    case "get_brief": {
      const scope: Scope = args["scope"] === "global" ? "global" : "project";
      const variant: Variant | undefined =
        args["variant"] === "short" ? "short" : args["variant"] === "full" ? "full" : undefined;
      const planned = await planCompilation({ ...ctx, scopes: [scope], variant });
      const chosen =
        planned.plans.find((p) => p.scope === scope && p.target === "agents") ??
        planned.plans.find((p) => p.scope === scope);
      if (!chosen) return "No brief found for the requested scope.";
      return chosen.inner;
    }
    case "get_rules_for_path": {
      const filePath = typeof args["path"] === "string" ? args["path"].trim() : "";
      if (!filePath) throw new Error("`path` is required.");
      const variant: Variant = args["variant"] === "short" ? "short" : "full";
      const layers = await loadLayers(ctx.cwd, ctx.briefHome);
      const matched = rulesForPath(layers.project, filePath);
      if (matched.length === 0) {
        return `No path-scoped rules matched "${filePath}".`;
      }
      return matched
        .map((doc) => {
          const globs = scopedGlobs(doc).join(", ");
          const body = applyVariant(doc.body, variant);
          return `## ${doc.title} (${globs})\n\n${body}`;
        })
        .join("\n\n---\n\n");
    }
    case "propose_rule": {
      const title = typeof args["title"] === "string" ? args["title"] : "";
      const body = typeof args["body"] === "string" ? args["body"] : "";
      const layer: LayerName =
        args["layer"] === "personal" || args["layer"] === "stack" || args["layer"] === "project"
          ? args["layer"]
          : "project";
      const given = typeof args["file"] === "string" ? args["file"].trim() : "";
      if (!given && layer === "stack") {
        throw new Error("A stack proposal needs `file`, the stack id (for example typescript).");
      }
      const file = given || (layer === "project" ? "project.md" : "preferences.md");
      const action = args["action"] === "prepend" ? "prepend" : "append";
      const proposal = await proposeChange({
        cwd: ctx.cwd,
        briefHome: ctx.briefHome,
        title,
        body,
        layer,
        file,
        action,
        source: "mcp",
      });
      return JSON.stringify(
        {
          status: "pending",
          id: proposal.id,
          layer: proposal.layer,
          file: proposal.file,
          message: "Recorded in inbox. A human must accept it with `agentbrief review`.",
        },
        null,
        2,
      );
    }
    case "list_proposals": {
      const pending = await listPending(ctx.cwd, ctx.briefHome);
      return JSON.stringify(
        pending.map((p) => ({
          id: p.id,
          title: p.title,
          layer: p.layer,
          file: p.file,
          source: p.source,
          created: p.created,
        })),
        null,
        2,
      );
    }
    case "check_brief": {
      const scopes: Scope[] | undefined =
        args["scope"] === "global" ? ["global"] : args["scope"] === "project" ? ["project"] : undefined;
      const strict = Boolean(args["strict"]);
      const report = await checkBrief({ ...ctx, scopes, strict });
      return JSON.stringify(report, null, 2);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
