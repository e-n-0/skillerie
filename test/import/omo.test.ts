import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScanContext } from "../../src/import/types.js";
import { scanOmo } from "../../src/import/omo.js";

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
    expect(result.items).toHaveLength(3);
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
