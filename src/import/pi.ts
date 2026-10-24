import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseJsonc, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { Diagnostic, JsonValue, McpServer } from "../core/types.js";
import { isJsonObject, pointerToken } from "../model/json.js";
import { parseFrontmatter } from "../model/frontmatter.js";
import { agentMarkdown, hashJson, hashText } from "./shared.js";
import { scrubServer, scrubSettings } from "./secrets.js";
import type {
  FoundAgent,
  FoundInstructions,
  FoundItem,
  FoundMcp,
  FoundSettings,
  ScanContext,
  ScanResult,
} from "./types.js";

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function readText(
  path: string,
  diagnostics: Diagnostic[],
  optional = false,
): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (optional && hasErrorCode(error, "ENOENT")) return undefined;
    if (!(error instanceof Error)) throw error;
    diagnostics.push({
      severity: "error",
      code: "pi.import.read",
      message: error.message,
      file: path,
    });
    return undefined;
  }
}

function stringRecord(value: JsonValue | undefined): boolean {
  return (
    value === undefined ||
    (isJsonObject(value) && Object.values(value).every((entry) => typeof entry === "string"))
  );
}

function isMcpServer(value: unknown): value is McpServer {
  if (!isJsonObject(value)) return false;
  const command = value["command"];
  const args = value["args"];
  const url = value["url"];
  return (
    (command === undefined || typeof command === "string") &&
    (args === undefined ||
      (Array.isArray(args) && args.every((argument) => typeof argument === "string"))) &&
    (url === undefined || typeof url === "string") &&
    stringRecord(value["env"]) &&
    stringRecord(value["headers"])
  );
}

async function scanAgents(
  home: string,
  ctx: ScanContext,
  diagnostics: Diagnostic[],
): Promise<readonly FoundAgent[]> {
  const directory = join(home, "agents");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    if (!(error instanceof Error)) throw error;
    diagnostics.push({
      severity: "error",
      code: "pi.import.read",
      message: error.message,
      file: directory,
    });
    return [];
  }

  const agents: FoundAgent[] = [];
  for (const entry of entries.sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
  )) {
    if (
      !entry.name.endsWith(".md") ||
      entry.name === "general-purpose.md" ||
      !(entry.isFile() || entry.isSymbolicLink())
    ) {
      continue;
    }
    const path = join(directory, entry.name);
    if (ctx.managed(path)) continue;
    const content = await readText(path, diagnostics);
    if (content === undefined) continue;

    const parsed = parseFrontmatter(content, path);
    diagnostics.push(...parsed.diagnostics);
    if (parsed.diagnostics.length) continue;
    const frontmatter = parsed.frontmatter;
    const frontmatterName = frontmatter?.["name"];
    const description = frontmatter?.["description"];
    if (
      (frontmatterName !== undefined &&
        (typeof frontmatterName !== "string" || !frontmatterName.trim())) ||
      typeof description !== "string" ||
      !description.trim()
    ) {
      diagnostics.push({
        severity: "error",
        code: "pi.import.agent",
        message:
          typeof description !== "string" || !description.trim()
            ? "Agent frontmatter requires a non-empty description."
            : "Agent frontmatter name must be a non-empty string when provided.",
        file: path,
        jsonPath: typeof description !== "string" || !description.trim() ? "/description" : "/name",
      });
      continue;
    }

    const name = entry.name.slice(0, -".md".length);
    const markdown = agentMarkdown({
      name: typeof frontmatterName === "string" ? frontmatterName : name,
      description,
      body: parsed.body,
    });
    agents.push({
      kind: "agent",
      name,
      source: "pi",
      path,
      markdown,
      hash: hashText(markdown),
      dropped: Object.keys(frontmatter ?? {})
        .filter((key) => key !== "name" && key !== "description")
        .sort(),
    });
  }
  return agents;
}

async function scanInstructions(
  home: string,
  ctx: ScanContext,
  diagnostics: Diagnostic[],
): Promise<FoundInstructions | undefined> {
  const path = join(home, "AGENTS.md");
  if (ctx.managed(path)) return undefined;
  const content = await readText(path, diagnostics, true);
  if (content === undefined) return undefined;
  return {
    kind: "instructions",
    name: "instructions",
    source: "pi",
    path,
    content,
    hash: hashText(content),
  };
}

function settingsWarning(
  diagnostics: Diagnostic[],
  path: string,
  message: string,
  line?: number,
): void {
  diagnostics.push({
    severity: "warn",
    code: "import.settings",
    message,
    file: path,
    ...(line === undefined ? {} : { line }),
  });
}

const excludedSettingsKeys: ReadonlySet<string> = new Set(["mcpServers"]);

async function scanSettings(
  home: string,
  ctx: ScanContext,
  diagnostics: Diagnostic[],
): Promise<readonly FoundSettings[]> {
  const path = join(home, "settings.json");
  if (ctx.managed(path)) return [];

  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return [];
    settingsWarning(diagnostics, path, error instanceof Error ? error.message : String(error));
    return [];
  }

  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(content, errors);
  if (errors.length) {
    diagnostics.push(
      ...errors.map((error) => ({
        severity: "warn" as const,
        code: "import.settings",
        message: `Invalid JSONC: ${printParseErrorCode(error.error)}.`,
        file: path,
        line: content.slice(0, error.offset).split(/\r\n|\r|\n/).length,
      })),
    );
    return [];
  }
  if (!isJsonObject(parsed)) {
    settingsWarning(diagnostics, path, "Pi settings must be a JSON object.");
    return [];
  }
  if (Object.keys(parsed).length === 0) return [];

  const excluded = Object.keys(parsed)
    .filter((key) => excludedSettingsKeys.has(key))
    .sort();
  const value: Record<string, JsonValue> = {};
  for (const [key, entry] of Object.entries(parsed)) {
    if (!excludedSettingsKeys.has(key)) value[key] = entry;
  }
  const scrubbed = scrubSettings(value);
  return [
    {
      kind: "settings",
      name: "pi/settings.json",
      source: "pi",
      path,
      format: "json",
      value: scrubbed.value,
      excluded,
      secrets: scrubbed.secrets,
      hash: hashJson(scrubbed.value),
    },
  ];
}

async function scanMcp(
  home: string,
  ctx: ScanContext,
  diagnostics: Diagnostic[],
  settings: FoundSettings[],
): Promise<readonly FoundMcp[]> {
  const path = join(home, "mcp.json");
  if (ctx.managed(path)) return [];
  const previousDiagnostics = diagnostics.length;
  const content = await readText(path, diagnostics, true);
  if (content === undefined) {
    if (diagnostics.length > previousDiagnostics)
      settingsWarning(diagnostics, path, "Could not read Pi MCP settings.");
    return [];
  }

  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(content, errors);
  if (errors.length) {
    diagnostics.push(
      ...errors.map((error) => ({
        severity: "error" as const,
        code: "pi.import.mcp",
        message: `Invalid JSONC: ${printParseErrorCode(error.error)}.`,
        file: path,
        line: content.slice(0, error.offset).split(/\r\n|\r|\n/).length,
      })),
    );
    settingsWarning(diagnostics, path, "Cannot extract settings from invalid JSONC.");
    return [];
  }
  if (!isJsonObject(parsed)) {
    diagnostics.push({
      severity: "error",
      code: "pi.import.mcp",
      message: "Pi MCP configuration must contain an mcpServers object.",
      file: path,
      jsonPath: "/mcpServers",
    });
    settingsWarning(diagnostics, path, "Cannot extract settings from invalid JSONC.");
    return [];
  }

  const settingsValue = parsed["settings"];
  if (settingsValue !== undefined) {
    if (!isJsonObject(settingsValue)) {
      settingsWarning(diagnostics, path, "Pi MCP settings must be an object.");
    } else if (Object.keys(settingsValue).length > 0) {
      const scrubbed = scrubSettings(settingsValue);
      settings.push({
        kind: "settings",
        name: "mcp-settings",
        source: "pi",
        path,
        format: "json",
        value: scrubbed.value,
        excluded: [],
        secrets: scrubbed.secrets,
        hash: hashJson(scrubbed.value),
      });
    }
  }

  if (!isJsonObject(parsed["mcpServers"])) {
    diagnostics.push({
      severity: "error",
      code: "pi.import.mcp",
      message: "Pi MCP configuration must contain an mcpServers object.",
      file: path,
      jsonPath: "/mcpServers",
    });
    return [];
  }

  const servers: FoundMcp[] = [];
  for (const [name, value] of Object.entries(parsed["mcpServers"]).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (!isMcpServer(value)) {
      diagnostics.push({
        severity: "error",
        code: "pi.import.mcp",
        message:
          "MCP server must be an object with valid command, args, url, env, and headers fields.",
        file: path,
        jsonPath: `/mcpServers/${pointerToken(name)}`,
      });
      continue;
    }
    const scrubbed = scrubServer(value);
    servers.push({
      kind: "mcp",
      name,
      source: "pi",
      path,
      server: scrubbed.server,
      secrets: scrubbed.secrets,
      hash: hashJson(scrubbed.server),
    });
  }
  return servers;
}

export async function scanPi(home: string, ctx: ScanContext): Promise<ScanResult> {
  const diagnostics: Diagnostic[] = [];
  const agents = await scanAgents(home, ctx, diagnostics);
  const instructions = await scanInstructions(home, ctx, diagnostics);
  const settings = [...(await scanSettings(home, ctx, diagnostics))];
  const servers = await scanMcp(home, ctx, diagnostics, settings);
  const items: FoundItem[] = [
    ...agents,
    ...(instructions ? [instructions] : []),
    ...servers,
    ...settings,
  ];
  items.sort((left, right) =>
    left.kind === right.kind
      ? left.name < right.name
        ? -1
        : left.name > right.name
          ? 1
          : 0
      : left.kind < right.kind
        ? -1
        : 1,
  );
  return { items, diagnostics };
}
