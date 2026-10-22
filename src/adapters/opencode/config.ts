import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { parse, printParseErrorCode, type ParseError } from "jsonc-parser";
import type { Diagnostic, JsonObject, McpServer, ResolvedContext } from "../../core/types.js";
import { resolveMcpServers } from "../../model/index.js";
import { isJsonObject } from "../../model/json.js";
import { configSchema } from "./config-schema.js";

const ajv = new Ajv2020({ allErrors: true, strict: false, ownProperties: true });
// Model identifiers are extensible: a frozen remote catalog would reject custom providers.
ajv.addSchema({
  $id: "https://models.dev/model-schema.json",
  $defs: { Model: { type: "string" } },
});
const validate = ajv.compile<JsonObject>(configSchema);

export function renderMcpServer(server: McpServer, home: string): JsonObject | undefined {
  if (server.url) {
    const oauth = server["oauth"];
    const clientId = isJsonObject(oauth) ? oauth["clientId"] : undefined;
    return {
      type: "remote",
      url: server.url,
      ...(server.headers && Object.keys(server.headers).length ? { headers: server.headers } : {}),
      ...(typeof clientId === "string" ? { oauth: { clientId } } : {}),
    };
  }
  if (!server.command) return undefined;
  const expandHome = (value: string) =>
    value.startsWith("~/") ? join(home, value.slice(2)) : value;
  return {
    type: "local",
    command: [server.command, ...(server.args ?? [])].map(expandHome),
    ...(server.env && Object.keys(server.env).length ? { environment: server.env } : {}),
  };
}

export function renderConfig(ctx: ResolvedContext): {
  readonly config?: JsonObject;
  readonly diagnostics: readonly Diagnostic[];
} {
  const template = ctx.model.templates.opencode?.files.find(
    (entry) => entry.relPath === "opencode.jsonc",
  );
  const source = template === undefined ? {} : { file: template.file };
  const errors: ParseError[] = [];
  const parsed: unknown = parse(template?.content ?? "{}", errors, { allowTrailingComma: true });
  const diagnostics: Diagnostic[] = errors.map((error) => ({
    severity: "error",
    code: "opencode.jsonc",
    message: printParseErrorCode(error.error),
    ...source,
    line: (template?.content ?? "").slice(0, error.offset).split("\n").length,
  }));
  if (!isJsonObject(parsed)) {
    diagnostics.push({
      severity: "error",
      code: "opencode.config",
      message: "The OpenCode template must be an object.",
      ...source,
    });
    return { diagnostics };
  }
  if (errors.length) return { diagnostics };
  if (!validate(parsed)) {
    diagnostics.push(
      ...(validate.errors ?? []).map((error) => ({
        severity: "error" as const,
        code: "opencode.schema",
        message: error.message ?? "Invalid OpenCode setting.",
        ...source,
        jsonPath: error.instancePath,
      })),
    );
    return { diagnostics };
  }
  const templateMcp = parsed["mcp"];
  if (templateMcp !== undefined && !isJsonObject(templateMcp)) return { diagnostics };
  const servers: Record<string, JsonObject> = {};
  const mcp = ctx.model.mcp;
  if (mcp) {
    for (const [name, server] of Object.entries(resolveMcpServers(mcp, "opencode"))) {
      if (templateMcp && Object.hasOwn(templateMcp, name)) {
        diagnostics.push({
          severity: "error",
          code: "opencode.mcpCollision",
          message: `MCP server ${name} is also declared in the template.`,
          ...source,
          jsonPath: `/mcp/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        });
        continue;
      }
      const rendered = renderMcpServer(server, ctx.snapshot.config.paths.home);
      if (rendered) servers[name] = rendered;
      else
        diagnostics.push({
          severity: "error",
          code: "opencode.mcp",
          message: `MCP server ${name} needs a URL or command.`,
          file: mcp.file,
          jsonPath: `/mcpServers/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        });
    }
  }
  const mergedMcp = { ...templateMcp, ...servers };
  const instructions = parsed["instructions"];
  const ruleFiles =
    ctx.model.harnesses.opencode?.rules.length ||
    ctx.model.harnesses.opencode?.assets.some((asset) => asset.relPath === "rules");
  const config: JsonObject = {
    ...parsed,
    ...(ruleFiles
      ? {
          instructions: [
            ...new Set([...(Array.isArray(instructions) ? instructions : []), "rules/*.md"]),
          ],
        }
      : {}),
    ...(templateMcp !== undefined || Object.keys(servers).length
      ? {
          mcp: Object.fromEntries(Object.entries(mergedMcp).sort(([a], [b]) => a.localeCompare(b))),
        }
      : {}),
  };
  if (!validate(config))
    diagnostics.push(
      ...(validate.errors ?? []).map((error) => ({
        severity: "error" as const,
        code: "opencode.schema",
        message: error.message ?? "Invalid generated OpenCode setting.",
        ...source,
        jsonPath: error.instancePath,
      })),
    );
  return { config, diagnostics };
}
