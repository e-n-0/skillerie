import { parse, stringify, TomlError } from "smol-toml";
import type { TomlTable } from "smol-toml";
import type { Diagnostic, McpServer, ResolvedContext } from "../../core/types.js";
import { resolveMcpServers } from "../../model/index.js";
import { callbacks, object } from "./oauth.js";

export interface ConfigBlocks {
  readonly settings: string;
  readonly mcp: string;
  readonly config: string;
  readonly diagnostics: readonly Diagnostic[];
}

function renderServer(server: McpServer): TomlTable | undefined {
  const result: TomlTable = { default_tools_approval_mode: "auto" };
  if (server.url) {
    result["url"] = server.url;
    const bearer = server["bearer_token_env_var"] ?? server["bearerTokenEnvVar"];
    if (typeof bearer === "string") result["bearer_token_env_var"] = bearer;
    const resource = server["oauth_resource"] ?? server["oauthResource"];
    if (typeof resource === "string") result["oauth_resource"] = resource;
    const oauth = server["oauth"];
    if (object(oauth)) {
      const resource = oauth["resource"];
      if (typeof resource === "string") result["oauth_resource"] = resource;
      const client = oauth["client_id"] ?? oauth["clientId"];
      if (typeof client === "string") result["oauth"] = { client_id: client };
    }
  } else if (server.command) {
    result["command"] = server.command;
    if (server.args?.length) result["args"] = [...server.args];
    if (server.env && Object.keys(server.env).length)
      result["env"] = Object.fromEntries(
        Object.entries(server.env).sort(([a], [b]) => a.localeCompare(b)),
      );
  } else {
    return undefined;
  }
  return result;
}

/** Both generation and installation consume these exact serialized blocks. */
export function configBlocks(ctx: ResolvedContext): ConfigBlocks {
  const diagnostics: Diagnostic[] = [];
  const template = ctx.model.templates.codex?.files.find((file) => file.relPath === "config.toml");
  let settings: TomlTable = {};
  try {
    if (template) settings = parse(template.content);
  } catch (error) {
    if (!(error instanceof TomlError)) throw error;
    diagnostics.push({
      severity: "error",
      code: "codex.config",
      message: error.message,
      file: template?.file ?? "config.toml",
    });
  }
  const mcp = ctx.model.mcp;
  const servers = mcp ? resolveMcpServers(mcp, "codex") : {};
  if (Object.hasOwn(settings, "mcp_servers")) {
    diagnostics.push({
      severity: "error",
      code: "codex.configCollision",
      message: "Define MCP servers in mcp.json, not the Codex settings template.",
      file: template?.file ?? "config.toml",
      jsonPath: "/mcp_servers",
    });
    delete settings["mcp_servers"];
  }
  const callback = callbacks(servers, mcp?.file ?? "mcp.json");
  diagnostics.push(...callback.diagnostics);
  for (const [key, value] of [
    ["mcp_oauth_callback_port", callback.settings.port],
    ["mcp_oauth_callback_url", callback.settings.url],
  ] as const) {
    if (value === undefined) continue;
    if (settings[key] !== undefined && settings[key] !== value)
      diagnostics.push({
        severity: "error",
        code: "codex.oauth",
        message: "Codex settings and MCP OAuth callbacks must agree.",
        file: template?.file ?? "config.toml",
        jsonPath: `/${key}`,
      });
    settings[key] = value;
  }
  const rendered: TomlTable = {};
  for (const [name, server] of Object.entries(servers).sort(([a], [b]) => a.localeCompare(b))) {
    const value = renderServer(server);
    if (value) Object.defineProperty(rendered, name, { value, enumerable: true });
    else
      diagnostics.push({
        severity: "error",
        code: "codex.mcpTransport",
        message: `MCP server ${name} needs a URL or command for Codex.`,
        file: mcp?.file ?? "mcp.json",
      });
  }
  const mcpTable = Object.keys(rendered).length ? { mcp_servers: rendered } : {};
  return {
    settings: stringify(settings),
    mcp: stringify(mcpTable),
    config: stringify({ ...settings, ...mcpTable }),
    diagnostics,
  };
}
