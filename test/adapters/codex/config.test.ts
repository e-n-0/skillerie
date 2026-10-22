import { parse } from "smol-toml";
import { beforeAll, expect, it } from "vitest";
import type { ResolvedContext } from "../../../src/core/types.js";
import { configBlocks } from "../../../src/adapters/codex/config.js";
import { context, withMcp } from "./helpers.js";

let ctx: ResolvedContext;
beforeAll(async () => {
  ctx = await context();
});

it("renders URL and local transports when shared servers are configured", () => {
  // Given: both canonical transports and aliases.
  const input = withMcp(ctx, {
    mcpServers: {
      docs: {
        url: "https://example.com/mcp",
        bearerTokenEnvVar: "DOCS_TOKEN",
        oauthResource: "https://example.com",
        oauth: { clientId: "example-client" },
      },
      tracker: {
        command: "sh",
        args: ["/home/alice/config/bin/tracker.sh"],
        env: { Z: "last", A: "first" },
      },
    },
  });
  // When: configuration is serialized with TOML.
  const result = configBlocks(input);
  // Then: each managed server has auto approval and correctly typed transport fields.
  expect(result.diagnostics).toEqual([]);
  expect(parse(result.mcp)).toEqual({
    mcp_servers: {
      docs: {
        url: "https://example.com/mcp",
        bearer_token_env_var: "DOCS_TOKEN",
        oauth_resource: "https://example.com",
        oauth: { client_id: "example-client" },
        default_tools_approval_mode: "auto",
      },
      tracker: {
        command: "sh",
        args: ["/home/alice/config/bin/tracker.sh"],
        env: { A: "first", Z: "last" },
        default_tools_approval_mode: "auto",
      },
    },
  });
});

it("replaces and removes complete servers when Codex overrides apply", () => {
  // Given: a replacement differing from the base transport and a null deletion.
  const input = withMcp(ctx, {
    mcpServers: { docs: { command: "old", args: ["stale"] }, tracker: { command: "remove" } },
    harnessOverrides: { codex: { docs: { url: "https://example.com/new" }, tracker: null } },
  });
  // When: MCP configuration is rendered.
  const result = parse(configBlocks(input).mcp);
  // Then: no base fields or deleted servers leak into Codex.
  expect(result).toEqual({
    mcp_servers: { docs: { url: "https://example.com/new", default_tools_approval_mode: "auto" } },
  });
});

it.each([
  { oauth: { callbackPort: 43210 } },
  { oauth_callback_port: 43210 },
  { oauth: { callback_url: "http://localhost:43210/callback" } },
  { oauthCallbackUrl: "http://localhost:43210/callback" },
])("derives singleton callback settings when a supported alias is supplied", (fields) => {
  // Given: one server declaring its callback using an accepted spelling.
  const input = withMcp(ctx, {
    mcpServers: { docs: { url: "https://example.com/mcp", ...fields } },
  });
  // When: callback settings are lifted to TOML root keys.
  const result = configBlocks(input);
  // Then: both values agree and remain root-level alongside template keys.
  expect(result.diagnostics).toEqual([]);
  expect(parse(result.config)).toMatchObject({
    mcp_oauth_callback_port: 43210,
    mcp_oauth_callback_url: "http://localhost:43210/callback",
    model: "example-model",
  });
});

it.each([
  { callbackPort: 0 },
  { callbackPort: 65536 },
  { callbackPort: 1.5 },
  { callbackPort: "43210" },
  { callbackUrl: "invalid" },
  { callbackPort: 43210, callbackUrl: "http://localhost:43211/callback" },
])("rejects invalid callbacks when fields violate the singleton contract", (oauth) => {
  // Given: invalid or inconsistent metadata.
  const input = withMcp(ctx, { mcpServers: { docs: { url: "https://example.com/mcp", oauth } } });
  // When: configuration is rendered.
  const result = configBlocks(input);
  // Then: a located error blocks installation.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ severity: "error", code: "codex.oauth", file: "mcp.json" }),
  );
});

it("rejects differing callbacks when multiple servers request different URLs", () => {
  // Given: equal ports but distinct redirect paths.
  const input = withMcp(ctx, {
    mcpServers: {
      docs: {
        url: "https://example.com/docs",
        oauth: { callbackUrl: "http://localhost:43210/first" },
      },
      tracker: {
        url: "https://example.com/tracker",
        oauth: { callback_url: "http://localhost:43210/second" },
      },
    },
  });
  // When: callback settings are combined.
  const result = configBlocks(input);
  // Then: one conflicting URL is not silently selected.
  expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);
});

it("rejects collisions when the template also defines MCP servers", () => {
  // Given: duplicated ownership of MCP settings.
  const input: ResolvedContext = {
    ...ctx,
    model: {
      ...ctx.model,
      templates: {
        codex: {
          harness: "codex",
          files: [
            {
              file: "config.toml",
              relPath: "config.toml",
              format: "toml",
              content: '[mcp_servers.docs]\ncommand = "old"\n',
            },
          ],
        },
      },
    },
  };
  // When: generated MCP is merged with template settings.
  const result = configBlocks(input);
  // Then: the collision is a diagnostic rather than lost configuration.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "codex.configCollision", severity: "error" }),
  );
});

it("quotes TOML server names when they contain dots or spaces", () => {
  // Given: a server name that is not a bare TOML key.
  const input = withMcp(ctx, {
    mcpServers: { "docs.example tools": { command: "sh", args: [], env: {} } },
  });
  // When: the real TOML serializer writes MCP tables.
  const result = parse(configBlocks(input).mcp);
  // Then: the server remains one key, with empty transport collections omitted.
  expect(result).toEqual({
    mcp_servers: { "docs.example tools": { command: "sh", default_tools_approval_mode: "auto" } },
  });
});
