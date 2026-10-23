import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { McpConfig } from "../../src/core/types.js";
import type { SourceFile } from "../../src/model/files.js";
import type { SourceLayer } from "../../src/model/layer.js";
import { discoverSources, resolveMcpServers, selectMcp } from "../../src/model/index.js";
import { readLayer } from "../../src/model/layer.js";
import { config, fixture } from "./helpers.js";

vi.mock("../../src/model/layer.js", () => ({ readLayer: vi.fn() }));

let repo: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => {
  repo = await fixture();
  vi.mocked(readLayer).mockReset();
});
afterEach(async () => {
  await repo.cleanup();
});

function mcpConfig(): McpConfig {
  return {
    file: "mcp.json",
    mcpServers: {
      docs: { command: "node", args: ["docs"] },
      tracker: { command: "node", args: ["tracker"] },
    },
    harnessOverrides: {},
    settings: { timeout: 30 },
  };
}

it("removes globally disabled servers from every MCP layer", () => {
  // Given
  const mcp = mcpConfig();
  const selection = { enabled: [], disabled: ["tracker"], harnesses: {} };
  // When
  const result = selectMcp(mcp, selection);
  // Then
  expect(result.mcpServers).toEqual({ docs: { command: "node", args: ["docs"] } });
  expect(result.harnessOverrides).toEqual({});
  expect(mcp.mcpServers["tracker"]).toEqual({ command: "node", args: ["tracker"] });
});

it("keeps only servers in the global enabled allowlist", () => {
  // Given
  const mcp = mcpConfig();
  const selection = { enabled: ["docs"], disabled: [], harnesses: {} };
  // When
  const result = selectMcp(mcp, selection);
  // Then
  expect(Object.keys(result.mcpServers)).toEqual(["docs"]);
  expect(resolveMcpServers(result, "codex")).toEqual({
    docs: { command: "node", args: ["docs"] },
  });
});

it("lets a per-harness enabled list replace the global allowlist", () => {
  // Given
  const mcp = mcpConfig();
  const selection = {
    enabled: ["docs"],
    disabled: [],
    harnesses: { codex: { enabled: ["tracker"], disabled: [] } },
  };
  // When
  const result = selectMcp(mcp, selection);
  // Then
  expect(resolveMcpServers(result, "codex")).toEqual({
    tracker: { command: "node", args: ["tracker"] },
  });
  expect(resolveMcpServers(result, "opencode")).toEqual({
    docs: { command: "node", args: ["docs"] },
  });
});

it("adds a null override when one harness disables a server", () => {
  // Given
  const mcp = mcpConfig();
  const selection = {
    enabled: [],
    disabled: [],
    harnesses: { codex: { enabled: [], disabled: ["docs"] } },
  };
  // When
  const result = selectMcp(mcp, selection);
  // Then
  expect(result.harnessOverrides.codex?.["docs"]).toBeNull();
  expect(resolveMcpServers(result, "codex")).not.toHaveProperty("docs");
  expect(resolveMcpServers(result, "opencode")).toHaveProperty("docs");
});

it("passes model MCP through unchanged when selection is undefined", async () => {
  // Given
  const mcp = mcpConfig();
  const layer: SourceLayer = {
    skills: [],
    agents: [],
    rules: [],
    templates: {},
    assets: [],
    seeds: [],
    bin: [],
    files: new Map<string, SourceFile>(),
    mcp,
  };
  vi.mocked(readLayer).mockResolvedValue(layer);
  // When
  const result = await discoverSources(repo.root, config(repo.root));
  // Then
  if (!result.model) throw new Error(JSON.stringify(result.diagnostics));
  expect(result.model.mcp).toBe(mcp);
});
