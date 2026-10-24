import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FoundSettings, ScanContext } from "../../src/import/types.js";
import type { ResolvedContext } from "../../src/core/types.js";
import { renderMcp } from "../../src/adapters/omo/configuration.js";
import { scanOmo } from "../../src/import/omo.js";
import { PROVIDER_KEY } from "./fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createHome() {
  const home = await mkdtemp(join(tmpdir(), "skillerie-omo-"));
  roots.push(home);
  const agentDir = join(home, "agent");
  await mkdir(agentDir, { recursive: true });
  return { home, agentDir };
}

function context(managed: (path: string) => boolean = () => false): ScanContext {
  return { env: {}, managed };
}

describe("scanOmo", () => {
  it("scans instructions, MCP servers, and native agents", async () => {
    // Given an Omo home with each supported import source
    const { home, agentDir } = await createHome();
    const instructions = "Prefer bun.\n";
    await writeFile(join(agentDir, "AGENTS.md"), instructions);
    await writeFile(
      join(agentDir, "mcp.json"),
      JSON.stringify({
        mcpServers: {
          docs: {
            url: "https://docs.example.com/mcp",
            headers: { Authorization: "Bearer abcdefghijklmnop" },
          },
        },
      }),
    );
    await writeFile(
      join(home, "omo.jsonc"),
      `{
        // Native agents are rendered under this section.
        "[native]": {
          "agents": {
            "planner": {
              "description": "Plan code changes.",
              "prompt": "Start with a plan.",
              "model": "model-specific"
            }
          }
        }
      }`,
    );

    // When the home is scanned
    const result = await scanOmo(home, agentDir, context());

    // Then supported entries are fingerprinted and secret values are removed
    expect(result.diagnostics).toEqual([]);
    expect(result.items).toHaveLength(4);
    expect(result.items.find((item) => item.kind === "instructions")).toMatchObject({
      name: "instructions",
      content: instructions,
    });
    expect(result.items.find((item) => item.kind === "mcp")).toMatchObject({
      name: "docs",
      server: { url: "https://docs.example.com/mcp" },
      secrets: ["headers.Authorization"],
    });
    expect(result.items.find((item) => item.kind === "agent")).toMatchObject({
      name: "planner",
      markdown: expect.stringContaining("Start with a plan."),
      dropped: ["model"],
    });
    expect(result.items.find((item) => item.kind === "settings")).toMatchObject({
      name: "omo/omo.jsonc",
      format: "json",
      value: {},
      excluded: ["[native].agents"],
    });
  });

  it("extracts settings while excluding agents and scrubbing secrets", async () => {
    // Given OMO settings with native agents, provider credentials, and MCP settings
    const { home, agentDir } = await createHome();
    await writeFile(
      join(home, "omo.jsonc"),
      `{
        // Settings are imported, but native agents are scanned separately.
        "telemetry": false,
        "[native]": {
          "theme": "dark",
          "agents": { "planner": { "description": "Plan.", "prompt": "Plan." } }
        }
      }`,
    );
    await writeFile(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: { local: { baseUrl: "http://localhost:11434", apiKey: PROVIDER_KEY } },
      }),
    );
    await writeFile(
      join(agentDir, "mcp.json"),
      JSON.stringify({ timeoutMs: 30000, mcpServers: {} }),
    );

    // When the OMO home is scanned
    const result = await scanOmo(home, agentDir, context());
    const settings = result.items.filter((item): item is FoundSettings => item.kind === "settings");

    // Then ordinary values remain, excluded paths are reported, and secret values are absent
    expect(result.diagnostics).toEqual([]);
    expect(settings).toHaveLength(3);
    expect(settings.find((item) => item.name === "omo/omo.jsonc")).toMatchObject({
      format: "json",
      value: { telemetry: false, "[native]": { theme: "dark" } },
      excluded: ["[native].agents"],
      secrets: [],
    });
    expect(settings.find((item) => item.name === "omo/models.json")).toMatchObject({
      format: "json",
      value: { providers: { local: { baseUrl: "http://localhost:11434" } } },
      excluded: [],
      secrets: ["providers.local.apiKey"],
    });
    expect(settings.find((item) => item.name === "mcp-settings")).toMatchObject({
      format: "json",
      value: { timeoutMs: 30000 },
      excluded: [],
      secrets: [],
    });
    expect(JSON.stringify(settings)).not.toContain(PROVIDER_KEY);
  });

  it("skips a managed settings file", async () => {
    // Given a models file already managed by skillerie
    const { home, agentDir } = await createHome();
    const modelsPath = join(agentDir, "models.json");
    await writeFile(modelsPath, JSON.stringify({ providers: { local: { apiKey: "hidden" } } }));

    // When that managed home is scanned
    const result = await scanOmo(
      home,
      agentDir,
      context((path) => path === modelsPath),
    );

    // Then the managed file is not imported
    expect(result.items).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("returns a warning for invalid settings JSON", async () => {
    // Given an invalid models settings file
    const { home, agentDir } = await createHome();
    const modelsPath = join(agentDir, "models.json");
    await writeFile(modelsPath, '{"providers": {');

    // When the OMO home is scanned
    const result = await scanOmo(home, agentDir, context());

    // Then the settings parse failure is reported as a warning
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warn",
          code: "import.settings",
          file: modelsPath,
        }),
      ]),
    );
  });

  it("skips a managed instructions path", async () => {
    // Given an instructions file already managed by skillerie
    const { home, agentDir } = await createHome();
    const instructionsPath = join(agentDir, "AGENTS.md");
    await writeFile(instructionsPath, "Managed instructions.\n");

    // When that managed home is scanned
    const result = await scanOmo(
      home,
      agentDir,
      context((path) => path === instructionsPath),
    );

    // Then the managed file is not imported
    expect(result.items).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("returns a diagnostic for invalid MCP JSON", async () => {
    // Given an invalid MCP configuration
    const { home, agentDir } = await createHome();
    const mcpPath = join(agentDir, "mcp.json");
    await writeFile(mcpPath, '{"mcpServers": {');

    // When the home is scanned
    const result = await scanOmo(home, agentDir, context());

    // Then the parse failure is reported against the file
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "error",
          code: "import.mcp",
          file: mcpPath,
        }),
      ]),
    );
  });
});

it("imports MCP settings exactly as the OMO adapter renders them", async () => {
  // Given: an OMO mcp.json rendered by skillerie's own adapter from repository MCP settings.
  const home = await mkdtemp(join(tmpdir(), "skillerie-omo-roundtrip-"));
  try {
    const agentDir = join(home, ".omo", "agent");
    const settings = { timeoutMs: 30000, autoStart: true };
    const ctx = {
      model: {
        templates: {},
        mcp: {
          file: join(home, "repo", "mcp.json"),
          mcpServers: { docs: { url: "https://docs.example.com/mcp" } },
          harnessOverrides: {},
          settings,
        },
      },
      snapshot: { config: { paths: { home } } },
    } as unknown as ResolvedContext;
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, "mcp.json"), renderMcp(ctx, []));
    // When: the rendered file is scanned.
    const result = await scanOmo(join(home, ".omo"), agentDir, { env: {}, managed: () => false });
    // Then: the settings come back unchanged.
    expect(result.items.find((item) => item.name === "mcp-settings")).toMatchObject({
      value: settings,
    });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
