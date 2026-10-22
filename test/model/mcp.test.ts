import { afterEach, beforeEach, expect, it } from "vitest";
import { discoverSources, resolveMcpServers } from "../../src/model/index.js";
import { config, discover, fixture } from "./helpers.js";

let repo: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  repo = await fixture();
});
afterEach(async () => {
  await repo.cleanup();
});

it("retains MCP extensions and settings when parsing server entries", async () => {
  // Given
  const mcp = {
    mcpServers: { docs: { url: "https://example.com/mcp", extension: { value: [1, true] } } },
    settings: { timeout: 30, nested: { enabled: true } },
  };
  await repo.put("mcp.json", JSON.stringify(mcp));
  // When
  const model = await discover(repo.root);
  // Then
  expect(model.mcp?.mcpServers).toEqual(mcp.mcpServers);
  expect(model.mcp?.settings).toEqual(mcp.settings);
});

it("deletes and replaces whole MCP servers when harness overrides apply", async () => {
  // Given
  await repo.put(
    "mcp.json",
    JSON.stringify({
      mcpServers: {
        docs: { command: "node", args: ["old"] },
        tracker: { url: "https://example.com/tracker" },
      },
      harnessOverrides: { codex: { docs: { command: "git" }, tracker: null } },
    }),
  );
  const model = await discover(repo.root);
  if (!model.mcp) throw new Error("Missing test MCP");
  // When
  const servers = resolveMcpServers(model.mcp, "codex");
  // Then
  expect(servers).toEqual({ docs: { command: "git" } });
});

it("keeps other harness servers when one harness deletes a server", async () => {
  // Given
  await repo.put(
    "mcp.json",
    JSON.stringify({
      mcpServers: { docs: { command: "node" } },
      harnessOverrides: { codex: { docs: null } },
    }),
  );
  const model = await discover(repo.root);
  if (!model.mcp) throw new Error("Missing test MCP");
  // When
  const servers = resolveMcpServers(model.mcp, "omo");
  // Then
  expect(servers).toEqual({ docs: { command: "node" } });
});

it("replaces starter MCP servers when user server names overlap", async () => {
  // Given
  const starter = await fixture();
  try {
    await starter.put(
      "mcp.json",
      JSON.stringify({
        mcpServers: { docs: { command: "node", args: ["old"] }, tracker: { command: "git" } },
        settings: { base: true },
        harnessOverrides: { codex: { tracker: null } },
      }),
    );
    await repo.put(
      "mcp.json",
      JSON.stringify({
        mcpServers: { docs: { url: "https://example.com/mcp" } },
        settings: { extra: true },
      }),
    );
    // When
    const model = await discover(repo.root, {}, starter.root);
    // Then
    expect(model.mcp?.mcpServers).toEqual({
      docs: { url: "https://example.com/mcp" },
      tracker: { command: "git" },
    });
    expect(model.mcp?.settings).toEqual({ base: true, extra: true });
    expect(model.mcp?.harnessOverrides.codex).toEqual({ tracker: null });
  } finally {
    await starter.cleanup();
  }
});

it("reports RFC 6901 paths when a server field is invalid", async () => {
  // Given
  const file = await repo.put(
    "mcp.json",
    JSON.stringify({ mcpServers: { "docs/tracker": { env: { KEY: 3 } } } }),
  );
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.model).toBeUndefined();
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ file, jsonPath: "/mcpServers/docs~1tracker/env/KEY" }),
  );
});

it("reports a source line when MCP JSON is malformed", async () => {
  // Given
  const file = await repo.put("mcp.json", "{\ninvalid");
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ file, line: expect.any(Number), code: "source.json" }),
  );
});
