import { readdir, readFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseToml, TomlDate } from "smol-toml";
import type { TomlTable, TomlValue } from "smol-toml";
import type { Diagnostic, JsonValue, McpServer } from "../core/types.js";
import { unmanaged } from "../install/merges.js";
import { agentMarkdown, failureReason, hashJson, hashText } from "./shared.js";
import { scrubServer, scrubSettings } from "./secrets.js";
import type { FoundItem, ScanContext, ScanResult } from "./types.js";

function message(error: unknown): string {
  return failureReason(error);
}

function missing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function warn(diagnostics: Diagnostic[], code: string, file: string, detail: string): void {
  diagnostics.push({ severity: "warn", code, message: detail, file });
}

function tomlTable(value: TomlValue | undefined): TomlTable | undefined {
  if (value === undefined || value instanceof TomlDate || typeof value !== "object") return;
  if (Array.isArray(value)) return;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value : undefined;
}

function jsonValue(value: TomlValue): JsonValue | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (typeof value === "bigint") {
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : undefined;
  }
  if (value instanceof TomlDate) return value.toISOString();
  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    for (const entry of value) {
      const converted = jsonValue(entry);
      if (converted === undefined) return;
      result.push(converted);
    }
    return result;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return value.toString();
    const result: Record<string, JsonValue> = {};
    for (const [key, entry] of Object.entries(value)) {
      const converted = jsonValue(entry);
      if (converted === undefined) return;
      result[key] = converted;
    }
    return result;
  }
}

function stringMap(value: TomlValue | undefined): Record<string, string> | undefined {
  const table = tomlTable(value);
  if (!table) return;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(table)) {
    if (typeof entry !== "string") return;
    result[key] = entry;
  }
  return result;
}

function stringList(value: TomlValue | undefined): string[] | undefined {
  if (!Array.isArray(value)) return;
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return;
    result.push(entry);
  }
  return result;
}

function codexServer(source: TomlTable): McpServer | undefined {
  const result: Record<string, JsonValue> = {};
  const mapped = new Set([
    "url",
    "command",
    "args",
    "env",
    "bearer_token_env_var",
    "oauth_resource",
    "oauth",
    "http_headers",
  ]);

  for (const [key, value] of Object.entries(source)) {
    if (mapped.has(key) || (key === "default_tools_approval_mode" && value === "auto")) continue;
    const converted = jsonValue(value);
    if (converted === undefined) return;
    result[key] = converted;
  }

  const url = source["url"];
  if (typeof url === "string") {
    result["url"] = url;
    const bearer = source["bearer_token_env_var"];
    if (bearer !== undefined) {
      if (typeof bearer !== "string") return;
      result["bearer_token_env_var"] = bearer;
    }
    const resource = source["oauth_resource"];
    if (resource !== undefined) {
      if (typeof resource !== "string") return;
      result["oauth_resource"] = resource;
    }
    const oauthValue = source["oauth"];
    if (oauthValue !== undefined) {
      const oauth = tomlTable(oauthValue);
      if (!oauth) return;
      const mappedOauth: Record<string, JsonValue> = {};
      for (const [key, value] of Object.entries(oauth)) {
        if (key === "client_id" || key === "resource") continue;
        const converted = jsonValue(value);
        if (converted === undefined) return;
        mappedOauth[key] = converted;
      }
      const clientId = oauth["client_id"];
      if (clientId !== undefined) {
        if (typeof clientId !== "string") return;
        mappedOauth["client_id"] = clientId;
      }
      const oauthResource = oauth["resource"];
      if (oauthResource !== undefined) {
        if (typeof oauthResource !== "string") return;
        result["oauth_resource"] = oauthResource;
      }
      if (Object.keys(mappedOauth).length) result["oauth"] = mappedOauth;
    }
    const headers = source["http_headers"];
    if (headers !== undefined) {
      const mappedHeaders = stringMap(headers);
      if (!mappedHeaders) return;
      result["headers"] = mappedHeaders;
    }
  } else {
    const command = source["command"];
    if (typeof command !== "string") return;
    result["command"] = command;
    const args = source["args"];
    if (args !== undefined) {
      const mappedArgs = stringList(args);
      if (!mappedArgs) return;
      result["args"] = mappedArgs;
    }
    const env = source["env"];
    if (env !== undefined) {
      const mappedEnv = stringMap(env);
      if (!mappedEnv) return;
      result["env"] = mappedEnv;
    }
  }
  return result;
}

function withoutManagedBlocks(content: string): string {
  const ids = new Set(
    [...content.matchAll(/^# skillerie:([^:\r\n]+):begin[ \t]*$/gmu)].flatMap((match) =>
      match[1] ? [match[1]] : [],
    ),
  );
  let result = content;
  for (const blockId of ids) result = unmanaged(result, { blockId, format: "toml" });
  return result;
}

const excludedSettingsKeys = [
  "mcp_servers",
  "mcp_oauth_callback_port",
  "mcp_oauth_callback_url",
  "projects",
  "notice",
  "tui",
  "plugins",
] as const;

export async function scanCodex(home: string, ctx: ScanContext): Promise<ScanResult> {
  const items: FoundItem[] = [];
  const diagnostics: Diagnostic[] = [];
  const agentsDir = join(home, "agents");
  let entries: Dirent[] = [];
  try {
    entries = await readdir(agentsDir, { withFileTypes: true });
  } catch (error) {
    if (!missing(error)) warn(diagnostics, "import.agent", agentsDir, message(error));
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".toml") || (!entry.isFile() && !entry.isSymbolicLink())) continue;
    const file = join(agentsDir, entry.name);
    if (ctx.managed(file)) continue;
    let agent: TomlTable;
    try {
      agent = parseToml(await readFile(file, "utf8"));
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      warn(diagnostics, "import.agent", file, message(error));
      continue;
    }
    const nameValue = agent["name"];
    const name =
      typeof nameValue === "string" && nameValue.trim() ? nameValue : basename(file, ".toml");
    const description = agent["description"];
    if (typeof description !== "string" || !description.trim()) {
      warn(diagnostics, "import.agent", file, "Agent description is required.");
      continue;
    }
    const body = agent["developer_instructions"];
    if (body !== undefined && typeof body !== "string") {
      warn(diagnostics, "import.agent", file, "Agent developer_instructions must be a string.");
      continue;
    }
    const markdown = agentMarkdown({
      name,
      description,
      body: typeof body === "string" ? body : "",
    });
    const dropped = Object.keys(agent)
      .filter((key) => !["name", "description", "developer_instructions"].includes(key))
      .sort();
    items.push({
      kind: "agent",
      name,
      source: "codex",
      path: file,
      markdown,
      hash: hashText(markdown),
      dropped,
    });
  }

  const instructionsFile = join(home, "AGENTS.md");
  if (!ctx.managed(instructionsFile)) {
    try {
      const content = await readFile(instructionsFile, "utf8");
      items.push({
        kind: "instructions",
        name: "instructions",
        source: "codex",
        path: instructionsFile,
        content,
        hash: hashText(content),
      });
    } catch (error) {
      if (!missing(error))
        warn(diagnostics, "import.instructions", instructionsFile, message(error));
    }
  }

  const configFile = join(home, "config.toml");
  if (!ctx.managed(configFile)) {
    try {
      const config = parseToml(withoutManagedBlocks(await readFile(configFile, "utf8")));
      const settings: Record<string, JsonValue> = {};
      const excluded = excludedSettingsKeys.filter((key) => config[key] !== undefined);
      let settingsValid = true;
      for (const [key, value] of Object.entries(config)) {
        if ((excludedSettingsKeys as readonly string[]).includes(key)) continue;
        const converted = jsonValue(value);
        if (converted === undefined) {
          warn(
            diagnostics,
            "import.settings",
            configFile,
            `Setting ${key} cannot be represented as JSON.`,
          );
          settingsValid = false;
          break;
        }
        settings[key] = converted;
      }
      if (settingsValid && Object.keys(settings).length) {
        const scrubbed = scrubSettings(settings);
        if (Object.keys(scrubbed.value).length) {
          items.push({
            kind: "settings",
            name: "codex/config.toml",
            source: "codex",
            path: configFile,
            format: "toml",
            value: scrubbed.value,
            excluded,
            secrets: scrubbed.secrets,
            hash: hashJson(scrubbed.value),
          });
        }
      }

      const serversValue = config["mcp_servers"];
      if (serversValue !== undefined) {
        const servers = tomlTable(serversValue);
        if (!servers) {
          warn(diagnostics, "import.mcp", configFile, "mcp_servers must be a TOML table.");
        } else {
          for (const [name, value] of Object.entries(servers)) {
            const serverTable = tomlTable(value);
            const server = serverTable ? codexServer(serverTable) : undefined;
            if (!server) {
              warn(diagnostics, "import.mcp", configFile, `MCP server ${name} is invalid.`);
              continue;
            }
            const scrubbed = scrubServer(server);
            items.push({
              kind: "mcp",
              name,
              source: "codex",
              path: configFile,
              server: scrubbed.server,
              secrets: scrubbed.secrets,
              hash: hashJson(scrubbed.server),
            });
          }
        }
      }
    } catch (error) {
      if (!missing(error)) {
        warn(diagnostics, "import.mcp", configFile, message(error));
        warn(diagnostics, "import.settings", configFile, message(error));
      }
    }
  }

  return { items, diagnostics };
}
