import { Ajv } from "ajv";
import type { Diagnostic, HarnessId, McpConfig, McpSelection, McpServer } from "../core/types.js";
import { isJsonObject } from "./json.js";
import { harnessIds, validateFields } from "./schema.js";

const server = {
  type: "object",
  properties: {
    command: { type: "string" },
    args: { type: "array", items: { type: "string" } },
    url: { type: "string" },
    env: { type: "object", additionalProperties: { type: "string" } },
    headers: { type: "object", additionalProperties: { type: "string" } },
  },
} as const;
const validateMcp = new Ajv({ allErrors: true, ownProperties: true }).compile<
  Omit<McpConfig, "file">
>({
  type: "object",
  properties: {
    mcpServers: { type: "object", additionalProperties: server },
    harnessOverrides: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        harnessIds.map((harness) => [
          harness,
          {
            type: "object",
            additionalProperties: { anyOf: [server, { type: "null" }] },
          },
        ]),
      ),
    },
    settings: { type: "object" },
  },
  required: ["mcpServers", "harnessOverrides", "settings"],
  additionalProperties: false,
});

export function readMcp(
  text: string,
  file: string,
): { readonly mcp?: McpConfig; readonly diagnostics: readonly Diagnostic[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const match = /position (\d+)/.exec(error.message);
    return {
      diagnostics: [
        {
          severity: "error",
          code: "source.json",
          message: error.message,
          file,
          line: match?.[1] ? text.slice(0, Number(match[1])).split("\n").length : 1,
        },
      ],
    };
  }
  if (!isJsonObject(data))
    return {
      diagnostics: [
        {
          severity: "error",
          code: "mcp.mapping",
          message: "MCP configuration must be a JSON object.",
          file,
          jsonPath: "",
        },
      ],
    };
  const result = validateFields(
    validateMcp,
    {
      mcpServers: {},
      harnessOverrides: {},
      settings: {},
      ...data,
    },
    file,
  );
  return {
    ...(result.value ? { mcp: { ...result.value, file } } : {}),
    diagnostics: result.diagnostics,
  };
}

function selected(name: string, selection: McpSelection, harness: HarnessId): boolean {
  const local = selection.harnesses[harness];
  if (selection.disabled.includes(name) || local?.disabled.includes(name)) return false;
  const enabled = local?.enabled.length ? local.enabled : selection.enabled;
  return enabled.length === 0 || enabled.includes(name);
}

/** Apply global and per-harness server selection without changing the source config. */
export function selectMcp(mcp: McpConfig, selection: McpSelection): McpConfig {
  const names = new Set([
    ...Object.keys(mcp.mcpServers),
    ...Object.values(mcp.harnessOverrides).flatMap((overrides) => Object.keys(overrides ?? {})),
  ]);
  const removed = new Set(
    [...names].filter((name) => !harnessIds.some((harness) => selected(name, selection, harness))),
  );
  const mcpServers: Record<string, McpServer> = {};
  for (const [name, value] of Object.entries(mcp.mcpServers)) {
    if (!removed.has(name))
      Object.defineProperty(mcpServers, name, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  const harnessOverrides: Partial<Record<HarnessId, Readonly<Record<string, McpServer | null>>>> =
    {};
  for (const harness of harnessIds) {
    const existing = mcp.harnessOverrides[harness];
    const overrides: Record<string, McpServer | null> = {};
    for (const [name, value] of Object.entries(existing ?? {})) {
      if (!removed.has(name))
        Object.defineProperty(overrides, name, {
          value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    for (const name of names) {
      if (!removed.has(name) && !selected(name, selection, harness))
        Object.defineProperty(overrides, name, {
          value: null,
          enumerable: true,
          configurable: true,
          writable: true,
        });
    }
    if (existing || Object.keys(overrides).length) harnessOverrides[harness] = overrides;
  }
  return { ...mcp, mcpServers, harnessOverrides };
}

/** A null per-harness override removes the complete server, never a nested field. */
export function resolveMcpServers(
  mcp: McpConfig,
  harness: (typeof harnessIds)[number],
): Readonly<Record<string, McpServer>> {
  const servers: Record<string, McpServer> = { ...mcp.mcpServers };
  for (const [name, override] of Object.entries(mcp.harnessOverrides[harness] ?? {})) {
    if (override === null) delete servers[name];
    else
      Object.defineProperty(servers, name, {
        value: override,
        enumerable: true,
        configurable: true,
        writable: true,
      });
  }
  return servers;
}
