import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { Diagnostic, McpServer } from "../core/types.js";
import { isJsonObject, pointerToken } from "../model/json.js";
import { agentMarkdown, hashJson, hashText } from "./shared.js";
import { scrubServer } from "./secrets.js";
import type { FoundItem, ScanContext, ScanResult } from "./types.js";

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r\n|\r|\n/).length;
}

function parseDocument(
  text: string,
  file: string,
  code: string,
  diagnostics: Diagnostic[],
  jsonc: boolean,
): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(
    text,
    errors,
    jsonc ? { allowTrailingComma: true } : { disallowComments: true },
  );
  for (const error of errors) {
    diagnostics.push({
      severity: "error",
      code,
      message: printParseErrorCode(error.error),
      file,
      line: lineAt(text, error.offset),
    });
  }
  return errors.length === 0 ? value : undefined;
}

function missingFile(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function readUnmanaged(
  path: string,
  ctx: ScanContext,
  diagnostics: Diagnostic[],
): Promise<string | undefined> {
  if (ctx.managed(path)) return undefined;
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (missingFile(error)) return undefined;
    diagnostics.push({
      severity: "error",
      code: "import.read",
      message: error instanceof Error ? error.message : "Unable to read file.",
      file: path,
    });
    return undefined;
  }
}

function stringRecord(value: unknown): boolean {
  return isJsonObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isMcpServer(value: unknown): value is McpServer {
  if (!isJsonObject(value)) return false;
  if (value["command"] !== undefined && typeof value["command"] !== "string") return false;
  if (value["url"] !== undefined && typeof value["url"] !== "string") return false;
  if (
    value["args"] !== undefined &&
    (!Array.isArray(value["args"]) || !value["args"].every((entry) => typeof entry === "string"))
  )
    return false;
  if (value["env"] !== undefined && !stringRecord(value["env"])) return false;
  if (value["headers"] !== undefined && !stringRecord(value["headers"])) return false;
  return true;
}

function scanMcp(text: string, file: string, diagnostics: Diagnostic[], items: FoundItem[]): void {
  const value = parseDocument(text, file, "import.mcp", diagnostics, false);
  if (!isJsonObject(value)) {
    if (value !== undefined) {
      diagnostics.push({
        severity: "error",
        code: "import.mcp",
        message: "Expected an object containing mcpServers.",
        file,
      });
    }
    return;
  }
  const servers = value["mcpServers"];
  if (!isJsonObject(servers)) {
    diagnostics.push({
      severity: "error",
      code: "import.mcp",
      message: "Expected mcpServers to be an object.",
      file,
      jsonPath: "/mcpServers",
    });
    return;
  }
  for (const [name, candidate] of Object.entries(servers)) {
    if (!isMcpServer(candidate)) {
      diagnostics.push({
        severity: "warn",
        code: "import.mcp",
        message: `Skipping MCP server ${name} with an unsupported shape.`,
        file,
        jsonPath: `/mcpServers/${pointerToken(name)}`,
      });
      continue;
    }
    const { server, secrets } = scrubServer(candidate);
    items.push({
      kind: "mcp",
      name,
      source: "omo",
      path: file,
      server,
      secrets,
      hash: hashJson(server),
    });
  }
}

function scanAgents(
  text: string,
  file: string,
  diagnostics: Diagnostic[],
  items: FoundItem[],
): void {
  const value = parseDocument(text, file, "import.agent", diagnostics, true);
  if (value === undefined) return;
  if (!isJsonObject(value)) {
    diagnostics.push({
      severity: "warn",
      code: "import.agent",
      message: "Skipping Omo agents with an unsupported configuration shape.",
      file,
    });
    return;
  }
  const native = value["[native]"];
  if (native === undefined) return;
  if (!isJsonObject(native)) {
    diagnostics.push({
      severity: "warn",
      code: "import.agent",
      message: "Skipping Omo agents because [native] is not an object.",
      file,
      jsonPath: "/[native]",
    });
    return;
  }
  const agents = native["agents"];
  if (agents === undefined) return;
  if (!isJsonObject(agents)) {
    diagnostics.push({
      severity: "warn",
      code: "import.agent",
      message: "Skipping Omo agents because [native].agents is not an object.",
      file,
      jsonPath: "/[native]/agents",
    });
    return;
  }
  for (const [name, candidate] of Object.entries(agents)) {
    if (
      !isJsonObject(candidate) ||
      typeof candidate["description"] !== "string" ||
      candidate["description"].trim().length === 0 ||
      typeof candidate["prompt"] !== "string"
    ) {
      diagnostics.push({
        severity: "warn",
        code: "import.agent",
        message: `Skipping agent ${name}; expected string description and prompt fields.`,
        file,
        jsonPath: `/[native]/agents/${pointerToken(name)}`,
      });
      continue;
    }
    const markdown = agentMarkdown({
      name,
      description: candidate["description"],
      body: candidate["prompt"],
    });
    const dropped = Object.keys(candidate)
      .filter((key) => key !== "description" && key !== "prompt")
      .sort();
    items.push({
      kind: "agent",
      name,
      source: "omo",
      path: file,
      markdown,
      hash: hashText(markdown),
      ...(dropped.length === 0 ? {} : { dropped }),
    });
  }
}

export async function scanOmo(
  home: string,
  agentDir: string,
  ctx: ScanContext,
): Promise<ScanResult> {
  const items: FoundItem[] = [];
  const diagnostics: Diagnostic[] = [];

  const instructionsPath = join(agentDir, "AGENTS.md");
  const instructions = await readUnmanaged(instructionsPath, ctx, diagnostics);
  if (instructions !== undefined) {
    items.push({
      kind: "instructions",
      name: "instructions",
      source: "omo",
      path: instructionsPath,
      content: instructions,
      hash: hashText(instructions),
    });
  }

  const mcpPath = join(agentDir, "mcp.json");
  const mcp = await readUnmanaged(mcpPath, ctx, diagnostics);
  if (mcp !== undefined) scanMcp(mcp, mcpPath, diagnostics, items);

  const agentsPath = join(home, "omo.jsonc");
  const agents = await readUnmanaged(agentsPath, ctx, diagnostics);
  if (agents !== undefined) scanAgents(agents, agentsPath, diagnostics, items);

  return { items, diagnostics };
}
