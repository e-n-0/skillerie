import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { Diagnostic, JsonObject, JsonValue, McpServer } from "../core/types.js";
import { isJsonObject, pointerToken } from "../model/json.js";
import { agentMarkdown, failureReason, hashJson, hashText } from "./shared.js";
import { scrubServer, scrubSettings } from "./secrets.js";
import type { FoundItem, FoundSettings, ScanContext, ScanResult } from "./types.js";

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split(/\r\n|\r|\n/).length;
}

function parseDocument(
  text: string,
  file: string,
  code: string,
  diagnostics: Diagnostic[],
  jsonc: boolean,
  severity: "error" | "warn" = "error",
): unknown {
  const errors: ParseError[] = [];
  const value: unknown = parse(
    text,
    errors,
    jsonc ? { allowTrailingComma: true } : { disallowComments: true },
  );
  for (const error of errors) {
    diagnostics.push({
      severity,
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
  settingsFile = false,
): Promise<string | undefined> {
  if (ctx.managed(path)) return undefined;
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (missingFile(error)) return undefined;
    diagnostics.push({
      severity: settingsFile ? "warn" : "error",
      code: settingsFile ? "import.settings" : "import.read",
      message: failureReason(error),
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

function addSettings(
  value: JsonObject,
  file: string,
  name: string,
  format: "json" | "toml",
  items: FoundItem[],
  excludeNativeAgents = false,
): void {
  let settings: Record<string, JsonValue> = { ...value };
  const excluded: string[] = [];
  if (excludeNativeAgents) {
    const native = settings["[native]"];
    if (isJsonObject(native) && Object.hasOwn(native, "agents")) {
      const remaining = Object.fromEntries(
        Object.entries(native).filter(([key]) => key !== "agents"),
      ) as JsonObject;
      settings = { ...settings };
      if (Object.keys(remaining).length === 0) delete settings["[native]"];
      else settings["[native]"] = remaining;
      excluded.push("[native].agents");
    }
  }
  const { value: sanitized, secrets } = scrubSettings(settings);
  const found: FoundSettings = {
    kind: "settings",
    name,
    source: "omo",
    path: file,
    format,
    value: sanitized,
    excluded,
    secrets,
    hash: hashJson(sanitized),
  };
  items.push(found);
}

function scanSettings(
  text: string,
  file: string,
  name: string,
  jsonc: boolean,
  diagnostics: Diagnostic[],
  items: FoundItem[],
  excludeNativeAgents = false,
): void {
  const previousDiagnostics = diagnostics.length;
  const value = parseDocument(text, file, "import.settings", diagnostics, jsonc, "warn");
  if (value === undefined) {
    if (diagnostics.length === previousDiagnostics) {
      diagnostics.push({
        severity: "warn",
        code: "import.settings",
        message: "Expected a settings object.",
        file,
      });
    }
    return;
  }
  if (!isJsonObject(value)) {
    diagnostics.push({
      severity: "warn",
      code: "import.settings",
      message: "Expected a settings object.",
      file,
    });
    return;
  }
  addSettings(value, file, name, "json", items, excludeNativeAgents);
}

function scanMcpSettings(
  text: string,
  file: string,
  diagnostics: Diagnostic[],
  items: FoundItem[],
): void {
  const previousDiagnostics = diagnostics.length;
  const value = parseDocument(text, file, "import.settings", diagnostics, false, "warn");
  if (value === undefined) {
    if (diagnostics.length === previousDiagnostics) {
      diagnostics.push({
        severity: "warn",
        code: "import.settings",
        message: "Expected an object containing settings.",
        file,
      });
    }
    return;
  }
  if (!isJsonObject(value)) {
    diagnostics.push({
      severity: "warn",
      code: "import.settings",
      message: "Expected an object containing settings.",
      file,
    });
    return;
  }
  // The OMO adapter spreads MCP settings at the document root beside mcpServers.
  const { mcpServers: _servers, ...settings } = value;
  if (Object.keys(settings).length > 0) addSettings(settings, file, "mcp-settings", "json", items);
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
  const mcp = await readUnmanaged(mcpPath, ctx, diagnostics, true);
  if (mcp !== undefined) {
    scanMcp(mcp, mcpPath, diagnostics, items);
    scanMcpSettings(mcp, mcpPath, diagnostics, items);
  }

  const agentsPath = join(home, "omo.jsonc");
  const agents = await readUnmanaged(agentsPath, ctx, diagnostics, true);
  if (agents !== undefined) {
    scanAgents(agents, agentsPath, diagnostics, items);
    scanSettings(agents, agentsPath, "omo/omo.jsonc", true, diagnostics, items, true);
  }

  const modelsPath = join(agentDir, "models.json");
  const models = await readUnmanaged(modelsPath, ctx, diagnostics, true);
  if (models !== undefined)
    scanSettings(models, modelsPath, "omo/models.json", false, diagnostics, items);

  return { items, diagnostics };
}
