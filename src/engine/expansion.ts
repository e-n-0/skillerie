import { expandVariables } from "../config/index.js";
import type { ExpansionVariables } from "../config/index.js";
import type {
  Diagnostic,
  HarnessMap,
  HarnessTemplates,
  JsonValue,
  McpServer,
  SourceModel,
} from "../core/types.js";
import { expandTemplate } from "./templates.js";

/** Expand parsed values only; Markdown and mapping keys remain source text. */
export function expandSources(model: SourceModel, variables: ExpansionVariables) {
  const diagnostics: Diagnostic[] = [];
  const visit = (value: JsonValue, path: string): JsonValue => {
    if (typeof value === "string") {
      const result = expandVariables(value, variables);
      diagnostics.push(
        ...result.diagnostics.map((item) => ({
          ...item,
          ...(model.mcp ? { file: model.mcp.file } : {}),
          jsonPath: path,
        })),
      );
      return result.value;
    }
    if (Array.isArray(value))
      return value.map((child: JsonValue, index) => visit(child, `${path}/${index}`));
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]: [string, JsonValue]) => [
          key,
          visit(child, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`),
        ]),
      );
    return value;
  };
  const server = (value: McpServer, path: string): McpServer =>
    Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        visit(child, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`),
      ]),
    );
  const templates: HarnessMap<HarnessTemplates> = Object.fromEntries(
    Object.entries(model.templates).map(([harness, group]) => [
      harness,
      {
        ...group,
        files: group.files.map((template) => {
          const result = expandTemplate(template, variables);
          diagnostics.push(...result.diagnostics);
          return result.template;
        }),
      },
    ]),
  );
  const mcp = model.mcp;
  return {
    diagnostics,
    model: {
      ...model,
      templates,
      ...(mcp
        ? {
            mcp: {
              ...mcp,
              mcpServers: Object.fromEntries(
                Object.entries(mcp.mcpServers).map(([name, value]) => [
                  name,
                  server(value, `/mcpServers/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`),
                ]),
              ),
              harnessOverrides: Object.fromEntries(
                Object.entries(mcp.harnessOverrides).map(([harness, servers]) => [
                  harness,
                  Object.fromEntries(
                    Object.entries(servers).map(([name, value]) => [
                      name,
                      value === null
                        ? null
                        : server(
                            value,
                            `/harnessOverrides/${harness}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
                          ),
                    ]),
                  ),
                ]),
              ),
              settings: Object.fromEntries(
                Object.entries(mcp.settings).map(([key, value]) => [
                  key,
                  visit(value, `/settings/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`),
                ]),
              ),
            },
          }
        : {}),
    },
  };
}
