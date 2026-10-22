import { afterEach, beforeEach, expect, it } from "vitest";
import { renderConfig, renderMcpServer } from "../../../src/adapters/opencode/config.js";
import { sampleContext, withTemplate } from "./helpers.js";

let sample: Awaited<ReturnType<typeof sampleContext>>;
beforeEach(async () => {
  sample = await sampleContext();
});
afterEach(async () => {
  await sample.cleanup();
});

it("parses comments and trailing commas when merging native MCP configuration", () => {
  // Given: JSONC strings containing comment-like text and a template-local server.
  const ctx = withTemplate(
    sample.ctx,
    '{/* comment */"mcp":{"local":{"type":"remote","url":"https://example.com/a//b",},},}',
  );
  // When: rendering the merged configuration.
  const result = renderConfig(ctx);
  // Then: local entries survive and generated entries are deterministic.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.["mcp"]).toMatchObject({
    local: { type: "remote", url: "https://example.com/a//b" },
    docs: { type: "remote", url: "https://docs.example.com/mcp" },
    tracker: { type: "local", command: ["sh", `${sample.repo}/bin/tracker.sh`] },
  });
  expect(Object.keys(result.config?.["mcp"] ?? {})).toEqual(["docs", "local", "tracker"]);
});

it("replaces whole servers and removes null overrides when rendering MCP", () => {
  // Given: per-harness overrides distinct from their fallback entries.
  const ctx = sample.ctx;
  const model = {
    ...ctx.model,
    mcp: {
      file: "mcp.json",
      mcpServers: { docs: { url: "https://example.com/old" }, tracker: { command: "old" } },
      harnessOverrides: {
        opencode: { docs: { command: "new", env: { MODE: "docs" } }, tracker: null },
      },
      settings: {},
    },
  };
  // When: rendering the effective server set.
  const result = renderConfig({ ...ctx, model });
  // Then: no field leaks from a replaced or removed entry.
  expect(result.diagnostics).toEqual([]);
  expect(result.config?.["mcp"]).toEqual({
    docs: { type: "local", command: ["new"], environment: { MODE: "docs" } },
  });
});

it("rejects duplicate MCP ownership when a template declares a generated name", () => {
  // Given: a valid native template that collides with a shared server.
  const ctx = withTemplate(
    sample.ctx,
    '{"mcp":{"docs":{"type":"remote","url":"https://example.com"}}}',
  );
  // When: merging sources.
  const result = renderConfig(ctx);
  // Then: neither source silently overwrites the other.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      severity: "error",
      code: "opencode.mcpCollision",
      jsonPath: "/mcp/docs",
    }),
  );
});

it.each([
  '{"instructions":false}',
  '{"unknown":true}',
  '{"mcp":{"docs":{"type":"local","command":"sh"}}}',
  '{"provider":false}',
  '{"instructions": [}',
  "[]",
])("rejects invalid templates when the source is %s", (content) => {
  // Given: a syntax or published-schema violation.
  const ctx = withTemplate(sample.ctx, content);
  // When: parsing and validating the template.
  const result = renderConfig(ctx);
  // Then: generation receives an error rather than invalid runtime settings.
  expect(result.config).toBeUndefined();
  expect(result.diagnostics.some((item) => item.severity === "error")).toBe(true);
});

it("maps remote authentication extensions when only supported OAuth fields apply", () => {
  // Given: a neutral remote server with unsupported OAuth extensions.
  const server = {
    url: "https://example.com/mcp",
    headers: { "X-Docs": "docs" },
    oauth: { clientId: "docs", scope: "ignored" },
  };
  // When: rendering its native transport.
  const result = renderMcpServer(server, "/home/alice");
  // Then: only clientId and supported transport fields survive.
  expect(result).toEqual({
    type: "remote",
    url: server.url,
    headers: server.headers,
    oauth: { clientId: "docs" },
  });
});

it("expands home prefixes when local command arguments use tilde", () => {
  // Given: local command and argument prefixes, including a shell variable.
  const server = { command: "~/bin/docs", args: ["~/data", "$DOCS"], env: { DOCS: "docs" } };
  // When: rendering the native transport.
  const result = renderMcpServer(server, "/home/alice");
  // Then: home paths resolve and shell syntax stays native.
  expect(result).toEqual({
    type: "local",
    command: ["/home/alice/bin/docs", "/home/alice/data", "$DOCS"],
    environment: server.env,
  });
});

it("reports missing transports when MCP entries have neither URL nor command", () => {
  // Given: an otherwise parsed MCP entry without a transport.
  const ctx = sample.ctx;
  const model = {
    ...ctx.model,
    mcp: { file: "mcp.json", mcpServers: { docs: {} }, harnessOverrides: {}, settings: {} },
  };
  // When: rendering configuration.
  const result = renderConfig({ ...ctx, model });
  // Then: an actionable server-specific error prevents generation.
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "opencode.mcp", jsonPath: "/mcpServers/docs" }),
  );
});

it("includes owned rules when the template already supplies instructions", () => {
  // Given: existing instructions and applicable owned rules.
  const ctx = withTemplate(sample.ctx, '{"instructions":["docs.md","rules/*.md"]}');
  // When: rendering native config.
  const result = renderConfig(ctx);
  // Then: the owned glob occurs once and unrelated instructions are preserved.
  expect(result.config?.["instructions"]).toEqual(["docs.md", "rules/*.md"]);
});
